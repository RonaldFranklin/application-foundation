# Usuários, cargos e permissões por organização

## Autoridade e acesso

`MASTER` é global e continua usando `/admin/organizations` e `/v1/admin/organizations`. Contas comuns usam `/organizations` e `/v1/organizations`. O namespace administrativo exige Master mesmo que a conta comum seja administradora organizacional. O login, a senha temporária e o logout mantêm seus fluxos; cargos organizacionais não modificam `User.master`.

`ORGANIZATION_ADMIN` possui todas as permissões do catálogo, como política fixa da aplicação. `MEMBER` não recebe nenhuma por padrão. Concessões são por organização e se aplicam a todos os membros desse cargo. Ausência de linhas representa nenhuma concessão; por isso o default é seguro para organizações existentes e novas.

| Permissão | Operação existente |
|---|---|
| `organization.read` | Consultar detalhes |
| `organization.update` | Editar nome e ativar/desativar |
| `members.read` | Consultar membros, buscar, filtrar e paginar |
| `members.create` | Cadastrar conta com senha temporária e vínculo |
| `members.link` | Vincular conta comum existente |
| `members.roles` | Alterar cargos e designar administradores |
| `members.remove` | Remover vínculo, preservando a conta |
| `permissions.manage` | Consultar e configurar concessões de MEMBER |

Conceder `members.roles` permite promover membros a administrador; `permissions.manage` permite alterar as concessões do cargo Membro. A interface explica esses efeitos. Criar/vincular diretamente um administrador exige também `members.roles`, evitando promoção indireta por uma permissão de cadastro isolada. O corpo de permissões aceita somente `role: MEMBER` e chaves únicas do catálogo; Master, cargos customizados e redução do acesso do administrador são rejeitados.

`OrganizationAccess` verifica sessão plena, validade, estágio, tipo de conta, vínculo e permissões atuais em cada operação. Contas sem concessões não recebem organizações no diretório e não acessam páginas/endpoints organizacionais; as áreas pessoais e os mecanismos de autenticação continuam independentes. O diretório retorna apenas organizações com acesso atual. O endpoint `/:id/access` retorna nome, estado e capacidades para composição da página; os detalhes e a lista de usuários mantêm verificações próprias. Fora do vínculo, IDs existentes e inexistentes retornam a mesma recusa, sem detalhes de outras organizações. SSR também consulta a API antes de renderizar páginas comuns; controles visuais não são autoridade.

## Consistência e migração

Migration aditiva: `202610040002_organization_permissions`. Cria enum de permissões e `OrganizationPermissionGrant`, com chave composta organização/cargo/permissão, chave estrangeira e CHECK que só permite linhas de `MEMBER`. Administradores não têm concessões editáveis persistidas. Nenhum dado ou cargo existente é sobrescrito e nenhum usuário é promovido automaticamente.

Todas as alterações de organização, cargos, vínculos e permissões usam o lock transacional `organization:<id>`. Autorização e proteção do último administrador são reavaliadas sob esse lock. Ao remover/rebaixar um administrador, o caso de uso conta os administradores e recusa a alteração com 409 se houver apenas um. A proteção vale também para Master e para operações em réplicas diferentes. Cadastro faz Argon2 fora da transação, depois readquire o lock e revalida autorização antes de persistir; o lock de identidade vem depois do lock de organização. Repositories executam persistência e contagens, sem decidir políticas.

Organizações sem administrador, inclusive as criadas pelo fluxo Master anterior, ficam sob administração global até o Master designar o primeiro administrador comum. Essa designação é explícita; a migration não escolhe uma pessoa nem transforma o Master em membro. Uma vez designado, o último administrador não pode ser removido ou rebaixado.

Aplicar a migration no ambiente de destino com o procedimento operacional habitual antes de publicar a API. Nesta entrega, migrations são aplicadas somente a bancos descartáveis de teste.

## Listagem e interface

A listagem usa somente usuário, e-mail, cargo e ações. Não há avatar, Teams, convites, última atividade, status de conta ou MFA exposto. Busca por usuário/e-mail e filtro por cargo têm paginação de 5, 10, 25, 50 ou 100 itens. A API recebe `search`, `role`, `page`, `pageSize` e responde `{items,total,page,pageSize}`.

Identidades são cifradas: a busca por substring é feita na aplicação após carregar e decifrar somente os membros da organização autorizada; o resultado é filtrado e paginado antes da resposta. A ordem estável usa criação e ID. Esse mecanismo simples não é adequado a organizações com milhões de vínculos; um índice de busca seguro exigiria uma decisão separada, sem gravar identidades em texto puro.

As três abas usam URL e links Next, mantendo recarga e histórico. Menus nativos funcionam com Enter/Espaço, Tab, Escape e clique externo. Cadastro, vínculo e edição preservam validações, mensagens, senha temporária, foco e estados de carregamento. A configuração mostra acesso protegido do administrador e checkboxes somente para concessões conhecidas do Membro. A tabela tem rolagem interna em telas estreitas.

## Validação

Testes de API cobrem defaults, autorização atual, isolamento, filtros, paginação, catálogo, rejeição de Master, cadastro sem promoção indireta e proteção concorrente do último administrador entre duas instâncias. Testes de navegador exercitam Master, administrador organizacional e Membro; concessão/revogação sem novo login; formulário, menus, filtros, paginação, reload, teclado e axe em 1440/390/320 px. Os resultados da execução são informados na entrega; este texto descreve a cobertura, não substitui a execução.
