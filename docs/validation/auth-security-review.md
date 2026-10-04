# Correção da auditoria de autenticação — 2026-10-03

Workspace: `/home/ronald/projetos/application-foundation`, WSL Ubuntu 24.04. Frontend/backend/infra continuam independentes. Sem commit, push, deploy, Redis ou nova dependência de aplicação. Arquivos reais de `.env`/segredos não foram lidos, impressos ou alterados; somente os `.env.example` foram editados. As migrações foram executadas exclusivamente em PostgreSQL temporário dos testes. Nenhum volume ou dado real foi modificado.

## Decisões

### Enumeração

`/v1/auth/login` agora consulta apenas usuários comuns e nunca solicita CAPTCHA. Identificadores master e inexistentes usam o hash fictício; contas comuns em cooldown também passam pela verificação de hash antes da rejeição. Falhas retornam o mesmo 401, mensagem e `challengeRequired=false`. Respostas 429/503 dependem do limite de origem/capacidade, não da categoria encontrada. O endpoint comum não altera contadores master.

No endpoint master, desafio depende de pressão global do fluxo e vale igualmente para identificadores master, comuns, desconhecidos e payloads inválidos. Nenhum contador escolhido pela existência da conta determina o desafio. CAPTCHA válido é verificado pelo servidor; erros/ausência quando exigido não consomem admissão de senha. Não se garante latência perfeitamente constante de toda a infraestrutura.

### Disponibilidade master

Reduzir o cooldown sozinho não eliminaria o ataque. A política preserva limites IP e adiciona separação baseada em prova prévia de MFA:

- Admissão anônima: orçamento global de três verificações de senha em 15 minutos, cooldown 1/2/4/5 minutos, não contornável por IP/alias/identificador alternativo. Reservas são feitas no PostgreSQL antes do Argon2, incluindo verificações que acertam a senha mas ainda não concluíram MFA.
- Dispositivo reconhecido: cookie aleatório de 256 bits, emitido somente após MFA completo, com digest e validade em `MasterDevice`. Limite próprio igualmente progressivo e compartilhado entre réplicas. Dura até 30 dias, configurável por `MASTER_DEVICE_DAYS`; no máximo dez dispositivos. O cookie apresentado é rotacionado/revogado em nova autenticação completa. Não permite recursos, não autentica e não dispensa senha, CAPTCHA ou MFA.
- MFA: orçamento por conta separado de falhas de senha. Apenas sessões com senha já verificada podem consumi-lo. Trocar sessão ou réplica não zera esse limite.
- Logout normal revoga sessão e preserva reconhecimento. “Sair e esquecer este dispositivo” revoga também a admissão. Troca obrigatória de senha revoga todos os dispositivos.

A migration aditiva `202610030001_master_device` cria a tabela e seus índices/FK. Não reseta conta, senha ou sessão. Os contadores antigos da conta master deixam de controlar a admissão e são removidos pela limpeza existente. Limites comuns, limite IP, proteção contra excesso de Argon2 e CSRF continuam.

**Risco residual:** dispositivos novos, cookies removidos/expirados e bootstrap ainda podem ser bloqueados repetidamente no orçamento anônimo por um atacante distribuído que resolve CAPTCHA. A proteção adicionada vale para quem já possui uma prova de MFA; ela não distingue um primeiro acesso legítimo sem essa prova. Primeiro acesso deve ocorrer em janela/rede controlada. Roubo do cookie permite atacar o orçamento daquele dispositivo, mas não autenticar; conhecimento da senha permite atacar o orçamento MFA. Saturação de recursos, IP/NAT compartilhado e indisponibilidade de Siteverify exigem controles operacionais de produção. Não há alegação de disponibilidade absoluta.

### Cookie e configuração

`PUBLIC_API_ORIGIN` é a autoridade para o nome/segurança dos cookies. Compose passa a mesma origem ao backend, ao build frontend e ao runtime frontend. `NEXT_PUBLIC_API_ORIGIN` é o valor derivado e incorporado no build; configurações concorrentes diferentes falham. `COOKIE_SECURE` saiu dos exemplos/Compose e é rejeitada com mensagem de migração no frontend se ainda for fornecida.

HTTPS usa `__Host-login_session` e `__Host-login_master_device`; HTTP local usa os nomes sem prefixo. Emissão e limpeza usam `HttpOnly`, `SameSite=Lax`, `Path=/`, nenhum `Domain`, e `Secure` em HTTPS. SSR usa a origem incorporada e a instrumentação verifica a origem de runtime. Configuração divergente encerra o processo com código 1 e mensagem clara sem imprimir os valores.

