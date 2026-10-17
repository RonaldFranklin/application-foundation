# Usuários, cargos e permissões por organização

## Autoridade e acesso

`MASTER` é global e continua usando `/admin/organizations` e `/v1/admin/organizations`. Contas comuns usam `/organizations` e `/v1/organizations`. O namespace administrativo exige Master mesmo que a conta comum seja administradora organizacional. O login, a senha temporária e o logout mantêm seus fluxos; cargos organizacionais não modificam `User.master`.

`ORGANIZATION_ADMIN` possui todas as permissões organizacionais delegáveis do catálogo, como política fixa da aplicação. `MEMBER` não recebe nenhuma por padrão. Concessões são por organização e se aplicam a todos os membros desse cargo. Ausência de linhas representa nenhuma concessão; por isso o default é seguro para organizações existentes e novas.

| Permissão | Operação existente |
|---|---|
| `organization.read` | Consultar detalhes |
| `organization.update` | Editar nome; ativação/desativação exclusiva do Master |
| `members.read` | Consultar membros, buscar, filtrar e paginar |
| `members.create` | Emitir convites de MEMBER em conjunto com `members.link` |
| `members.link` | Emitir convites de MEMBER em conjunto com `members.create` |
| `members.remove` | Remover logicamente vínculo de MEMBER, preservando a conta |
| `permissions.manage` | Consultar e configurar concessões de MEMBER |

Somente a identidade Master persistida pode promover, rebaixar, remover ou restaurar `ORGANIZATION_ADMIN`. `members.roles` não é mais delegável e não aparece na matriz: a API rejeita sua concessão inclusive por Master. `permissions.manage` permite somente as sete concessões de MEMBER e não oferece promoção indireta. O corpo aceita apenas `role: MEMBER`, chaves únicas e campos conhecidos. O catálogo histórico conserva a chave antiga somente para decodificar auditoria e manter compatibilidade do enum persistido.

`OrganizationAccess` verifica sessão plena, validade, estágio, tipo de conta, vínculo e permissões atuais em cada operação. Contas comuns exigem organização ativa e não excluída. Contas sem concessões não recebem organizações no diretório e não acessam páginas/endpoints organizacionais; as áreas pessoais e os mecanismos de autenticação continuam independentes. O diretório retorna apenas organizações com acesso atual. O endpoint `/:id/access` retorna nome, estado, papel e ID do ator autenticado, além das capacidades para composição da página; os detalhes e a lista de usuários mantêm verificações próprias. Fora do vínculo, IDs existentes e inexistentes retornam a mesma recusa, sem detalhes de outras organizações. SSR também consulta a API antes de renderizar páginas comuns; controles visuais não são autoridade.

## Consistência e migração

Migration aditiva: `202610040002_organization_permissions`. Cria enum de permissões e `OrganizationPermissionGrant`, com chave composta organização/cargo/permissão, chave estrangeira e CHECK que só permite linhas de `MEMBER`. Administradores não têm concessões editáveis persistidas. Nenhum dado ou cargo existente é sobrescrito e nenhum usuário é promovido automaticamente.

Todas as alterações de organização, cargos, vínculos, convites e permissões compartilham o lock transacional `organization:<id>`. A identidade, sessão, papel anterior e papel solicitado são revalidados no caso de uso sob esse lock. Remoção de administrador e qualquer alteração de papel exigem Master, mesmo com grants antigos ou URL alternativa. Mutações e auditoria confirmam juntas. Repositórios persistem dados sem decidir autorização.

O Master pode remover ou rebaixar inclusive o último administrador. Uma organização sem administrador fica sob administração global até o Master designar outro por promoção, restauração ou convite. Não há designação automática nem exclusão da organização.

Aplicar a migration no ambiente de destino com o procedimento operacional habitual antes de publicar a API. Nesta entrega, migrations são aplicadas somente a bancos descartáveis de teste.

## Listagem e interface

A listagem apresenta iniciais, usuário/e-mail, cargo, organização validada, estado do vínculo, senha/TOTP e último login concluído. Convites permanecem separados. Consulte o [contrato e a redefinição de MFA](member-security.md). Busca por usuário/e-mail e filtro por cargo têm paginação de 5, 10, 25, 50 ou 100 itens. A API recebe `search`, `role`, `page`, `pageSize` e responde `{items,total,page,pageSize}`.

A referência visual de membros é adaptada com usuário e e-mail na mesma célula, linhas compactas, cargo em badge e menu de reticências. Administrador tem um destaque violeta discreto, acompanhado do nome completo do cargo; a informação não depende da cor. Busca, filtro e paginação permanecem controles reais, com rótulos acessíveis.

