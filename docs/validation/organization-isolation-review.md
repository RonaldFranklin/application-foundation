# Auditoria de isolamento organizacional — 14/10/2026

## Escopo e resultado

Revisão da implementação atual, na branch existente, sem alterações locais prévias. Foram rastreados controllers, contexto HTTP, autorização nos casos de uso, portas e implementações Prisma. A identidade vem exclusivamente do cookie opaco e da sessão/conta persistidas. Não há guard Nest de autorização organizacional: essa responsabilidade está em `Sessions.authorized` e `OrganizationAccess.check`, chamados pelos casos de uso.

Foi encontrada e corrigida uma inconsistência no reconhecimento do namespace administrativo. Express aceita caminhos sem distinguir maiúsculas; `masterOrganizationRoute` comparava `/v1/admin/` com distinção. Assim, `GET /V1/ADMIN/organizations` com sessão organizacional retornava 200 e o diretório comum, em vez de 401. Detalhes, membros e permissões também podiam usar as capacidades organizacionais no namespace reservado ao Master. Isso não removia a verificação de vínculo nem concedia acesso global, mas violava o contrato de separação dos namespaces.

A comparação agora normaliza maiúsculas como o roteador. A regra de autorização permanece nos casos de uso. O teste de regressão falhou antes da correção (`200 !== 401`) e cobre listagem, acesso, detalhes, membros, cargos, remoção e permissões, além da leitura e edição Master de duas organizações com URLs de grafias diferentes.

## Inventário dos caminhos

Todos os caminhos abaixo têm prefixo `/v1`. `{admin/}` significa que ambos os namespaces foram inspecionados.

| Rotas | Caminho e evidência de isolamento |
|---|---|
| GET `/admin/organizations` | `OrganizationsController → Organizations.list → Sessions.authorized(true) → PrismaOrganizationsRepository.list`. Consulta global exclusiva do Master; filtros e contagem no banco. |
| GET `/organizations` | `OrganizationsController → OrganizationAccess.directory → Sessions.authorized(false) → members.memberships(userId) → check`. Consulta inicial filtrada por usuário e vínculos não removidos no banco; só retorna organizações ativas, não excluídas e com capacidades atuais. Query e headers não escolhem o ator nem ampliam escopo. |
| POST `/{admin/}organizations` | `Organizations.create → authorized(true) → organizations.create`. Criação global exclusiva do Master, corpo estrito. |
| GET `/{admin/}organizations/:id` e `/:id/access` | `Organizations.read`/`OrganizationAccess.describe → access.run/check → sessions, members.role, permissions.list, organizations.find`. Papel persistido no vínculo exato; leitura exige `organization.read`, descrição exige alguma capacidade. ID estrangeiro e inexistente retornam a mesma recusa para conta comum. |
| POST `/{admin/}organizations/:id` | `Organizations.update → access.run/check → organizations.update`. `organization.update` permite nome no próprio escopo; `active` continua exclusivo do Master. Corpo não aceita troca de organização/ator. |
| POST `/{admin/}organizations/:id/remove` e `/restore` | `Organizations.setDeleted → access.run/check(masterOnly=true) → organizations.update`. Exclusão lógica/restauração globais; sem remoção física de dados. |
| GET `/{admin/}organizations/:id/members` | `Members.list → access.run/check(members.read) → PrismaMembersRepository.list`. Filtro de organização aplicado antes de carregar/decifrar identidades; busca e paginação apenas nesse conjunto. Listagem de removidos exclusiva do Master. |
| POST `/{admin/}organizations/:id/members` | `Members.add → check → validação/permissões → hashing → run/check → identities/members`. Cadastro/vínculo exigem capacidades próprias; promoção exige também `members.roles`. Cadastro fixa `master=false`; vínculo busca somente conta comum por e-mail exato. Revalida autorização após hashing, antes de persistir conta e vínculo atomicamente. |
| POST `/{admin/}organizations/:id/members/:userId` e `/remove` | `Members.update → run/check → members.role/countAdmins/update/setDeletedAt`. Leitura e escrita usam organização + usuário; ID de membro de B não altera B pelo caminho de A. Preserva último administrador e proteção do próprio vínculo. |
| POST `/{admin/}organizations/:id/members/:userId/restore` | `Members.restore → run/check(masterOnly=true) → members.find/setDeletedAt`, sempre com chave composta. |
| GET/POST `/{admin/}organizations/:id/permissions` | `Permissions.execute → run/check(permissions.manage) → PrismaPermissionsRepository.list/replace`. Consulta, exclusão e inclusão de concessões filtradas por organização e cargo MEMBER, na mesma transação. Catálogo fechado, sem papel Master ou cargo customizado. |

