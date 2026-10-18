# Área do administrador organizacional

## Entrada e navegação

O item da navegação principal se chama **Organização** nos contextos Master e comum; títulos de listagens e breadcrumbs de retorno mantêm **Organizações**.

O login comum preserva o fluxo de autenticação. Ao renderizar `/` ou `/organizations`, a interface entra diretamente na única organização autorizada, tanto para administrador quanto para membro com permissões. Não há seleção/troca organizacional nem contexto na sessão. Sem vínculo ou com múltiplos vínculos inconsistentes, nenhuma organização é exibida. O backend valida o vínculo atual e as permissões em cada operação; IDs de rota não concedem acesso. [Regra de vínculo único e implantação](../security/audit.md#vínculo-único-e-implantação).

Sem vínculo administrativo, a conta mantém as áreas pessoais. Acesso organizacional concedido explicitamente a Member continua seguindo as permissões existentes; Member sem concessões não vê o item Organização nem acessa as abas. Uma tentativa direta sem acesso apresenta estado seguro, sem nome/dados da organização. Falha de consulta é distinguida de acesso negado e oferece nova tentativa, sem renderizar controles administrativos. O diretório não fica em cache entre requisições.

## Área existente

`/organizations/:id` reutiliza `Organizations`, `Members`, `Permissions` e `AuthenticatedShell`:

- **Visão geral:** nome, estado e datas; edição do nome, único dado editável organizacional atualmente disponível ao administrador comum.
- **Usuários:** convites de MEMBER, busca/filtro/paginação e remoção lógica de membros. Somente Master altera cargos ou gerencia vínculos/convites administrativos. A conta global permanece intacta.
- **Clientes:** contas externas, convites, busca exata por e-mail e suspensão/reativação, conforme customers.read/invite/manage; sem acesso Master/PlatformAdmin. [Contrato](customer-access.md).
- **Cargos e permissões:** os dois cargos existentes e a matriz de concessões. Administrador mantém todas as permissões organizacionais fixas; concessões de Member continuam editáveis.

A UI protege todos os vínculos administrativos da gestão comum, não apenas o próprio. O seletor de convite comum oferece somente MEMBER; ações de cargo e de convites administrativos aparecem apenas ao Master. Gestão de membros conserva os padrões de confirmação, carregamento e erros. Restauração e consulta de vínculos removidos permanecem exclusivas do Master.

## Autoridade e isolamento

`OrganizationAccess` verifica sessão plena e vínculo não removido em cada operação. Contas comuns exigem também organização ativa e não excluída. Master continua usando `/admin/organizations` e pode administrar organizações inativas, além de consultar/restaurar excluídas pelos fluxos específicos. Organizações excluídas recusam operações normais inclusive para Master.

`Organizations.update` permite nome conforme `organization.update`, mas rejeita qualquer escrita de `active` por conta comum, inclusive junto com um nome válido; não há atualização parcial. O catálogo mantém a chave `organization.update` e passa a descrevê-la como edição de dados. Não há concessão organizacional que autorize alterar o estado global.

`Members.update` exige Master para alterar qualquer cargo ou remover um administrador, considerando o papel atual persistido. A restauração é exclusiva do Master. UUIDs são normalizados e operações compartilham o lock organizacional. O Master pode remover ou rebaixar o último administrador, deixando temporariamente a organização sob gestão global; contas comuns não podem remover administradores umas das outras.

IDs de rota identificam o recurso solicitado, nunca a autoridade do ator. Identidade e papel vêm da sessão e do vínculo persistido. Corpos estritos recusam identidade de ator, papel Master e troca de escopo. Contas comuns não consultam outras organizações nem atravessam o namespace Master. Concessões já documentadas a Member continuam válidas somente no seu escopo e não concedem privilégios globais.

## Contrato e compatibilidade

As respostas de `GET /v1/organizations` e `GET /v1/{admin/}organizations/:id/access` acrescentam `role` e `userId`: papel do vínculo autenticado (`null` para Master) e ID do ator autenticado. São dados de composição da interface; nenhum deles é aceito como autoridade em escrita. As rotas de login e seus corpos permanecem iguais.

Respostas 403 cobrem acesso organizacional recusado e tentativa comum de alterar `active`; alteração de cargo ou remoção de administrador por conta comum retorna 403. Sessão inválida e uso comum de operações exclusivas Master mantêm 401. O vínculo único usa a migration `202610150005_single_organization`; não há nova dependência ou variável de ambiente. Containers e dados reais não são atualizados por esta entrega.

## Verificações focadas

Backend: `npx tsx --test --test-concurrency=1 test/organization-admin.test.ts test/organization-permissions.test.ts test/organization-deletion.test.ts test/organization-contract.test.ts test/organizations.test.ts`.

Frontend: `npx playwright test --config playwright.organizations.config.ts admin.spec.ts`, usando API/PostgreSQL reais descartáveis e contas sintéticas. Cobre login normal e com troca de senha, sessão já autenticada, organização única/múltiplas, abas, edição, membros, concessões, perda de acesso, Member sem concessões, vínculo removido, organização inativa, carregamento, falha de dependência e navegação Master. Axe e ausência de overflow em 1440/390/320 px. As bibliotecas temporárias de Chromium podem ser fornecidas por `LD_LIBRARY_PATH` conforme o guia de exclusão lógica.

Executar lint/build nos dois projetos e regenerar OpenAPI pelo comando do backend. Esses comandos são focados e não representam execução da suíte geral.
