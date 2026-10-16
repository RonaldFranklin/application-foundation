# Application Foundation API

Projeto NestJS/TypeScript independente. Node 24.16 LTS; Prisma 7.10 com adapter `pg`. A API é a autoridade para todos os estados de autenticação. Novas contas e associações organizacionais exigem convite autorizado e aceite do destinatário. Não há OAuth, recuperação de senha ou RBAC geral.

## Execução

```bash
cd /home/ronald/projetos/application-foundation/backend
npm ci
cp .env.example .env
# Preencha .env localmente conforme ../infra/README.md.
npm run db:generate
npm run db:migrate
npm run dev
```

Para executar compilado: `npm run build && npm start`. Para verificar: `npm run lint && npm run build && npm test`. O build gera `dist/main.js`. Migrações devem ser aplicadas antes de iniciar; não há `db push` automático. `npm run openapi` atualiza `openapi.json` sem conexão de banco, sem carregar segredos reais no documento e sem publicar Swagger na API.

## Contrato e estados

Todos os endpoints abaixo possuem prefixo `/v1`. JSON apenas; POST requer `Origin` idêntica a `FRONTEND_ORIGIN` e rejeita `Sec-Fetch-Site: cross-site`. Clientes de CLI devem fornecer o mesmo Origin explicitamente. CORS usa uma origem exata e credenciais. Não há tokens no JSON ou storage do navegador.

| Método e rota                  | Entrada                                     | Resposta / autorização                                                                               |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST `/auth/login`             | `identifier`, `password`                    | `stage=password` se a senha for temporária; caso contrário `full`; rejeita master                                                                         |
| POST `/admin/auth/login`       | `identifier`, `password`, `turnstileToken?` | `password`, `setup` ou `mfa`; nunca sessão plena                                                     |
| GET `/auth/session`            | cookie                                      | `stage`, `master`; só informa estado                                                                 |
| POST `/auth/initial-password` | `password`, `confirmPassword` | sessão `password` comum; revoga sessões e gira cookie para `full` (8 horas por padrão) |
| POST `/admin/auth/password`    | `password` de 15–1024 caracteres            | somente `password`; senha diferente da anterior; revoga sessões existentes; gira cookie para `setup` |
| POST `/admin/auth/totp/setup`  | `{}`                                        | somente `setup`; `secret`, `uri` otpauth; nunca após enrolamento                                     |
| POST `/admin/auth/totp/enroll` | `code` TOTP                                 | somente `setup`; valida, gira cookie para `recovery`, retorna dez `recoveryCodes` uma única vez      |
| POST `/admin/auth/confirm`     | `{}`                                        | somente `recovery`; gira cookie para `full`                                                          |
| POST `/admin/auth/mfa`         | `code` TOTP ou recovery                     | somente `mfa`; gira cookie para `full`                                                               |
| GET `/welcome`                 | cookie pleno comum                          | perfil comum atualizado                                                                |
| GET `/admin/welcome`           | cookie pleno master                         | perfil master; exige senha trocada e TOTP verificado                                                   |
| POST `/auth/logout`            | `{forgetDevice?: boolean}`                  | 204 idempotente; revoga qualquer estágio                                                             |
| GET `/health`                  | —                                           | prontidão HTTP; middleware também verifica acesso ao banco                                           |

Sucesso retorna 200, logout 204. No login, credenciais inválidas, fluxo cruzado e bloqueio retornam 401 e **“E-mail ou senha inválidos.”**, sem distinguir contas. Nas demais operações, 401 identifica sessão/acesso inválido ou uma causa segura via `code` opcional (ver mensagens abaixo). No login comum, `challengeRequired` é sempre false. No master ele indica pressão global do fluxo, inclusive para identificadores inexistentes. Falhas de validação de credenciais também são genéricas. Senha nova fora do tamanho permitido: 400. CSRF: 403. Payload acima de 8 KiB: 413. Limite por IP: 429 com `Retry-After: 60`. Falha de dependência: resposta sanitizada, sem stack trace/PII. Um erro inesperado de aplicação retorna 500.

Sessões restritas duram 10 minutos e só acessam as transições explicitamente permitidas. Sessão plena tem prazo absoluto de 8 horas (sem renovação deslizante). Cookie `login_session` no HTTP local ou `__Host-login_session` no HTTPS, `HttpOnly`, `SameSite=Lax`, `Path=/`, sem Domain. Token de 256 bits; somente SHA-256 no banco. A API ignora cookies expirados mesmo antes da limpeza periódica. Cada elevação gira o token e invalida o anterior. Logout também invalida no banco. HTTPS é obrigatório no modo produção.

## Persistência e segurança

