# Organização em camadas — backend LOGIN

Estado entregue em 3 de outubro de 2026, após a primeira reorganização por módulos e a [correção de segurança](../validation/auth-security-review.md). Este documento substitui a árvore intermediária `src/modules/auth` da primeira reorganização. Frontend, backend e infraestrutura continuam projetos independentes, com dependências, configuração e imagens próprias. Não há pacote de raiz, microserviços ou dependência nova.

## Inventário, plano e arquivos divididos

O código e as instruções aplicáveis foram inspecionados antes das alterações; o plano foi apresentado antes da movimentação. Não foi presumido histórico Git. Foram registrados hashes dos arquivos, excluindo ambientes reais e artefatos gerados.

A organização anterior separava métodos, mas ainda permitia Prisma em casos de uso, validação no controller e decisões de autenticação em serviços concretos. A refatoração tratou essas dependências:

| Origem anterior | Destino e responsabilidade atual |
|---|---|
| `modules/auth/auth.module.ts` | `auth/auth.module.ts`: composição Nest, providers e ligação de portas/adaptadores; sem regras de autenticação |
| `modules/auth/controllers/auth.controller.ts` | `presentation/http/controllers/auth.controller.ts`: rotas/metadados, extração de transporte, chamada ao caso de uso e presenter |
| Métodos de resposta/cookies do controller | `presentation/http/presenters/auth.presenter.ts` e `cookies.ts`: status, corpo, headers, emissão e limpeza de cookies |
| `modules/auth/dto/auth.schemas.ts` | Schemas semânticos em `application/auth/validators/auth-input.ts`; descrição OpenAPI de transporte em `presentation/http/dto/auth.dto.ts` |
| `modules/auth/use-cases/*` | `application/auth/use-cases/*`: sem Prisma, Nest HTTP ou Express; dependências por portas |
| `modules/auth/services/sessions.service.ts`, `mfa.service.ts`, `rates.service.ts`, `policies/master-admission.policy.ts` | Casos de uso coesos de sessão/logout, MFA/recovery, limites e admissão; suas decisões e transações pertencem à aplicação |
| Queries anteriormente espalhadas pelos casos/serviços | Três implementações em `infra/database/repositories`; contratos em `application/auth/ports/repositories.ts` |
| `database/*` e transações diretas | `infra/database/prisma`: pool/ciclo de vida, unidade de trabalho e advisory locks parametrizados |
| `modules/auth/crypto.ts`, `password-work.service.ts`, `turnstile.ts` | Adaptadores em `infra/security` e `infra/integrations`; contratos em `application/auth/ports/security.ts` |
| `cleanup.service.ts` | Cutoffs e operações em `application/auth/use-cases/cleanup.ts`; timer e encerramento Nest em `infra/scheduling/auth-cleanup.ts` |
| `config/config.ts`, `http/*` | Configuração técnica em `infra/config`; configuração HTTP e builder OpenAPI em `presentation/http` |

Os imports de `main.ts`, `app.ts`, `app.module.ts`, exportador OpenAPI e testes foram ajustados. Os arquivos antigos extraídos/movidos não permanecem como fachadas. Frontend e infraestrutura não tiveram alteração funcional ou de código nesta etapa.

## Árvore atual

```text
backend/
  src/
    main.ts, app.ts, app.module.ts, export-openapi.ts
    auth/
      auth.module.ts, auth.tokens.ts
    application/auth/
      auth-settings.ts, results.ts
      ports/repositories.ts, security.ts
      validators/auth-input.ts
      use-cases/
        bootstrap-master.ts, login.ts, change-initial-password.ts
        mfa.ts, sessions.ts, master-admission.ts, rate-limits.ts, cleanup.ts
    domain/auth/models.ts
    presentation/http/
      configure-http.ts, openapi.ts
      controllers/auth.controller.ts
      dto/auth.dto.ts
      presenters/auth.presenter.ts, cookies.ts
    infra/
      config/config.ts
      database/
        prisma/prisma.module.ts, prisma.service.ts, prisma-unit-of-work.ts
        repositories/prisma-identity.repository.ts
        repositories/prisma-session.repository.ts
        repositories/prisma-rate.repository.ts, records.ts
      security/crypto.ts, password-work.ts, security-events.ts
      integrations/turnstile.ts
      scheduling/auth-cleanup.ts
  prisma/schema.prisma, migrations/     # preservados
  test/
    auth.test.ts, security.test.ts, helpers.ts, browser-server.ts
    application.test.ts, application.helpers.ts
    repositories.test.ts, architecture.test.ts
frontend/
  src/app/(auth)/                       # /login, /admin/login
  src/app/(app)/                        # /, /admin
  src/features/auth/{components,hooks,services,types}/
  src/components/layout/Shell.tsx
  src/lib/public-config.ts
  src/proxy.ts, instrumentation.ts
infra/
  compose.yaml, compose.dev-db.yaml, Dockerfile, images.lock
  scripts/test-browser.py
```