`OrganizationAccess.run` e `PrismaUnitOfWork` mantêm autorização e operações por ID sob o mesmo advisory lock transacional `organization:<UUID normalizado>`. Alterações de organização, vínculos e concessões compartilham esse lock, inclusive entre réplicas. O diretório é uma leitura de vínculos, não uma concessão reutilizável de acesso: cada chamada posterior revalida autorização. Não foram introduzidos RBAC genérico, novas permissões ou novos contratos de repositório.

## Áreas adjacentes

- Autenticação, estado/logout de sessão, primeiro acesso, MFA, boas-vindas, perfil/senha e verificação de e-mail não recebem um contexto organizacional autorizador. Sessão e casos de uso selecionam a própria conta; alteração de vínculo não altera `User.master`. Perfil e verificação usam ID da sessão na persistência. A revisão dessas áreas foi estática, focada na seleção de identidade e ausência de escopo organizacional controlado pelo cliente.
- Frontend: páginas `/organizations`, `/organizations/[id]`, `/admin/organizations` e `/admin/organizations/[id]`, serviços `access.server.ts`, `welcome.server.ts` e `api.ts`. SSR consulta a API com cookie e `no-store`; capacidades visuais não substituem autorização de cada chamada. Nenhuma alteração de frontend foi necessária.
- Não há convites, cargos customizados, endpoint independente de usuários globais, recursos de negócio adicionais por organização ou mutações de múltiplas organizações. Substituição de concessões é o lote existente e permanece restrita à organização autorizada.
- Uma conta pode ter vínculos em várias organizações; acesso exige vínculo/capacidade em cada alvo. Vincular uma conta comum existente pelo e-mail exato é capacidade já prevista, não autorização para consultar ou alterar seus outros vínculos. MEMBER sem concessões continua sem administração; concessões explícitas já existentes foram preservadas.

## Arquivos e contratos

- `backend/src/presentation/http/organization-scope.ts`: normalização da identificação do namespace.
- `backend/test/organization-admin.test.ts`: regressão de maiúsculas e cobertura adicional de URL/query/body/headers, usuário sem vínculo e IDs de membros estrangeiros.
- Este relatório e `docs/README.md`: registro e índice.

Sem mudanças de payload, schema, migrations, dependências ou OpenAPI. Respostas existentes preservadas: 401 para sessão/contexto Master inválido, 403 para escopo/capacidade negados, 400 para corpo/query estritos inválidos e 404 para vínculo ausente no escopo autorizado.

## Verificação executada

Comandos executados em `backend/`, com fixtures sintéticas e PostgreSQL descartável, sem credenciais reais, SMTP ou alteração de banco existente:

```bash
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npx tsx --test --test-concurrency=1 \
  test/organization-admin.test.ts test/organization-permissions.test.ts \
  test/organization-deletion.test.ts test/organization-contract.test.ts \
  test/organizations.test.ts test/members.test.ts
npm run lint
npm run build
```

Resultado: **18/18 testes aprovados**, sem falhas ou testes ignorados; **lint e build aprovados**. A cobertura inclui Master em organizações distintas, administrador no próprio escopo, bloqueio de acesso cruzado, listagens sem dados estrangeiros, usuário sem vínculo/capacidade, rejeição de Master nos corpos e concorrência entre réplicas. Uma tentativa inicial a partir da raiz falhou antes dos testes por não carregar o tsconfig do backend (decorators); o comando foi corrigido para executar dentro de `backend/`.

Não foram executados suíte geral, Playwright, testes de carga, deploy ou sondagens de produção. Os testes HTTP exercitam API e persistência reais descartáveis, mas não substituem validação do proxy/hosting de produção. Sem commit ou push.