- `User`: username, email e TOTP cifrados com AES-256-GCM, nonce aleatório de 96 bits, tag de 128 bits e AAD por finalidade e versão. Mesmo texto produz ciphertext diferente. Índices cegos HMAC-SHA-256, com chave separada, normalização NFKC/trim/lowercase e versão. Nenhuma busca usa PII em texto puro. Username/e-mail são únicos; bootstrap verifica também colisão entre os dois namespaces. Futuro provisionamento deve preservar essa invariável.
- Senhas Argon2id, salt aleatório da biblioteca, memória 64 MiB, 3 iterações, paralelismo 1. Medido em aproximadamente 113–120 ms por hash neste WSL, sem carga; recalibrar com a capacidade real, inclusive concorrência. Passphrases permitidas, sem composição arbitrária ou truncamento. Limite superior explícito de 1024 caracteres para controlar recursos.
- Bootstrap sob advisory lock transacional e índice único parcial para uma única master. Só cria quando não existe nenhuma master. Alterar usuário/e-mail/senha de bootstrap ou reiniciar não redefine a conta. Após criação, os campos secretos de bootstrap continuam exigidos na configuração inicial desta versão, mas seus valores não são reaplicados.
- TOTP padrão SHA-1, seis dígitos, período 30 s, janela ±1 passo; último passo consumido impede replay e retrocesso. Recovery codes aleatórios de 128 bits, somente digest SHA-256 no banco, consumo transacional. Sem recuperação silenciosa. Se a resposta com códigos for perdida ou a página recarregada, eles não são recuperáveis; o autenticador continua válido. Não há regeneração de códigos nesta versão.
- Prisma gera consultas parametrizadas. SQL explícito usa apenas tagged templates parametrizados para advisory locks; nenhum SQL concatenado. As alterações de autenticação usam transações e locks por conta, compartilhados entre réplicas. Username e e-mail da mesma conta usam o mesmo lock/limite.
- Eventos de segurança no console possuem apenas nome do evento e fluxo; não contêm identificador, IP bruto, senha, cookie, token ou código. Não habilitar query logging ou request/body logging no proxy sem redigir esses dados.
- Registros expirados são limpos de hora em hora; estados de rate limit sem atualização por 24h são removidos. Expiração é aplicada imediatamente na leitura, independentemente da limpeza. Contadores nunca criam bloqueio permanente.

## Limites configuráveis

| Variável                    | Inicial | Efeito                                                           |
| --------------------------- | ------: | ---------------------------------------------------------------- |
| `LOGIN_IP_LIMIT`            |      10 | solicitações de login/IP em janela móvel de 60 s, somando fluxos |
| `API_IP_LIMIT`              |     100 | solicitações API/IP em janela móvel de 60 s                      |
| `ACCOUNT_FAILURE_LIMIT`     |       3 | falhas comuns/MFA ou reservas master antes de cooldown           |
| `ACCOUNT_WINDOW_MS`         |  900000 | janela móvel de falhas, 15 min                                   |
| `COOLDOWN_BASE_MS`          |  300000 | primeiro cooldown comum, 5 min                                   |
| `COOLDOWN_MAX_MS`           | 1800000 | teto comum 30 min; progressão 5, 10, 20, 30                      |
| `MASTER_COOLDOWN_BASE_MS`   |   60000 | primeiro cooldown master, 1 min                                  |
| `MASTER_COOLDOWN_MAX_MS`    |  300000 | teto master 5 min; progressão 1, 2, 4, 5                         |
| `TURNSTILE_THRESHOLD`       |       2 | admissões sem MFA completo antes de exigir desafio master        |
| `SESSION_HOURS`             |       8 | validade absoluta da sessão plena                                |
| `PASSWORD_HASH_CONCURRENCY` |       4 | máximo de Argon2 simultâneos por processo                        |

A política master foi revisada: veja “Política revisada após auditoria” abaixo. `MASTER_DEVICE_DAYS` é 30 por padrão (1–30). Os limites comuns continuam por conta/alias, com bucket HMAC por IP para identificadores inexistentes; não são criados registros por identificador arbitrário. Os limites master são globais para a admissão anônima e separados por credencial de dispositivo já verificado, sem depender de rotação de IP.

O processo limita o trabalho Argon2 simultâneo (4 por padrão) e responde 503 com Retry-After ao atingir a capacidade. Cada operação usa cerca de 64 MiB; o limite de memória multiplica pelo número de processos. Redis não é necessário para a consistência: PostgreSQL mantém os contadores duráveis. Monitore capacidade e proteção de borda.

`TRUST_PROXY` vazio ignora X-Forwarded-For. Configure somente IPs/CIDRs dos proxies realmente controlados, separados por vírgula; nunca `true`, número de saltos arbitrário ou redes abrangentes sem justificativa. SSR usa o IP do frontend na consulta de boas-vindas e participa do limite geral: dimensione conscientemente para carga real.

## Turnstile e chaves

Siteverify é chamado no servidor com timeout de 4 s; exige sucesso, ação `master-login`, hostname configurado e timestamp com idade menor que 5 min. A validação single-use/expiração é imposta por Siteverify. Indisponibilidade, configuração ausente ou token arbitrário negam login quando desafio é requerido. A suite simula respostas do serviço; nunca envia segredos de usuário à Cloudflare durante os testes.

`ENCRYPTION_KEY` e `HMAC_KEY`: 32 bytes diferentes, codificados em 64 dígitos hexadecimais; `KEY_VERSION` padrão `v1`. Configure-os fora do banco e preserve backup seguro junto de plano de recuperação. A versão é embutida no ciphertext/índice. Esta versão carrega um único par de chaves: **não basta trocar a chave ou KEY_VERSION**; isso impediria descriptografia/busca. Rotação futura precisa de keyring temporário, recriptografia e reconstrução dos índices em migração coordenada. Não há rotação automática.

