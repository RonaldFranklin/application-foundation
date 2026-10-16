# Listagem de membros e redefinição de MFA

## Projeção autorizada

A consulta de membros preserva `members.read`, vínculo, escopo, busca, filtros e paginação. Cada item acrescenta `organization: {id,name}` da organização validada pelo caso de uso, `mfa: {configured,verified}` e `lastLoginAt`. Segredo TOTP é convertido em booleano na fronteira do repositório; nunca chega ao caso de uso de listagem ou ao HTTP. Senhas, hashes, digests, dispositivos e códigos não fazem parte da projeção.

A tabela apresenta iniciais, username/e-mail, cargo e organização em badges, vínculo ativo/removido, Senha, estado persistido do TOTP e último login no fuso do navegador. Ausência de histórico aparece como “Nunca acessou”. Convites continuam separados. O avatar tem recipiente próprio preparado para imagem futura, sem upload nem armazenamento nesta etapa. Rolagem horizontal preserva todas as colunas em telas estreitas.

## Último login

Migration aditiva `202610160002_last_login` acrescenta somente `User.lastLoginAt TIMESTAMP(3)` nullable, sem backfill ou inferência a partir de sessões/auditoria. Aplicar pelo procedimento de migrations antes da nova API. Nenhum dado existente é removido.

`Sessions.createSession` grava o instante do servidor somente ao emitir `full`, na mesma transação de sessão e auditoria, sob o lock `account:<id>` mantido pelos casos de uso. Usa o maior valor entre o instante atual e o anterior, evitando retrocesso inclusive por correção do relógio. Senha aceita, troca de senha administrativa, setup, enrolamento e estágio de confirmação dos códigos não atualizam o campo. MFA/recuperação concluídos e troca inicial de senha comum com sessão plena atualizam. Consulta de perfil, refresh e logout não atualizam.

## Redefinição exclusiva do Master

`POST /v1/admin/accounts/:id/mfa/reset` recebe estritamente `{currentPassword,code}`. Exige sessão plena de Master com senha regular, TOTP verificado e segredo configurado. Senha atual e TOTP novo são obrigatórios em cada operação; códigos de recuperação não servem para esta reautenticação. O orçamento durável `profile:<actor>` é compartilhado com edição de perfil e reservado antes de Argon2. Não há permissão delegável nova.

A transação final adquire `platform-access` e os locks de ator/alvo em ordem estável, relê sessão, senha e identidade, recusa Master como alvo e consome o passo TOTP sem replay. Limpa segredo, verificação, contador e códigos do alvo, revoga todas as sessões e dispositivos e registra `account.mfa_reset`. Evento fechado, metadados vazios, ator/alvo derivados e cifrados pela auditoria existente. Falha da gravação obrigatória reverte toda a operação, inclusive o passo do ator; a reserva de tentativa anterior permanece.

Senha, e-mail, grants, cargos, vínculos e histórico de login não mudam. Delegados ativos voltam ao estágio `setup` no próximo login e precisam enrolar TOTP e confirmar os novos códigos antes de receber acesso pleno. Contas organizacionais mantêm a política atual de login comum, sem introdução de MFA obrigatório ou bypass administrativo. O Master recupera sua própria conta pelo fluxo existente.

Sucesso: 200 `{ok:true}`. Entrada inválida: 400. Sessão/perfil/alvo recusado ou reautenticação falha: 401 com mensagens públicas; capacidade de senha indisponível: 503. As proteções existentes de Origin/JSON/cookies e limite HTTP se aplicam. O diálogo nativo exige confirmação, mostra carregamento/erro/sucesso e restaura foco. Está disponível ao Master nas listas de membros e de administradores da plataforma.

## Verificação direcionada

Backend: lint/build, geração Prisma/OpenAPI, `member-security.test.ts`, `member-security-contract.test.ts`, `members.test.ts`, `auth.test.ts`, `profile.test.ts`, `initial-common-password.test.ts`, `platform-admin.test.ts`, contratos de organizações/plataforma e arquitetura. A fixture usa PostgreSQL descartável e aplica migrations duas vezes; sem banco ativo, containers ou SMTP real.

Frontend: lint/build, `playwright.invitations.config.ts manage.spec.ts member-security.spec.ts` e `playwright.platform-admin.config.ts`. Fixtures sintéticas, teclado/foco, axe, estados e viewports 1280/390/320 (incluindo referência 953 nos testes existentes). Bibliotecas Chromium extraídas temporariamente são passadas por `LD_LIBRARY_PATH`, sem instalação no sistema.

Validação desta entrega (16/10/2026): lint/build dos dois projetos, geração Prisma/OpenAPI e 32 testes únicos de backend aprovados em rodadas focadas. Treze testes de navegador aprovados nas suítes de membros/convites e administradores, com axe, teclado/foco e responsividade. Os dois testes inicialmente incompatíveis com o novo histórico/sessão foram corrigidos e reexecutados. Migration aplicada e reaplicada somente em PostgreSQL descartável. Não foram executados suíte completa, carga, serviços de e-mail reais, atualização de containers ou migration no banco ativo.