## Responsabilidades e contratos

**Aplicação.** Login valida o payload, escolhe o fluxo, exige CAPTCHA quando necessário, reserva tentativa, verifica senha, revalida o estado e escolhe a sessão. Troca inicial de senha valida a operação e coordena hash, revalidação e revogação. MFA mantém setup, enrolamento, replay TOTP, consumo de recovery e confirmação juntos. Sessions agrupa leitura/autorização, emissão/rotação, admissão após MFA pleno, logout e boas-vindas. Rates decide janela, limites e cooldown; MasterAdmission decide qual orçamento consumir. Cleanup escolhe os cutoffs; BootstrapMaster mantém a criação idempotente. Métodos privados coesos, como a visão da janela de limites, continuam junto ao caso de uso.

**Domínio.** `models.ts` define somente registros puros de usuário, sessão, dispositivo e limites, além dos estágios. Não há entidades espelhando classes Prisma nem uma segunda camada de regras. Esses tipos permitem que contratos e fakes não dependam do ORM.

**Persistência.** Os contratos estão consistentemente em `application/auth/ports`:

- `IdentityRepository`: identidade, credenciais e códigos de recuperação; implementado por `PrismaIdentityRepository`.
- `SessionRepository`: sessões e credenciais de admissão de dispositivos; implementado por `PrismaSessionRepository`.
- `RateRepository`: leitura/gravação dos contadores e remoção por cutoffs recebidos; implementado por `PrismaRateRepository`.
- `UnitOfWork`: executa callback com `AuthTransaction`, que reúne os mesmos contratos e `lock(key)`. Implementado por `PrismaUnitOfWork`.

Não foi criado um contrato por tabela nem um repositório universal de autenticação. A aplicação passa decisões já tomadas, por exemplo: tipo de usuário na busca, estágio, novos campos de credencial, contagem de dispositivos a manter e estado calculado do cooldown. Os repositórios executam queries e mapeiam registros; não calculam limites, escolhem estágio, verificam senha ou autorizam MFA. Erros de consultas são traduzidos para erro genérico, sem metadados do driver. A camada HTTP mantém a sanitização externa de falhas, inclusive de transação/lock.

**Segurança técnica.** Portas para proteção de identidade, senhas/capacidade, tokens, TOTP, CAPTCHA e eventos recebem implementações existentes. Argon2id, AES-GCM, HMAC, SHA-256, geração aleatória e validação técnica de Siteverify continuam na infraestrutura. O limite de Argon2 por processo é o mesmo mecanismo técnico, compartilhado entre login e troca de senha; não substitui limites persistentes. O caso de uso decide quando chamá-los. Eventos são emitidos pela aplicação através de uma porta restrita a nome e fluxo, sem dados de credenciais.

**Apresentação.** O controller não faz `safeParse`, consulta repositórios, escolhe estágio ou controla transações. Presenters traduzem resultados tipados para o contrato HTTP anterior, retirando os valores brutos de sessão/dispositivo do JSON. O middleware preserva ordem de CORS, Origin/Fetch Metadata, limites de corpo e no-store; para rate limit, encaminha IP e categoria da rota ao caso de uso e traduz seu resultado em HTTP. A saúde HTTP continua uma resposta técnica, sem criar um caso de uso de negócio artificial.

**Composição.** `auth/auth.module.ts` declara explicitamente providers e dependências. `PrismaModule` fornece um pool por aplicação e o encerra com o Nest. Os casos de uso não têm decorators Nest. Configuração é validada na fronteira de composição; `AuthSettings` é um contrato puro com os valores necessários às operações.