Identidades são cifradas: a busca por substring é feita na aplicação após carregar e decifrar somente os membros da organização autorizada; o resultado é filtrado e paginado antes da resposta. A ordem estável usa criação e ID. Esse mecanismo simples não é adequado a organizações com milhões de vínculos; um índice de busca seguro exigiria uma decisão separada, sem gravar identidades em texto puro.

As três abas usam URL e links Next, mantendo recarga e histórico. Menus nativos funcionam com Enter/Espaço, Tab, Escape e clique externo. Cadastro, vínculo e edição preservam validações, mensagens, senha temporária, foco e estados de carregamento. A configuração usa uma matriz semântica compacta com as sete permissões delegáveis nas linhas e os dois cargos nas colunas. O cabeçalho apresenta contagens reais e estado de edição; a faixa de escopo resume as concessões por cargo. As flags do administrador são marcadas, desabilitadas e identificadas como fixas. Flags do Membro têm rótulos com cargo e permissão, estado textual e indicação de alteração pendente. Salvar alterações usa uma única chamada em lote; Descartar restaura o último estado carregado ou salvo. O catálogo não define categorias, portanto não são criadas abas artificiais. A tabela tem rolagem interna em telas estreitas, foco visível e controles nativos operáveis por teclado. Descrições de cadastro/vínculo explicam a exigência conjunta no fluxo de convites atual, sem alterar as chaves ou rótulos do catálogo.


## Validação

Testes de API cobrem defaults, autorização atual, isolamento, filtros, paginação, catálogo, rejeição de Master, cadastro sem promoção indireta e autorização exclusiva do Master entre duas instâncias. Testes de navegador exercitam Master, administrador organizacional e Membro; concessão/revogação sem novo login; formulário, menus, filtros, paginação, reload, teclado e axe em 1440/390/320 px. Os resultados da execução são informados na entrega; este texto descreve a cobertura, não substitui a execução.

## Exclusão lógica

Vínculos removidos e organizações excluídas deixam de conceder acesso. A permissão `members.remove` continua válida, agora com preservação do vínculo; restauração e consulta de removidos são exclusivas do Master. Somente Master remove administradores, inclusive o último. [Contrato e operação](organization-deletion.md).

## Entrada administrativa e proteção do próprio acesso

Após login, um administrador de uma organização entra diretamente nos detalhes; com várias, escolhe somente entre as que administra. Administrador não pode remover/rebaixar o próprio vínculo nem ativar/desativar organizações. Member mantém apenas concessões explícitas. [Comportamento e verificações](organization-administration.md).

## Entrada por convite

Cadastro e vínculo diretos foram descontinuados. Novas associações usam convites e aceitação: emissão/gestão exigem `members.create` e `members.link` juntas; designar administrador exige identidade Master persistida; listagem exige `members.read`. [Regras atuais](organization-invitations.md).

## Extensão de acesso global

Administradores delegados agora podem operar organizações pelo namespace administrativo com concessões globais específicas, distintas deste catálogo. Eles não têm vínculo nem acesso a membros/cargos/convites organizacionais. Administrador organizacional continua sem acesso global. [Catálogo e limites da delegação](platform-administrators.md).

## Atualização de segurança: autoridade do Master

Migration `202610170001_master_organization_admin`: revoga exclusivamente grants `members.roles`, acrescenta CHECK para impedir sua reintrodução e revoga convites administrativos não aceitos/não revogados cujo emissor não é Master. Preserva demais permissões, vínculos, convites aceitos e histórico. A aplicação também ignora grants legados e rejeita o aceite de convite administrativo sem emissor Master, independentemente da limpeza. A chave histórica continua válida na leitura de eventos antigos.

Implantação: parar versões antigas e workers, aplicar `npm run db:migrate`, iniciar somente a nova versão. Não executar a API antiga em paralelo. A migration não cria eventos retroativos para a limpeza; mudanças de produto continuam auditadas transacionalmente. Não exige segredos novos nem reset de banco.

## Validação da correção (17/10/2026)

Executados nesta alteração: geração Prisma/OpenAPI, lint e build de backend/frontend; 34 testes backend em 11 arquivos, incluindo autorização HTTP, aliases/casing, grants legados, migration sobre estado antigo, aceite/revogação concorrentes, rollback de auditoria e regressões de MFA/sessões. Todos passaram na rodada final.

No navegador, passaram os 20 testes distintos da configuração invitations (a matriz foi repetida após atualizar a expectativa de oito para sete permissões) e quatro de `playwright.organizations.config.ts admin.spec.ts`, com API/PostgreSQL descartáveis. A fixture antiga de navegador foi ajustada para respeitar o vínculo único existente, sem retirar a constraint. Saída em `/tmp`, com bibliotecas locais do Chromium via `LD_LIBRARY_PATH`. Nenhuma suíte completa da aplicação foi executada, nenhuma migration foi aplicada ao banco ativo e nenhum container foi atualizado.