## Comandos e resultados da correção original (histórico)

| Diretório | Comando | Resultado |
|---|---|---|
| `backend` | `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm test` | **31/31 passaram**, sem skip. Pretest gera Prisma e compila. PostgreSQL real temporário; migrations aplicadas duas vezes por fixture. |
| `backend` | `npm run lint` | Passou. |
| `backend` | `npm run build` | Passou. |
| `backend` | `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm run openapi` | Passou; contrato atualizado. |
| `frontend` | `npm run test:unit` | **2/2 passaram**: HTTP/HTTPS e configurações conflitantes/inválidas. |
| `frontend` | `npm run lint` | Passou. |
| `frontend` | `NEXT_TELEMETRY_DISABLED=1 npm run build` | Passou, incluindo instrumentação. |
| raiz | `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 NEXT_TELEMETRY_DISABLED=1 LD_LIBRARY_PATH=/tmp/login-security-browser-libs/usr/lib/x86_64-linux-gnu python3 infra/scripts/test-browser.py` | **10/10 testes de navegador passaram**, além dos dois unitários. Inclui login real comum/master, TOTP, recovery, SSR, logout e esquecer dispositivo. |
| `infra` | `docker compose --env-file .env.example config --quiet` | Passou sem carregar segredos reais. |
| `infra` | `docker compose --env-file .env.example -f compose.yaml -f compose.dev-db.yaml config --quiet` | Passou. |
| raiz | `docker build -t login-backend:security-audit backend` | Passou, imagem local separada. |
| raiz | `docker build -t login-frontend:security-audit frontend` | Passou, imagem local separada. |
| `frontend` | `PUBLIC_API_ORIGIN=https://login.example.invalid NEXT_TELEMETRY_DISABLED=1 PORT=15445 node .next/standalone/server.js` | **Negativo esperado:** encerrou com código 1 por incompatibilidade entre origem local do build e origem HTTPS fictícia de runtime. |
| raiz | `docker run --rm --network none -e PUBLIC_API_ORIGIN=https://login.example.invalid login-frontend:security-audit` | Mesmo negativo esperado, código 1 dentro da imagem. Sem rede, portas ou volumes. |

Mensagem do teste negativo: `PUBLIC_API_ORIGIN diverge da origem incorporada no frontend. Reconstrua a imagem com a mesma origem usada pelo backend.`

A suite da correção original usava dois objetos Auth com conexões/pools Prisma distintos sobre o mesmo banco e pequenas chamadas concorrentes determinísticas. Após as refatorações, usa duas aplicações Nest e os casos de uso reais com pools distintos, preservando essas asserções. Verifica persistência/atomicidade, revalidação do CAPTCHA em corrida, progressão sem prolongamento do bloqueio, token inexistente/expirado/revogado, rotação e separação de orçamento MFA. Isso é regressão de concorrência local, não teste de carga ou brute force em ambiente real.

## Falhas encontradas durante a verificação

1. O Chromium inicialmente não iniciou. Erro exato: `error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory`. Aquela execução foi reprovada. `libnspr4`, `libnss3` e `libasound2t64` foram baixadas como pacotes Ubuntu públicos e extraídas com `dpkg-deb -x` em `/tmp/login-security-browser-libs`, sem instalação global. Somente a rodada posterior com LD_LIBRARY_PATH e dez testes passados é considerada aprovada. O diretório é temporário e precisa ser recriado ou substituído por dependências de sistema do Playwright numa execução futura.
2. Um teste existente de CSP examinava ausência de `unsafe-inline` na política inteira, embora o proxy permita estilos inline no desenvolvimento. A asserção foi corrigida para a diretiva `script-src`, mantendo verificação de `strict-dynamic`, nonce presente nos scripts e renovação do nonce. A política do proxy não foi enfraquecida nem modificada.
3. Next captura exceções de instrumentação e pode deixar o processo ouvindo após erro de configuração. A instrumentação passou a encerrar explicitamente o runtime Node; isso foi confirmado com processo standalone e imagem Docker.

## Não executado / dependente de produção

- Não houve chamada real ao Siteverify: respostas do serviço são simuladas nos testes para não usar credenciais reais nem depender de serviço externo.
- TLS real, reverse proxy/WAF de produção e validação ponta a ponta HTTPS não foram exercitados. Os atributos dos cookies foram verificados nas respostas da API configurada para HTTPS de produção, e a escolha do nome no frontend foi testada por contrato.
- Não houve `docker compose up` sobre a aplicação/volume existente nem migração de dados reais. Builds e validação estrutural do Compose passaram; a integração de runtime usa fixtures descartáveis nativas.
- Não foram feitos testes de carga, brute force, sondagem de produção ou nova auditoria de dependências. Não foi introduzida dependência de aplicação.