Adaptações à referência: não foram criadas pastas vazias `shared`, `entities`, `value-objects`, `rules`, `helpers` ou `filters`. Não há segunda funcionalidade que justifique `shared`; os poucos helpers permanecem junto de sua responsabilidade. O filtro HTTP existente é pequeno e permanece na configuração HTTP. Não há classes intermediárias entre contrato de repositório e implementação Prisma.

## Atomicidade e ordem dos locks

A unidade de trabalho entrega repositórios ligados ao **mesmo** cliente transacional. O objeto Prisma nunca entra na aplicação. A aplicação define a sequência e os limites da transação; a infraestrutura executa `$transaction` e `pg_advisory_xact_lock(hashtextextended(...))` com tagged template parametrizado. Timeouts e `maxWait` existentes foram preservados.

| Operação | Sequência preservada |
|---|---|
| IP | Transação com lock da chave `api:<índice>` ou `login:<índice>`, leitura e gravação da janela |
| Reserva master | Siteverify fora da transação; lock `master-risk`, revalidação do desafio, lock `master-anonymous` ou `master-device:<digest>`, reserva e commit **antes** do Argon2 |
| Login comum/master após hash | Lock `account:<id>` ou `unknown-ip:<índice>`, releitura de usuário/hash e decisão; emissão de sessão na mesma transação |
| Troca inicial de senha | Argon2 fora da transação; lock `account:<id>`, revalidação de sessão/hash, atualização, revogação de sessões/dispositivos e nova sessão restrita |
| MFA/recovery/confirm | Lock `account:<id>` e releitura de sessão; consumo/replay e alterações atômicas. Sucesso MFA adquire depois `master-risk` e depois `master-anonymous`; elevação e dispositivo usam a mesma transação |
| Bootstrap | Lock `master-bootstrap`, consulta de existência/colisão e criação idempotente |

MFA continua protegido pelo lock da conta, não por um novo lock de chave MFA. Identificadores/aliases e réplicas compartilham os mesmos estados no PostgreSQL. Não foi introduzida memória local para esses limites.

Logout continua revogando sessão e dispositivo em operações separadas, como antes. Se a remoção do dispositivo falhar depois da revogação da sessão, a aplicação sinaliza esse resultado parcial; o presenter ainda limpa o cookie de sessão e responde 500 genérico sem limpar o cookie de dispositivo. Há regressão HTTP específica para preservar essa sutileza. Cleanup continua com três remoções independentes, sem nova transação global.

**Condição preexistente registrada, sem correção de política:** o bootstrap calcula o hash da senha inicial dentro da transação, após verificar a ausência da master sob lock. Isso já existia; não foi movido trabalho Argon2 para dentro de uma transação nova. Antecipar esse cálculo mudaria sua execução em reinícios/concorrência e merece mudança separada. Pode prolongar o lock durante a criação inicial. Login e troca de senha continuam calculando Argon2 fora de transações; Siteverify também permanece fora.

## Contrato e arquivos preservados

OpenAPI regenerado e comparado com a referência anterior: **idêntico byte por byte**. Rotas, status, corpos, cookies, logs HTTP, validações, configurações, schema e migrations preservados. Nenhuma asserção existente foi removida ou enfraquecida; testes foram adaptados somente às novas assinaturas e portas. Novos testes usam fakes isolados ou o PostgreSQL descartável existente.

Scripts npm, manifestos/lockfiles, TypeScript, Dockerfiles, Compose e `.env.example` não precisaram de mudanças. Prisma continua em `backend/prisma`; `dist/main.js` e os contextos de build continuam válidos. O build local backend foi confirmado com saída limpa; a saída gerada anterior foi preservada temporariamente fora do workspace. `frontend/next-env.d.ts`, modificado automaticamente pelo Next nos testes, foi restaurado à referência.

A busca final e o teste de arquitetura verificam imports locais resolvidos, ausência de ciclos, ausência de Prisma/HTTP/infra em application/domain, ausência de validação/persistência no controller e ausência de decisões de limite nos repositórios. Não foi introduzido `any`; ele foi removido da transação de sessão e do filtro HTTP. Os `any` antigos do exportador de metadados OpenAPI não atravessam portas ou casos de uso.

## Verificações desta etapa