OpenAPI é um artefato de contrato, não código compartilhado: consumidores podem versionar sua cópia ou gerar clientes separadamente. Fontes consultadas: [Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql), [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) e [chaves de teste Turnstile](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

## Política revisada após auditoria (2026-10-03)

O login comum consulta somente `master=false`. Identificador master (inclusive com senha correta nesse endpoint) é tratado como desconhecido: hash fictício, 401, mensagem genérica, `challengeRequired=false`. Até contas comuns em cooldown percorrem a verificação Argon2 antes da rejeição, evitando o atalho de custo que distinguia registros existentes. Erros de origem, payload, capacidade e limite IP dependem da solicitação/origem, não do tipo da conta. Isso não promete tempo matematicamente constante para toda a infraestrutura.

No endpoint master, `master-risk` é um sinal global do fluxo, não um índice do identificador: após duas admissões de verificação de senha sem MFA concluído, o desafio passa a ser exigido para todos os identificadores. Uma transação revalida essa condição antes de reservar cada tentativa. O Siteverify continua fora da transação. CAPTCHA ausente ou inválido quando exigido não cria bloqueio de conta e não consome reserva de senha. Resolver o CAPTCHA não dispensa nenhum limite. Sucesso MFA limpa o sinal sob lock; durante cooldown, a resposta continua genérica, sem revelar quando o contador de uma conta específica expira.

A política master utiliza três limites complementares:

1. **Admissão anônima global** (`master-anonymous`): três verificações de senha admitidas em 15 minutos causam cooldown de 1, 2, 4 e até 5 minutos. São contadas inclusive verificações que acertam a senha, mas ainda precisam concluir MFA. O contador é único para o endpoint master, atravessando IPs, aliases, identificadores inventados e réplicas. Tentativas bloqueadas não estendem o prazo. O limite IP de 10/min continua em vigor.
2. **Admissão de dispositivo reconhecido**: após MFA completo, a API emite `login_master_device` (ou `__Host-login_master_device` em HTTPS), aleatório de 256 bits, guardando apenas SHA-256 em `MasterDevice`. Dura até `MASTER_DEVICE_DAYS` (30 por padrão, máximo 30); cada dispositivo tem o mesmo limite progressivo, compartilhado no PostgreSQL e independente do bucket anônimo. A posse desse segredo não autentica, não permite recursos nem dispensa CAPTCHA, senha ou MFA. IP diferente com o mesmo cookie continua no mesmo limite; cookie inventado/expirado/revogado volta ao limite anônimo. Não há registros ilimitados por cookie inventado. São mantidos no máximo dez dispositivos por master; uma nova autenticação completa rotaciona o cookie apresentado e revoga o anterior. Mudança obrigatória de senha revoga todos os dispositivos. A limpeza remove expirados.
3. **MFA por conta** (`mfa:<id>`): somente sessões que já provaram senha podem consumir esse orçamento. Três falhas causam cooldown master compartilhado, mesmo trocando sessão, dispositivo ou réplica. Falhas de senha anônimas não bloqueiam uma sessão MFA legítima já iniciada.

Todas as reservas/bloqueios são persistentes, com advisory locks transacionais. A reserva acontece **antes** do Argon2: a concorrência não permite uma quantidade arbitrária de verificações com base em leitura antiga. O limite de memória Argon2 por processo permanece complementar, não substitui os limites duráveis. Não foi adicionado Redis nem dependência de aplicação.

Logout normal revoga a sessão, preservando apenas a admissão do navegador; `POST /v1/auth/logout {"forgetDevice":true}` também revoga o dispositivo. A interface master oferece “Sair e esquecer este dispositivo” para máquinas compartilhadas. A admissão nunca é aceita como cookie de sessão e nunca é enviada em JSON.

**Limites restantes:** sem prova anterior de MFA, não há como distinguir um primeiro acesso legítimo de um atacante que conhece o identificador e resolve CAPTCHA. Dispositivos novos, cookies apagados/expirados ou bootstrap continuam sujeitos à indisponibilidade do bucket anônimo sob ataque distribuído. Conclua o primeiro acesso em uma janela/rede controlada e mantenha um dispositivo já reconhecido. Esta mitigação protege o retorno de dispositivos reconhecidos; não garante disponibilidade universal. CAPTCHA indisponível, exaustão de recursos ou abuso do mesmo IP/NAT ainda podem bloquear acesso. Cookie de admissão furtado permite atacar o orçamento daquele dispositivo, mas não concede autenticação. Quem conhece a senha pode atacar o orçamento MFA: a resposta operacional exige análise de comprometimento, não remoção do fator. Proteção de borda e calibração de capacidade seguem dependentes do ambiente de produção.

A migration `202610030001_master_device` é aditiva. Aplicá-la antes de iniciar a versão nova; ela não redefine senhas, sessões, dados pessoais nem chaves. Os contadores antigos `account:<master>` deixam de ser a autoridade para admissão master e expiram pela limpeza existente. A nova política começa sem cookies de dispositivo, que só serão emitidos após MFA válido.

## Organização interna em camadas

`src/auth/auth.module.ts` faz a composição Nest de controllers, casos de uso, portas e adaptadores, sem regras de autenticação. `src/app.module.ts` importa esse módulo. O pool Prisma e seu encerramento ficam em `src/infra/database/prisma`; schema e migrations permanecem em `backend/prisma`.

- `application/auth/use-cases`: login, bootstrap, troca inicial de senha, MFA/recovery, sessão/logout, admissão master, rate limits e limpeza. Define decisões, sequência de operações e fronteiras transacionais. Não importa Prisma, Nest HTTP ou Express.
- `application/auth/validators`: validações semânticas, chamadas pelos casos de uso antes das operações; `auth-settings.ts` e `results.ts` definem configuração e resultados puros.
- `application/auth/ports`: contratos `IdentityRepository`, `SessionRepository`, `RateRepository`, `UnitOfWork` e serviços técnicos de senha, proteção de identidade, tokens, TOTP, CAPTCHA e eventos. Nenhum tipo Prisma atravessa esses contratos.
- `domain/auth/models.ts`: modelos puros de registros/estágios, sem camada paralela de regras.
- `infra/database/repositories`: consultas e mapeamento Prisma, sem decisões de autenticação. `PrismaUnitOfWork` liga os três repositórios ao mesmo cliente transacional e executa os advisory locks parametrizados na ordem solicitada pela aplicação.
- `infra/security`, `integrations` e `scheduling`: mecanismos criptográficos, capacidade Argon2, Siteverify e timer de manutenção. Cutoffs e decisões do fluxo ficam na aplicação.
- `presentation/http`: controller como adaptador de transporte; presenters para status, corpo e cookies; configuração de CORS, CSRF, parsing, headers e erros. Controller não valida operação, consulta persistência ou decide estágio/cooldown.

Preservados os locks: reserva master adquire `master-risk` antes do orçamento anônimo/dispositivo; MFA adquire conta, depois `master-risk` e `master-anonymous` no sucesso. Login e troca de senha fazem Argon2 fora da transação, e Siteverify permanece fora. **Condição preexistente preservada:** o bootstrap ainda calcula o hash inicial sob `master-bootstrap` quando precisa criar a conta; retirar esse trabalho do lock exige avaliação separada, não foi misturado à refatoração.

Não há `shared`, entidades artificiais, pastas vazias ou fachada entre contratos e adaptadores. Scripts e `dist/main.js` mantêm os caminhos anteriores. `npm test` inclui casos de uso isolados com portas falsas, teste de arquitetura, integração Prisma com rollback e concorrência entre pools. Os bancos são descartáveis (15439, 15441 e 15442); navegador usa 15440. As verificações atuais e a árvore completa estão em [../docs/architecture/backend-organization.md](../docs/architecture/backend-organization.md).

## Perfil autenticado somente para consulta

`GET /v1/welcome` e `GET /v1/admin/welcome` mantêm a autorização atual e ampliam a resposta 200 com:

| Campo | Conteúdo |
|---|---|
| `message` | Mensagem de boas-vindas anterior, preservada por compatibilidade |
| `username` | Username atual, descriptografado; não representa nome completo |
| `email` | E-mail atual, descriptografado |
| `accountType` | `common` ou `master`, determinado pelo registro da sessão |
| `mfa.configured` | Presença de configuração TOTP, sem expor o segredo |
| `mfa.verified` | Estado de verificação TOTP registrado para a conta |

A identidade vem exclusivamente do cookie. Não há parâmetro de seleção de perfil: query strings como `userId`, `username` ou `email` não selecionam outro usuário. A aplicação primeiro verifica sessão plena, expiração, categoria e requisitos master; somente depois descriptografa username/e-mail. Falhas continuam em 401 genérico, sem campos de perfil; respostas continuam `no-store`. O controller e os repositórios não ganharam regras de autorização; a operação permanece em `application/auth/use-cases/sessions.ts`.

Na entrega original de perfil não havia edição nem provisionamento. O cadastro comum pelo Master foi acrescentado posteriormente em Usuários de organizações; a validação automatizada continua usando dados descartáveis. Verificações desta entrega: [../docs/features/profile.md](../docs/features/profile.md).

## Edição do perfil autenticado

- `POST /v1/auth/profile`: JSON estrito `{username, email, currentPassword, code?}`. Username de 1–100 caracteres, sem valor vazio após normalização; e-mail válido até 254. Ambos são obrigatórios. Resposta 200 `{passwordChanged:false}`; recarregue o perfil em `/welcome` ou `/admin/welcome`.
- `POST /v1/auth/password`: `{currentPassword, newPassword, confirmPassword, code?}`. Reutiliza a política de 15–1024 caracteres (mínimo de 15 pontos Unicode), confirma também no servidor e rejeita senha igual à atual. Resposta 200 `{passwordChanged:true}`, cookies expirados e **nenhuma sessão nova**.
- Ambas exigem sessão plena e senha atual. Master exige também TOTP de seis dígitos dentro da janela existente ±1 passo de 30 segundos e posterior ao último consumido. Recovery codes não substituem esse fator na edição. Aguarde o próximo código se o atual já foi consumido no login ou em outra alteração.
- A alteração de e-mail é imediata e **não verifica a posse do novo endereço**: não envia link/código e não atribui status de verificado. Nenhum campo novo de identidade foi criado.
- Validação retorna 400 com `message` e `fields` (mensagens fixas, sem valores recebidos). Reautenticação e cooldown retornam 401 com códigos próprios; colisão de identificadores mantém mensagem genérica de alteração recusada, sem revelar outra conta. Sessão inválida também retorna 401; capacidade Argon2 esgotada retorna 503. Proteções globais de origem/CSRF, JSON, tamanho, IP e cache permanecem.
- `EditProfile` reserva cada tentativa válida em `profile:<userId>` antes do Argon2, sob lock da conta, aplicando os limites e cooldowns existentes (master/comum). O orçamento é compartilhado entre sessões, rotas e réplicas, e é limpo após sucesso. Tentativas admitidas ainda em execução podem concluir; a reserva bloqueia novas admissões. Não interfere no orçamento de login/MFA.
- Argon2 ocorre fora da transação longa. Antes da escrita, a transação relê sessão, validade, estado e hash sob `account:<id>`. TOTP é consumido na mesma transação. Atualizações de identidade usam também `identity-update`, compartilhado com bootstrap, e excluem apenas a própria conta ao checar colisões nos dois namespaces. Futuros provisionadores devem usar esse lock. AES-GCM, HMAC normalizado e índices únicos permanecem. Login concorrente revalida o identificador após adquirir o lock.
- Trocar a senha grava o hash Argon2id e revoga **todas** as sessões (inclusive restritas e atual) e todos os registros de admissão master na mesma transação PostgreSQL. Outras instâncias consultam esse estado sem cache. O navegador precisa fazer login completo novamente, com MFA para master. A troca de bootstrap `/admin/auth/password` permanece um fluxo separado.

Sem migration, dependência nova, alterações de `.env` ou reaplicação de credenciais de bootstrap. Testes de perfil: `test/profile.test.ts` (PostgreSQL real descartável, duas instâncias); interface integrada em `frontend/tests/integration.spec.ts`.

Validação da entrega em 03/10/2026: lint e build backend/frontend aprovados; 50 testes backend aprovados; 2 testes unitários frontend e 10 testes Playwright aprovados, incluindo API/PostgreSQL reais, cancelamento, falha de reautenticação, edição persistida, troca de senha e novo login. Acessibilidade com axe e largura responsiva foram verificadas também no formulário comum aberto em 320px. Chromium usou as bibliotecas temporárias existentes em `/tmp/login-security-browser-libs/usr/lib/x86_64-linux-gnu` via `LD_LIBRARY_PATH`; a tentativa inicial sem elas não iniciou. A rodada aprovada usou portas isoladas 16630/16631/16640. Imagens Docker não foram reconstruídas nesta entrega.

## Organizações (primeira versão)

Todas as operações exigem a mesma sessão plena master de `/admin/welcome` (senha inicial trocada e TOTP verificado). `Sessions.authorized` centraliza essa política, consumida pelos casos de uso de organizações. Não há outro mecanismo de autenticação. Os módulos compartilham a instância AuthModule e o pool Prisma.

| Método e rota (prefixo `/v1`) | Comportamento |
|---|---|
| GET `/admin/organizations` | Lista `{items,total,page,pageSize}`; query `search`, `status=active/inactive`, `page` (padrão 1), `pageSize` (padrão 10) |
| POST `/admin/organizations` | Cria com `{name}` e estado ativo |
| GET `/admin/organizations/:id` | Retorna organização |
| POST `/admin/organizations/:id` | Atualiza `{name?,active?}`, ao menos um campo obrigatório |

Sucesso 200, entrada inválida 400, sessão não autorizada 401 genérico e organização inexistente/ID inválido 404. POST segue a convenção existente, com Origin exata e JSON; permanecem CSRF, limite de corpo, rate limit e no-store. Erros de dependência continuam sanitizados. O OpenAPI é regenerado com `npm run openapi`.

Nome obrigatório, aparado nas extremidades, de 1 a 200 caracteres; duplicatas aceitas. Página aceita inteiro positivo até 1.000.000, tamanho de 1 a 100; valores fracionários, repetidos, desconhecidos e estados inválidos são rejeitados. Busca por substring literal, sem diferenciar maiúsculas, com até 200 caracteres. Ordenação `createdAt DESC, id DESC`; count e linhas usam o mesmo snapshot RepeatableRead. Páginas além do total retornam lista vazia. A paginação por offset pode deslocar itens entre requisições quando ocorrem inserções concorrentes.

Modelo `Organization`: UUID em texto, name, active (padrão true), createdAt e updatedAt. Migration aditiva `202610030002_organizations`, com índices de ordenação e estado, sem unicidade de nome. A migration posterior de membros acrescenta a relação com User e papéis organizacionais, descritos abaixo. Não há exclusão física de organizações nem convites. Repository contém apenas persistência; validações e autorização ficam em `application/organizations/use-cases`.

Testes em `test/organizations.test.ts` usam PostgreSQL descartável na porta 15443, aplicam as migrations duas vezes e verificam autorização de todas as rotas, CSRF, validação, duplicatas, busca literal, persistência, estado e paginação determinística. Nenhuma migration foi aplicada ao banco real durante o desenvolvimento.

Validação desta implementação (03/10/2026): lint/build backend e frontend aprovados; OpenAPI regenerado; **51/51 testes backend**, **2/2 unitários frontend** e **10/10 Playwright** aprovados. Navegador com API/PostgreSQL reais descartáveis nas portas 17130/17131/17140, incluindo CRUD sem exclusão, busca/filtro, reload e acessibilidade axe em 1440/390/320 px. A primeira rodada identificou composição duplicada do AuthModule, corrigida pelo compartilhamento da mesma instância; o teste de filtro passou a usar o nome acessível do combobox. Nenhuma asserção de autenticação foi removida. Imagens não foram reconstruídas e banco/volumes reais não foram alterados.

## Usuários de organizações

A migration aditiva `202610040001_organization_members` cria `OrganizationRole` e `OrganizationMember`, com chave primária composta `(organizationId, userId)` e default `MEMBER`. Não modifica usuários, sessões ou organizações existentes. Aplicar com `npm run db:migrate` antes de iniciar a nova versão; não foi aplicada automaticamente ao banco real.

`User.master` continua sendo o papel global. `MEMBER` (Membro) e `ORGANIZATION_ADMIN` (Administrador da organização) pertencem apenas ao vínculo. Nenhum papel organizacional concede acesso às operações Master. As operações abaixo exigem sessão plena Master, senha trocada e MFA verificado, reutilizando `Sessions.authorized`; POST preserva Origin/CSRF, JSON, limites e no-store existentes.

Prefixo: `/v1/admin/organizations/:id/members`.

| Método e sufixo | Entrada / saída |
|---|---|
| GET | `{items: [{userId, username, email, role, createdAt}]}` somente da organização indicada |
| POST | Descontinuado: retorna 410; usar convites e aceite do destinatário |
| POST `/:userId` | `{role: "MEMBER" ou "ORGANIZATION_ADMIN"}` altera somente o vínculo indicado |
| POST `/:userId/remove` | `{}` remove logicamente somente o vínculo, mantendo conta, credenciais, sessões e demais organizações |

Sucesso 200; validação 400; autenticação/autorização 401; organização/conta/vínculo ausente 404; duplicidade de vínculo ou identificadores 409; capacidade de hash esgotada 503 com Retry-After. Corpos são estritos: não aceitam `master`, identidade de ator, organizationId adicional ou papéis fora do enum. Identificadores são normalizados NFKC/trim/lowercase no servidor, com limites de usuário 100 e e-mail 254; senha usa a política existente de 15–1024 caracteres, sem normalizar ou truncar.

Novas contas e vínculos usam [convites](../docs/features/organization-invitations.md). O caso de uso `Members` mantém listagem, alteração de cargo, remoção/restauração e recusa provisionamento direto. O repositório aplica o escopo organização/usuário na persistência e descriptografa identidades somente depois da autorização. Contas já existentes com senha temporária preservam o fluxo abaixo.

`test/members.test.ts` cobre gestão de vínculos existentes e fechamento do provisionamento; `test/organization-invitations.test.ts` cobre criação/vínculo mediante aceite, colisões, concorrência, autorização, fila e rollback.

Validação em 04/10/2026: lint e build de ambos os projetos aprovados; Prisma Client e OpenAPI regenerados; **52/52 testes backend**, **2/2 unitários frontend** e **10/10 Playwright** aprovados. Suíte real com API/PostgreSQL descartáveis nas portas 17530/17531/17540, incluindo novos cenários de membros, teclado, axe sem violações e ausência de overflow da página em 1440/390/320 px. As bibliotecas ausentes do Chromium foram extraídas em `/tmp/login-members-browser-libs` e usadas via `LD_LIBRARY_PATH`, sem instalação global. Nenhuma migration foi aplicada ao banco real e nenhuma imagem Docker foi reconstruída. Não há fluxo de convites ou terceiro passo de cadastro para verificar nesta versão.

### Correção: senha temporária e primeiro acesso comum

`ChangeInitialPassword` é compartilhado pelos dois fluxos, com contexto fixado pelo controller: `POST /auth/initial-password` é comum e exige `{password, confirmPassword}`; `POST /admin/auth/password` mantém o contrato Master `{password}`. A validação é estrita e recusa `userId`, `master` ou qualquer identidade enviada pelo cliente. Nova senha deve diferir da anterior. Divergência de confirmação/política retorna 400; sessão inválida, expirada, de outro fluxo/estágio ou senha repetida retorna 401, com `SESSION_REQUIRED` ou `PASSWORD_REUSED` para distinguir a orientação. O endpoint comum não pode usar uma sessão Master; o endpoint Master e suas transições MFA recusam sessões comuns.

No login, `mustChangePassword` comum produz `stage=password` com os mesmos dez minutos das sessões restritas. `Sessions.authorized` recusa qualquer sessão cujo usuário ainda precise trocar senha, mesmo se um registro antigo tiver stage full. Perfil e alterações de conta também recusam esse estado. Sob lock `account:<id>`, a troca relê o token, identidade, expiração, estágio, tipo global, flag e hash observado; só então atualiza o hash/flag, revoga todas as sessões anteriores e emite um novo cookie comum full com `SESSION_HOURS` (8 horas por padrão). Duas trocas concorrentes permitem apenas uma conclusão. A senha temporária deixa de autenticar. A mesma operação Master continua emitindo apenas `setup` e exigindo MFA até a confirmação final.

Sem alteração de schema ou migration nesta correção: `mustChangePassword`, enum e chave composta existentes bastam. Contas já cadastradas com `mustChangePassword=false` permanecem como estão; não há atualização retroativa de senhas ou sessões. Testes usam somente bancos descartáveis. Nenhum dado, volume, migration existente ou configuração real é removido/recriado.

Validação da correção de senha temporária (04/10/2026): lint/build backend e frontend aprovados; OpenAPI regenerado; **55/55 testes backend**, **2/2 unitários frontend** e **10/10 Playwright** aprovados. Testes reais com PostgreSQL descartável verificaram troca comum concorrente (somente uma conclusão), prazo de 8 horas, revogação das sessões antigas, rejeição da senha temporária, separação de Master/MFA, preservação de credenciais ao vincular conta existente e rollback da conta/vínculo na mesma unidade de trabalho. Testes isolados verificaram mudanças de identidade, validade, estágio, papel global, flag e hash durante o processamento. Navegador com API e banco descartáveis nas portas 17630/17631/17640 incluiu o primeiro acesso comum, teclado e axe/responsividade em 1440/390/320 px; fluxo Master existente preservado. Sem nova migration, sem alteração do banco/volume real e sem reconstrução das imagens Docker. E-mail permanece sem verificação de titularidade.

### Mensagens de erro por operação

As respostas continuam usando `message` e os status existentes. Um `code` opcional nas respostas 401 diferencia causas seguras: `PASSWORD_REUSED` (senha nova igual à atual, nos dois primeiros acessos), `REAUTHENTICATION_FAILED` (senha atual não confirmada no perfil/troca), `MFA_INVALID` (código inválido, expirado ou já consumido), `ATTEMPTS_BLOCKED` (orçamento de MFA/perfil bloqueado) e `SESSION_REQUIRED` (sessão ausente, expirada ou sem acesso à operação). A decisão pertence ao caso de uso; o presenter apenas traduz para HTTP. A troca de senha no perfil preserva o erro 400 associado a `newPassword` para senha repetida.

O login mantém mensagem e corpo genéricos para senha incorreta, conta inexistente, tipo incorreto e bloqueio por conta/admissão: não informa a causa individual. O 429 global por IP permite orientar espera sem identificar contas. Colisões na edição do perfil continuam genéricas; gestão de membros mantém as distinções já disponíveis somente ao Master autorizado. Falhas de infraestrutura/capacidade usam 503 e falhas inesperadas 500 sanitizado. Não foram alterados limites, locks, permissões, política de senha ou persistência.

## Permissões organizacionais

Contas comuns autorizadas usam `/v1/organizations`; o namespace `/v1/admin/organizations` mantém a exigência de Master. A listagem de membros agora aceita `search`, `role`, `page`, `pageSize` e inclui `total`, `page`, `pageSize`. `GET /organizations` lista apenas vínculos com acesso; `GET /organizations/:id/access` informa capacidades atuais. Ambos os namespaces oferecem `GET/POST /:id/permissions`; POST aceita `{role: "MEMBER", permissions: [...]}` com catálogo fechado. Administradores têm acesso geral imutável; o último administrador não pode ser removido/rebaixado (409), inclusive pelo Master.

Migration aditiva `202610040002_organization_permissions`; aplicar com `npm run db:migrate` antes de executar a nova API, sem reset. A ausência de concessões mantém MEMBER sem permissões. Organizações sem administrador continuam sob o Master até designação explícita do primeiro; a migration não promove usuários. Leia [o modelo e as garantias de concorrência](../docs/features/organization-permissions.md). Testes usam PostgreSQL descartável adicional na porta 15446.

## Infraestrutura opcional de fila de e-mail

`EMAIL_QUEUE_ENABLED=false` é o padrão: não há conexão nem requisito de Redis nos testes e no desenvolvimento nativo. Para habilitar, use `true`, `REDIS_HOST`, `REDIS_PORT` (padrão 6379) e `REDIS_PASSWORD` com 64 dígitos hexadecimais aleatórios. O Compose fornece essa configuração. Credenciais inválidas falham com mensagem sanitizada; indisponibilidade de Redis não bloqueia inicialização, health check ou login.

A fila `email` tem consumo SMTP opcional; o único produtor atual atende à verificação opcional de e-mail, sem endpoint genérico de envio. `npm run test:queue` verifica integração com um Redis Docker descartável; é separado de `npm test`, que não exige Redis. Não usa volumes reais. Consulte [a decisão e os limites operacionais](../docs/architecture/email-queue.md).

### Consumo e entrega SMTP

`EMAIL_DELIVERY_ENABLED=false` mantém o consumidor desligado, sem simular envio. Ativar requer fila habilitada e `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. Use TLS direto (`SMTP_SECURE=true`, normalmente porta 465) ou STARTTLS obrigatório (`false`, normalmente 587); certificados são verificados. Nenhuma credencial é lida de jobs.

O job `email.send` versão 1 aceita somente `correlationId`, `to`, `subject`, `text`, além de `version`. Apenas mensagens não sensíveis; nenhum fluxo de autenticação deve usar esse payload. O consumidor chama `DeliverEmail` e a porta `EmailSender`, implementada por `SmtpSender`. Erros permanentes não são repetidos; transitórios respeitam as opções do job. Não havia retry/backoff configurado: o padrão de uma tentativa permanece. SMTP pode duplicar entregas; Message-ID estável não garante idempotência. Limites e retenção estão na [documentação do contrato](../docs/architecture/email-queue.md).

Verificação focada desta camada: `npx tsx --test test/email-delivery.test.ts`, `npm run lint`, `npm run build`. Os testes de entrega usam fakes; não enviam e-mails, não sobem containers e não executam autenticação/organizações/frontend.

## Verificação opcional de e-mail

Perfil e início exibem estado/aviso sem restringir acesso. A confirmação usa código com desafio persistente, fila cifrada e sender existente. [API, migration, controles e comandos de validação focada](../docs/features/email-verification.md). Os testes usam filas e senders falsos; não executar SMTP real automaticamente.

## Exclusão lógica de organizações e vínculos

A migration aditiva `202610130001_organization_soft_deletion` acrescenta `deletedAt` nullable às organizações e aos vínculos, preservando dados e constraints anteriores. Aplicar pelo fluxo `npm run db:migrate` antes de iniciar a versão nova; não foi aplicada ao ambiente real. Excluir organização define `active=false`; restaurar define `active=true`. Consultas normais, contagens e autorização ignoram excluídos.

Master usa `POST /v1/admin/organizations/:id/remove`, `/:id/restore` e `/:id/members/:userId/restore`, todos com `{}`. Listas administrativas aceitam `deleted=true` para consultar somente excluídos/removidos. A remoção de vínculo existente agora é lógica e preserva a permissão documentada `members.remove` e a proteção do último administrador. Revincular um registro removido retorna 409 com orientação de restauração. [Contrato completo e verificações focadas](../docs/features/organization-deletion.md).

## Área do administrador organizacional

O diretório comum e `/:id/access` retornam `role` e `userId` do ator autenticado para compor o destino e a interface. Contas comuns exigem organização ativa, não excluída e vínculo não removido, com permissão atual em cada operação. `organization.update` autoriza editar nome; escrever `active` é exclusivo do Master. Administrador não pode remover/rebaixar o próprio vínculo, além da proteção existente do último administrador. Papéis e concessões de Member permanecem no escopo organizacional. Sem migration ou variável nova. [Contrato, segurança e testes focados](../docs/features/organization-administration.md).

## Convites para organizações

Novas associações exigem aceite do destinatário. `POST /v1/{admin/}organizations/:id/members` está descontinuado e retorna 410; não cadastra contas nem vincula diretamente, inclusive para Master. Contas antigas e seu primeiro acesso com senha temporária permanecem suportados.

Use `/v1/{admin/}organizations/:id/invitations` para emitir/listar, `/:invitationId/resend` e `/revoke` para gerir. `POST /v1/invitations/preview` não consome; `/accept` cria conta/vínculo atomicamente ou exige a sessão plena comum correspondente. Não cria sessão automaticamente. Fila e SMTP precisam estar habilitados para enfileirar. Migration aditiva `202610140001_organization_invitations`; nenhum dado antigo é alterado. [Ciclo de vida, permissões, limites, contratos e validação focada](../docs/features/organization-invitations.md).

A listagem de convites retorna `{items,total,page,pageSize,counts}`, com busca parcial por e-mail, filtro `all|pending|expired|accepted|revoked` e paginação validada. Consulta apenas a organização autorizada; busca e contagens são feitas na aplicação após decifrar os campos necessários, sem índice em texto puro. Cada item informa criador real e `deliveredAt` nullable, sem segredos. São emissões atuais, não histórico. Cancelar convite administrativo exige `members.roles`, assim como emitir/reenviar. Consulte os [limites e campos completos](../docs/features/organization-invitations.md#consulta-das-emissões-atuais). Nenhuma migration foi adicionada para essa consulta.

## Auditoria persistente

A migration aditiva `202610150001_audit` cria eventos de segurança/administração e marcação de expiração auditada dos convites. Execute `npm run db:generate` e aplique `npm run db:migrate` antes da implantação; não use reset. Nenhum ambiente real é migrado automaticamente nesta entrega.

Os casos de uso gravam sucessos na mesma transação da operação; recusas relevantes têm gravação tolerante a falha. IDs e metadados são cifrados pelo Vault existente, sem nomes, e-mails, credenciais, IP ou payloads. A consulta Master está disponível em `/v1/admin/audit` e `/v1/admin/audit/:id`, sem ampliar permissões organizacionais. A manutenção horária observa até 500 convites expirados por ciclo. Consulte [classificação dos dados, catálogo, garantias e limitações](../docs/security/audit.md), incluindo SMTP/fila, ausência de imutabilidade contra acesso direto ao banco e decisões pendentes de retenção, titulares e consulta.

Validação focada: `npm run lint`, `npm run build` e `npx tsx --test --test-concurrency=1 test/audit.test.ts test/auth.test.ts test/profile.test.ts test/organization-invitations.test.ts test/email-verification.test.ts test/organization-deletion.test.ts test/organization-permissions.test.ts test/organization-admin.test.ts test/repositories.test.ts test/application.test.ts test/architecture.test.ts`. As fixtures aplicam/reaplicam migrations em bancos descartáveis; não usam SMTP real.

### Consulta de auditoria do Master

`GET /v1/admin/audit` aceita `from`/`to` ISO 8601 com fuso (inclusive), `action`, `outcome=success|failure`, `page` e `pageSize` (padrão 10, máximo 100). Retorna página ordenada por instante/ID decrescentes e catálogo de rótulos. `GET /v1/admin/audit/:id` retorna detalhe com metadados apresentados por rótulo/valor. Ambas exigem sessão plena Master; conta organizacional é recusada. Não há filtro de ator, exposição de e-mails, IDs pessoais ou envelope cifrado nos eventos. Nomes são atuais, sem reconstrução histórica. O filtro de organização e sua migration estão descritos abaixo. Contrato no OpenAPI e [regras completas](../docs/security/audit.md#api-e-apresentação).

Validação focada: `npx tsx --test --test-concurrency=1 test/audit-query.test.ts test/architecture.test.ts`, `npm run lint`, `npm run build`, `npm run openapi`.

### Filtro de organização na auditoria

`GET /v1/admin/audit` aceita `organizationId` (UUID ativo); sem o parâmetro inclui também eventos sem organização. `GET /v1/admin/audit/organizations` fornece opções mínimas `{id,name}`, paginadas, exclusivamente ao Master. Organização indisponível retorna 409 sem ampliar resultados. A migration `202610150002_audit_organization_index` acrescenta índice HMAC; `main.ts` indexa o histórico em lotes antes de abrir a porta HTTP. Parar instâncias/workers antigos antes da implantação. [Detalhes de implantação e proteção](../docs/security/audit.md#índice-de-organização-e-implantação).

### Auditoria organizacional e vínculo único

Contas comuns têm no máximo um vínculo não removido, seja Member ou administrador. Aceite de convite e restauração verificam o limite na transação sob lock da conta; o índice parcial no PostgreSQL garante unicidade. Master mantém acesso global sem depender de vínculo.

`/v1/audit/access`, `/v1/audit` e `/v1/audit/:id` derivam o escopo do único vínculo administrativo atual. Não existe endpoint de seleção. Aplicar `202610150005_single_organization` e gerar Prisma Client antes de iniciar a nova versão. Duplicidades interrompem a migration sem resolução automática. Colunas de contexto são removidas explicitamente, sem revogar sessões. [Contrato, pré-validação e implantação](../docs/security/audit.md#vínculo-único-e-implantação).

## Administradores delegados da plataforma

Master pode emitir convites e conceder permissões globais explícitas em `/v1/admin/platform-admins`. Delegados usam o login administrativo existente, com MFA obrigatório, `master=false`, sem organização e `accountType=platform-admin`. O login comum os recusa; permissões organizacionais não concedem acesso global. O catálogo inclui organizações (consulta/criação/edição/estado/exclusão lógica) e `audit.read`, sem concessões padrão. Mudanças revogam sessões e auditam atomicamente. Gestão de membros/cargos organizacionais não é delegada nesta versão.

A migration aditiva `202610160001_platform_admin` deve preceder a API. Não aplicar em banco real para validar a tarefa. [Contratos, locks, limites de envio, implantação e verificações focadas](../docs/features/platform-administrators.md). Novo teste: `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npx tsx --test test/platform-admin.test.ts` (PostgreSQL descartável, porta 15457).

## Listagem e redefinição de MFA

A listagem organizacional inclui organização, estado do vínculo, senha/TOTP e último login concluído (`lastLoginAt`, nullable). O Master pode redefinir MFA de outra conta com senha atual e TOTP novo em `/v1/admin/accounts/:id/mfa/reset`; revogação de fatores, sessões e dispositivos e evento `account.mfa_reset` são atômicos. Delegados precisam configurar e confirmar MFA novamente. [Contrato, migration aditiva e verificações focadas](../docs/features/member-security.md).
