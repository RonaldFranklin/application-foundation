# Application Foundation API

Projeto NestJS/TypeScript independente. Node 24.16 LTS; Prisma 7.10 com adapter `pg`. A API é a autoridade para todos os estados de autenticação. Cadastro de contas comuns é restrito ao Master no contexto de organizações. Não há OAuth, recuperação de senha ou RBAC geral.

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
- Eventos de segurança possuem apenas nome do evento e fluxo; não contêm identificador, IP bruto, senha, cookie, token ou código. Não habilitar query logging ou request/body logging no proxy sem redigir esses dados.
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
| POST | `{mode: "new", username, email, password, role?}` cria conta comum e vínculo atomicamente; `{mode: "existing", email, role?}` vincula conta comum existente pelo e-mail exato normalizado |
| POST `/:userId` | `{role: "MEMBER" ou "ORGANIZATION_ADMIN"}` altera somente o vínculo indicado |
| POST `/:userId/remove` | `{}` remove somente o vínculo, mantendo conta, credenciais, sessões e demais organizações |

Sucesso 200; validação 400; autenticação/autorização 401; organização/conta/vínculo ausente 404; duplicidade de vínculo ou identificadores 409; capacidade de hash esgotada 503 com Retry-After. Corpos são estritos: não aceitam `master`, identidade de ator, organizationId adicional ou papéis fora do enum. Identificadores são normalizados NFKC/trim/lowercase no servidor, com limites de usuário 100 e e-mail 254; senha usa a política existente de 15–1024 caracteres, sem normalizar ou truncar.

Não havia convites nem serviço de e-mail neste projeto. O cadastro usa senha temporária informada pelo Master, com o mesmo Argon2id e limitador de trabalho da autenticação; cria a conta com `master: false` e `mustChangePassword: true`, sem gerar senha, sessão ou cookie para ela. O Master entrega as credenciais por um canal combinado. O usuário entra por `/login` e precisa trocar a senha antes de acessar a aplicação. Não há envio de e-mail nem verificação de posse. O modo existente nunca redefine credenciais e recusa contas Master. Colisões entre os dois namespaces de identidade são serializadas com o mesmo advisory lock `identity-update` usado por bootstrap/edição de perfil. O caso de uso `Members` decide entre cadastro e vínculo, valida a identidade comum pelo e-mail exato, trata colisões e interpreta contagens de persistência. A criação da conta e vínculo usa a unidade de trabalho existente (`AUTH_WORK`), cujo contrato aceita a extensão transacional de membros. `PrismaMembersRepository` apenas lista, consulta existência, insere, atualiza e remove dados, sem escolher o fluxo ou produzir resultados de negócio. Chave composta e `createMany(skipDuplicates)` tratam vínculos concorrentes sem duplicação. Listagem seleciona somente dados de apresentação e descriptografa após autorização.

`test/members.test.ts` cobre ambos os papéis, default, login da conta criada, alteração, remoção sem apagar conta/sessão, isolamento entre duas organizações, duplicidade e concorrência, colisões de identificadores, rejeição de Master como membro, papéis arbitrários, CSRF, sessão restrita/expirada/revogada e acesso comum inclusive quando administrador organizacional.

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