| Local | Comando | Resultado |
|---|---|---|
| `backend` | `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm test` | **46/46 passaram**, zero skip: 31 anteriores, 10 isolados, 1 arquitetura, 3 repositórios/PostgreSQL e 1 regressão HTTP de falha parcial no logout |
| `backend` | `npm run lint` | Passou |
| `backend` | `npm run build` | Passou, inclusive com saída limpa |
| `backend` | `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm run openapi` | Passou; comparação `cmp` com referência anterior idêntica |
| `backend` | `./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --types node --target ES2023 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck test/application.test.ts test/application.helpers.ts` | Tipagem das portas/fakes isolados passou |
| raiz | `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 NEXT_TELEMETRY_DISABLED=1 LD_LIBRARY_PATH=/tmp/login-security-browser-libs/usr/lib/x86_64-linux-gnu python3 infra/scripts/test-browser.py` | **2/2 unitários frontend e 10/10 Chromium passaram**, zero skip; fluxos comum/master reais com API e PostgreSQL temporários |
| `infra` | `docker compose --env-file .env.example config --quiet` | Passou |
| `infra` | `docker compose --env-file .env.example -f compose.yaml -f compose.dev-db.yaml config --quiet` | Passou |
| raiz | `docker build -t login-backend:layers backend` | Passou, imagem local independente |
| raiz | `docker build -t login-frontend:layers frontend` | Passou, imagem local independente; frontend inalterado, cache de build permitido |
| raiz | `docker build -t login-postgres:layers infra` | Passou, imagem local independente |

PostgreSQL temporário usa 15439 e 15441 nas suites existentes, 15442 na suite dos repositórios e 15440 nos fluxos de navegador. As migrações são reaplicadas nas fixtures. Duas aplicações Nest com pools distintos continuam exercitando concorrência, reservas de admissão e escalada de cooldown. Os testes isolados não simulam a consistência do PostgreSQL: rollback real e concorrência são cobertos pelos testes de integração.

Falhas intermediárias corrigidas: a primeira compilação apontou `TS2345` no estreitamento do resultado de logout; a discriminação tipada foi corrigida, sem cast para `any`. A primeira invocação avulsa do typecheck dos fakes apontou `TS2591: Cannot find name 'node:assert/strict'` e o equivalente para `node:test`, porque `--ignoreConfig` não inclui automaticamente esses tipos; repetir com `--types node` usou a dependência já instalada e passou. Nenhuma biblioteca foi adicionada. As duas rodadas completas backend executadas durante esta etapa passaram (31 existentes antes da cobertura nova; depois 46).

## Limitações e pendências

- Lint e build **nativos** do frontend não foram repetidos nesta etapa: não houve mudança no frontend nem no contrato externo. Seus testes foram executados e sua imagem Docker foi construída. Os resultados de lint/build da primeira reorganização são históricos, não apresentados como nova execução.
- Não houve Siteverify real, TLS/reverse proxy/WAF de produção, nova auditoria de dependências, carga/brute force ou sondagem de produção. Não houve Compose iniciado contra volumes persistentes nem migração de dados reais.
- Chromium usou bibliotecas temporárias já disponíveis em `/tmp/login-security-browser-libs`; o caminho pode desaparecer. O operador deve preparar as dependências do Playwright em outro ambiente. Permanecem avisos preexistentes `MODULE_TYPELESS_PACKAGE_JSON` e `NO_COLOR`/`FORCE_COLOR`, sem falha dos testes.
- Permanecem os riscos de disponibilidade da admissão anônima master, primeiro acesso, CAPTCHA, IP/NAT e capacidade descritos na auditoria. Nenhuma política foi alterada para tratá-los. A condição do hash no bootstrap está registrada acima para avaliação separada.
- Não foram lidos, impressos ou alterados arquivos reais de ambiente/segredos. Não houve commit, push, deploy, envio de código a serviços externos ou instalação de infraestrutura nova.

## Execução

Os comandos operacionais continuam iguais, após configuração local feita pelo operador conforme [infra/README.md](../../infra/README.md):

```bash
cd /home/ronald/projetos/application-foundation/infra
docker compose build
docker compose up -d
```

Alternativa nativa, com banco e ambiente já preparados: `npm run db:generate`, `npm run db:migrate` e `npm run dev` em `backend`; `npm run dev` em `frontend`, em outro terminal. Acesse `http://localhost:3000/login` ou `/admin/login`. Esses comandos de subida/migração real são instruções ao operador, não operações executadas nesta refatoração.
