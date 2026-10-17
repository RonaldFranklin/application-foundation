# Exclusão lógica de organizações e vínculos

## Estado e acesso

`Organization.deletedAt` e `OrganizationMember.deletedAt` são timestamps nullable. `null` significa não excluído; o vínculo não possui um segundo status. Excluir uma organização grava o timestamp e define `active=false`; restaurar limpa o timestamp e define `active=true`. Desativação é distinta da exclusão e, assim como ativação, é exclusiva do Master. Organizações inativas também não concedem acesso organizacional às contas comuns. Os nomes continuam aceitando duplicatas, como no schema anterior; nenhuma constraint de unicidade foi removida.

Excluir a organização preserva seus vínculos, permissões e demais dados. Uma organização excluída não aparece nas listas/contagens normais, não concede acesso e recusa leitura de detalhes, membros, permissões e todas as mutações normais, inclusive pelo Master. A consulta administrativa de excluídas e a restauração são exceções explícitas. Restaure a organização antes de gerir seus vínculos. Restaurar a organização não restaura vínculos removidos anteriormente.

Remover um vínculo modifica somente seu `deletedAt`. Conta global, credenciais, sessões, demais organizações, cargo anterior e data de criação permanecem intactos. O vínculo removido não aparece nas listas normais nem concede acesso. A chave primária composta `(organizationId, userId)` permanece: tentar vincular novamente retorna 409 e orienta a restauração pelo Master, sem criar outra linha ou substituir o cargo. A restauração explícita limpa `deletedAt` na mesma linha.

## Autorização e consistência

Exclusão/restauração de organizações, restauração de vínculos e consulta de removidos exigem sessão plena do Master global, senha trocada e MFA verificado. Administradores organizacionais e membros não obtêm privilégios globais. Preserva-se a exceção já documentada em [permissões](organization-permissions.md): `members.remove` permite remover vínculos de MEMBER no próprio contexto organizacional. Essa remoção agora é lógica. Ela não permite consultar removidos nem restaurá-los.

`OrganizationAccess` aplica a barreira de exclusão em cada operação. `Organizations` e `Members` validam corpos, decidem transições e usam o mesmo lock transacional `organization:<id>` das alterações de organização, cargos e permissões. Somente Master remove/rebaixa administradores e pode fazê-lo inclusive com o último. Contas comuns não podem remover/rebaixar nenhum administrador. Cadastro faz hashing fora da transação e revalida a autorização/organização sob lock antes de criar a conta e o vínculo.

Solicitações repetidas de exclusão de organização preservam o timestamp. Restauração de organização ou vínculo já restaurado retorna sucesso sem alterar o estado atual. Remover vínculo já removido retorna 404. Operações concorrentes se serializam pelo lock, inclusive entre instâncias e aliases de maiúsculas do UUID da organização. Nenhum repositório decide quem pode excluir/restaurar; adaptadores executam consultas, filtros e persistência definidos pelos casos de uso.

## Contrato HTTP

Prefixo administrativo: `/v1/admin/organizations`. POST exige cookie, Origin exata e JSON, mantendo CSRF, rate limit e respostas sanitizadas.

| Método e rota | Contrato |
|---|---|
| GET `/` | `deleted=false` (padrão) lista não excluídas; `deleted=true` lista somente excluídas; combina com busca, status e paginação |
| POST `/:id/remove` | `{}`; exclusão lógica da organização; retorna organização com `deletedAt` |
| POST `/:id/restore` | `{}`; restaura e ativa a organização; retorna organização |
| GET `/:id/members` | `deleted=false` (padrão) lista vínculos atuais; `deleted=true` lista somente removidos; combina com busca, cargo e paginação |
| POST `/:id/members/:userId/remove` | `{}`; remove logicamente o vínculo, somente Master pode remover administrador, inclusive o último |
| POST `/:id/members/:userId/restore` | `{}`; restaura o vínculo existente e seu cargo; retorna `{saved:true}` |

Os controllers existentes também expõem as rotas no namespace `/v1/organizations`. Isso não relaxa a autorização: exclusão/restauração de organizações e restauração de vínculos exigem Master em ambos os namespaces. O diretório comum nunca retorna excluídas, qualquer que seja a query. Consultar vínculos removidos como conta comum retorna 403. Sessão ausente/restrita/expirada/revogada ou conta comum em ação exclusiva Master retorna 401; organização excluída em operação normal retorna 404 ao Master e 403 às contas comuns. Entradas inválidas retornam 400 e conflitos 409. OpenAPI inclui os campos e filtros novos.

## Interface

As telas existentes oferecem `Não excluídas / Excluídas` e `Vínculos atuais / Vínculos removidos`. Registros excluídos oferecem restauração; organizações excluídas não oferecem links de abertura/edição de membros. Confirmações inline seguem o padrão dos formulários existentes, sem `window.confirm`, com cancelamento, foco inicial/retorno, bloqueio de envios duplicados, carregamento e mensagens de sucesso/erro. Restaurar vínculo informa o cargo preservado. Excluir pela página de detalhes abre a listagem de excluídas.

## Migration e operação

`202610130001_organization_soft_deletion` adiciona as duas colunas sem preencher registros existentes: todos permanecem com `deletedAt=null`. Adiciona índices de listagem e contagem e um CHECK que impede organização simultaneamente excluída e ativa. Preserva tabelas, FKs, chaves primárias, índices anteriores e dados. Não há atualização de ambientes locais, reset, `db push` ou remoção de volumes.

Antes de executar a nova versão num ambiente, aplicar `npm run db:migrate` em backend pelo procedimento operacional existente. A migration foi aplicada/reaplicada apenas nas fixtures PostgreSQL descartáveis durante os testes; o banco real continua pendente de implantação autorizada.

## Verificação focada

- Backend: `npx tsx --test --test-concurrency=1 test/organization-deletion.test.ts test/organizations.test.ts test/members.test.ts test/organization-permissions.test.ts test/organization-contract.test.ts`.
- Interface com API/PostgreSQL reais descartáveis: `npx playwright test --config playwright.organizations.config.ts` em frontend. Portas isoladas 18730/18731/18740; fixtures sintéticas e nenhuma chamada SMTP/Redis.
- Lint/build dos dois projetos; `npm run openapi` em backend. Não é necessário executar a suíte geral.
- Chromium exige bibliotecas de sistema. Nesta sessão, `libnspr4`, `libnss3` e `libasound2t64` foram extraídas em `/tmp/foundation-browser-libs`, sem instalação global; usar `LD_LIBRARY_PATH=/tmp/foundation-browser-libs/usr/lib/x86_64-linux-gnu` enquanto esse diretório existir.

Os testes cobrem autorização Master, CSRF, entrada estrita, isolamento, perda imediata de acesso, preservação da conta/sessão/cargo, restauração, listagens/contagens, concorrência entre instâncias, autoridade exclusiva do Master sobre administradores e revalidação após hashing. Navegador cobre confirmação/cancelamento por teclado, erro e retry, estado ocupado, filtros, restauração, persistência após reload e axe/responsividade em 1440/390/320 px. Resultados de execução são informados na entrega.