Para usar a nova versão, aplicar a migration pela operação habitual de `migrate deploy`/serviço `migrate`, reconstruir o frontend quando mudar a origem pública e remover a variável legada de configurações locais sem divulgar seus valores. Essa operação nos dados reais não foi executada nesta tarefa.

## Arquivos alterados na correção original (caminhos históricos)

Backend:

- `backend/src/auth.ts`, `app.ts`, `config.ts`, `main.ts`, `export-openapi.ts`.
- `backend/src/cookies.ts` (novo).
- `backend/prisma/schema.prisma` e `backend/prisma/migrations/202610030001_master_device/migration.sql` (nova migration).
- `backend/test/auth.test.ts`, `backend/test/security.test.ts` (novo).
- `backend/openapi.json`, `backend/.env.example`, `backend/README.md`.

Frontend:

- `frontend/src/components/Welcome.tsx`, `Logout.tsx`.
- `frontend/src/instrumentation.ts`, `frontend/src/lib/public-config.ts` (novos).
- `frontend/next.config.ts`, `frontend/Dockerfile`, `frontend/.env.example`.
- `frontend/tests/integration.spec.ts`, `login.spec.ts`, `public-config.test.mjs` (novo).
- `frontend/playwright.config.ts`, `frontend/package.json` (somente scripts), `frontend/README.md`.

Infraestrutura e documentação:

- `infra/compose.yaml`, `infra/.env.example`, `infra/README.md`.
- `README.md` e este registro de auditoria.

Não existe repositório Git inicializado neste diretório. A lista foi conferida por comparação de hashes dos arquivos de código/documentação antes/depois, excluindo segredos e artefatos gerados. `frontend/next-env.d.ts` foi restaurado à referência gerada original após os testes, evitando mudança incidental.

## Estado após a refatoração em camadas

As políticas acima continuam vigentes. A árvore atual está em [organização em camadas do backend](../architecture/backend-organization.md); os caminhos da lista histórica não representam mais a localização dos componentes extraídos.

- Decisões e validações semânticas: `backend/src/application/auth/use-cases` e `validators`.
- Portas de persistência/segurança: `backend/src/application/auth/ports`; modelos puros em `domain/auth`.
- Repositórios Prisma e unidade de trabalho: `backend/src/infra/database`. Os mesmos locks, chaves, janelas e timeouts continuam compartilhados no PostgreSQL.
- Argon2, AES-GCM/HMAC, tokens/TOTP e Siteverify: `infra/security` e `infra/integrations`, acionados pela aplicação através de portas.
- Rotas, respostas e cookies: `presentation/http`; composição Nest em `auth/auth.module.ts`. Controller não consulta persistência nem decide regras de autenticação.

Verificação desta etapa: **46/46 testes backend**, incluindo as 31 regressões anteriores, dez testes isolados, uma verificação de arquitetura, três testes Prisma/rollback e uma regressão HTTP de logout parcial; lint, build e OpenAPI passaram. **2/2 unitários frontend e 10/10 testes Chromium** passaram contra API/PostgreSQL temporários. Dois perfis Compose e builds locais das três imagens passaram. OpenAPI permaneceu idêntico byte por byte; schema, migrations, configuração e dependências não mudaram. Comandos exatos e limitações estão no relatório de reorganização. Não se repetiram os testes negativos standalone/Docker de configuração da correção original nem lint/build nativos frontend, pois esse código e o contrato não mudaram; esses resultados históricos não são contados como execução nova.

Nenhuma asserção existente foi removida ou relaxada. Os fakes verificam decisões isoladas, sem substituir testes reais de atomicidade/concorrência. A checagem arquitetural impede imports de Prisma/HTTP/infra em application/domain e validação de operação no controller. Não há `any` nas portas/casos de uso para ocultar dependências.

Achado preexistente registrado separadamente: o bootstrap calcula Argon2 dentro da transação sob `master-bootstrap`, somente quando a master está ausente. Esse comportamento foi preservado para não mudar sua atomicidade/execução nesta tarefa; pode prolongar o lock na criação inicial. Siteverify, login e troca inicial de senha continuam com rede/hash fora de suas transações. Logout mantém a revogação da sessão e sua limpeza de cookie mesmo se a remoção posterior do dispositivo falhar; a resposta genérica 500 e a ausência de limpeza do cookie de dispositivo nesse caso foram preservadas e testadas.

Não houve alteração de política, dados reais, segredos, deploy, commit ou push. Permanecem as limitações operacionais e os riscos residuais registrados acima.
