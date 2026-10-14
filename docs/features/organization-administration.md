# Área do administrador organizacional

## Entrada e navegação

O item da navegação principal se chama **Organização** nos contextos Master e comum; títulos de listagens e breadcrumbs de retorno mantêm **Organizações**.

O login comum e a troca obrigatória da senha temporária continuam concluindo a sessão pela autenticação existente. Ao renderizar `/`, o servidor consulta o diretório autenticado `/v1/organizations`: um vínculo `ORGANIZATION_ADMIN` válido encaminha diretamente para `/organizations/:id`; vários encaminham para `/organizations`, que mostra somente as organizações administradas para escolha. Essa escolha considera o papel em cada organização, sem transformar o administrador organizacional em Master. Um vínculo adicional como Member não aparece no seletor administrativo.

Sem vínculo administrativo, a conta mantém as áreas pessoais. Acesso organizacional concedido explicitamente a Member continua seguindo as permissões existentes; Member sem concessões não vê o item Organização nem acessa as abas. Uma tentativa direta sem acesso apresenta estado seguro, sem nome/dados da organização. Falha de consulta é distinguida de acesso negado e oferece nova tentativa, sem renderizar controles administrativos. O diretório não fica em cache entre requisições.

## Área existente

`/organizations/:id` reutiliza `Organizations`, `Members`, `Permissions` e `AuthenticatedShell`:

- **Visão geral:** nome, estado e datas; edição do nome, único dado editável organizacional atualmente disponível ao administrador comum.
- **Usuários:** cadastro com senha temporária, vínculo de conta comum existente, busca/filtro/paginação, papel e remoção lógica. A conta global e os demais vínculos permanecem intactos.
- **Cargos e permissões:** os dois cargos existentes e a matriz de concessões. Administrador mantém todas as permissões organizacionais fixas; concessões de Member continuam editáveis.

A UI identifica o próprio acesso administrativo como protegido e não oferece alteração de cargo/remoção desse vínculo. Outros vínculos continuam usando as confirmações, estados de envio, sucesso e erro existentes. Ativação/desativação, exclusão/restauração de organizações e restauração/consulta de vínculos removidos pertencem ao Master. A UI comum não oferece essas ações.

## Autoridade e isolamento

`OrganizationAccess` verifica sessão plena e vínculo não removido em cada operação. Contas comuns exigem também organização ativa e não excluída. Master continua usando `/admin/organizations` e pode administrar organizações inativas, além de consultar/restaurar excluídas pelos fluxos específicos. Organizações excluídas recusam operações normais inclusive para Master.

`Organizations.update` permite nome conforme `organization.update`, mas rejeita qualquer escrita de `active` por conta comum, inclusive junto com um nome válido; não há atualização parcial. O catálogo mantém a chave `organization.update` e passa a descrevê-la como edição de dados. Não há concessão organizacional que autorize alterar o estado global.

`Members.update` impede que um administrador remova ou rebaixe o próprio vínculo, mesmo existindo outro administrador. UUIDs de alvo são normalizados antes da comparação e persistência. A proteção do último administrador não removido continua valendo para todos, inclusive Master. Permissões, remoções e cargos usam o mesmo lock `organization:<id>`; após hashing de senha fora da transação, o cadastro revalida acesso e permissões antes de escrever. Remoções cruzadas entre administradores se serializam e não deixam a organização sem administrador.

IDs de rota identificam o recurso solicitado, nunca a autoridade do ator. Identidade e papel vêm da sessão e do vínculo persistido. Corpos estritos recusam identidade de ator, papel Master e troca de escopo. Contas comuns não consultam outras organizações nem atravessam o namespace Master. Concessões já documentadas a Member continuam válidas somente no seu escopo e não concedem privilégios globais.

## Contrato e compatibilidade

As respostas de `GET /v1/organizations` e `GET /v1/{admin/}organizations/:id/access` acrescentam `role` e `userId`: papel do vínculo autenticado (`null` para Master) e ID do ator autenticado. São dados de composição da interface; nenhum deles é aceito como autoridade em escrita. As rotas de login e seus corpos permanecem iguais.

Respostas 403 cobrem acesso organizacional recusado e tentativa comum de alterar `active`; autorremoção/rebaixamento administrativo retorna 409 com mensagem pública específica. Sessão inválida e uso comum de operações exclusivas Master mantêm 401. Não foi necessário alterar schema, dependências, variáveis de ambiente ou migrations. Containers e dados reais não são atualizados por esta entrega.

## Verificações focadas

Backend: `npx tsx --test --test-concurrency=1 test/organization-admin.test.ts test/organization-permissions.test.ts test/organization-deletion.test.ts test/organization-contract.test.ts test/organizations.test.ts`.

Frontend: `npx playwright test --config playwright.organizations.config.ts admin.spec.ts`, usando API/PostgreSQL reais descartáveis e contas sintéticas. Cobre login normal e com troca de senha, sessão já autenticada, organização única/múltiplas, abas, edição, membros, concessões, perda de acesso, Member sem concessões, vínculo removido, organização inativa, carregamento, falha de dependência e navegação Master. Axe e ausência de overflow em 1440/390/320 px. As bibliotecas temporárias de Chromium podem ser fornecidas por `LD_LIBRARY_PATH` conforme o guia de exclusão lógica.

Executar lint/build nos dois projetos e regenerar OpenAPI pelo comando do backend. Esses comandos são focados e não representam execução da suíte geral.
