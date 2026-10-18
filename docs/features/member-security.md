# Listagem de membros e redefinição administrativa de credenciais

## Projeção autorizada

A consulta de membros preserva `members.read`, vínculo, escopo, busca, filtros e paginação. Cada item acrescenta `organization: {id,name}` da organização validada pelo caso de uso, `mfa: {configured,verified}` e `lastLoginAt`. Segredo TOTP é convertido em booleano na fronteira do repositório; nunca chega ao caso de uso de listagem ou ao HTTP. Senhas, hashes, digests, dispositivos e códigos não fazem parte da projeção.

A tabela apresenta iniciais, username/e-mail, cargo e organização em badges, vínculo ativo/removido, Senha, estado persistido do TOTP e último login no fuso do navegador. Ausência de histórico aparece como “Nunca acessou”. Convites continuam separados. O avatar tem recipiente próprio preparado para imagem futura, sem upload nem armazenamento nesta etapa. Rolagem horizontal preserva todas as colunas em telas estreitas.

## Último login

Migration aditiva `202610160002_last_login` acrescenta somente `User.lastLoginAt TIMESTAMP(3)` nullable, sem backfill ou inferência a partir de sessões/auditoria. Aplicar pelo procedimento de migrations antes da nova API. Nenhum dado existente é removido.

`Sessions.createSession` grava o instante do servidor somente ao emitir `full`, na mesma transação de sessão e auditoria, sob o lock `account:<id>` mantido pelos casos de uso. Usa o maior valor entre o instante atual e o anterior, evitando retrocesso inclusive por correção do relógio. Senha aceita com sessão restrita, setup, enrolamento e estágio de confirmação dos códigos não atualizam o campo. MFA/recuperação concluídos e troca inicial de senha comum com sessão plena atualizam. Consulta de perfil, refresh e logout não atualizam.

## Redefinição administrativa de credenciais

Para identidades internas, não há recuperação pública de senha nem redefinição iniciada pelo usuário por e-mail. Clientes externos têm um [fluxo separado](customer-access.md), sem reset administrativo de MFA. O Master pode redefinir outra conta elegível, inclusive administradores organizacionais e da plataforma; a própria conta Master é sempre protegida. Somente o Master pode redefinir MFA. Administradores organizacionais, membros e delegados da plataforma não recebem essa capacidade por nenhuma permissão. O administrador organizacional pode redefinir apenas a senha de MEMBER ativo de sua única organização atual e ativa. Não pode redefinir a si mesmo, outro administrador, um delegado da plataforma, vínculo removido ou conta de outra organização. Permissões concedidas ao cargo MEMBER não delegam esta operação.

Rotas sob `/v1`:

- Master: POST `/admin/accounts/:id/password/reset` e `/admin/accounts/:id/mfa/reset`.
- Administrador organizacional: POST `/accounts/:id/password/reset`. A antiga rota `/accounts/:id/mfa/reset` está desabilitada e sempre retorna 401.

O reset de MFA recebe somente `{currentPassword,code}` para reautenticação do ator; a identificação do alvo vem exclusivamente da rota. O reset de senha recebe também `{temporaryPassword,confirmPassword}` (com `code` opcional somente para ator sem MFA). Senha atual do ator é sempre obrigatória; TOTP novo é exigido quando o ator possui fator verificado, inclusive sempre para Master. Recovery codes não substituem essa reautenticação. A senha temporária e sua confirmação devem coincidir e cumprir a política de 15–1024 caracteres. Corpos são estritos, sem organizationId, papel ou grants. Sucesso retorna somente `{ok:true}`; entrada inválida 400, sessão/escopo/alvo recusado ou reautenticação inválida 401, capacidade indisponível 503. Não há distinção pública entre alvo inexistente e fora de escopo.

`ResetCredentials` reutiliza o orçamento `profile:<actor>` e a fila Argon2 existentes. A transação final relê ator, senha, alvo e vínculos. Master adquire `platform-access` antes dos locks de conta; ator organizacional resolve o escopo pelo servidor, adquire `organization:<id>` e depois locks de ator/alvo ordenados. Confere novamente vínculo/role único e organização ativa. O passo TOTP é consumido sem replay dentro da transação final.

### Senha temporária e sessão restrita

Cada operação recebe uma senha temporária específica daquela conta. Somente seu hash Argon2 é persistido. A transação grava o hash, marca `mustChangePassword`, revoga todas as sessões/dispositivos e registra `account.password_reset`. Falha de auditoria reverte os efeitos. A credencial anterior deixa de autenticar imediatamente. Os fatores MFA existentes são preservados.

No login com senha temporária, só é criada sessão `password`, com expiração restrita. APIs comuns, organizacionais e administrativas não aceitam esse estágio. A troca obrigatória existente exige senha diferente, gira o cookie, revoga outras sessões/dispositivos e remove a marca. A próxima etapa considera a identidade persistida: MFA se já configurado, setup quando exigido pela política, ou full quando não há fator nem obrigação. Isso impede que uma troca de senha ignore MFA ativo. A senha temporária deixa de valer após a troca.

O diálogo identifica a conta, pede a senha temporária e sua confirmação e orienta compartilhamento por canal apropriado. Campos secretos são limpos após envio, inclusive falha; a senha não aparece na resposta, em avisos, logs ou auditoria. Sucesso fecha o diálogo, atualiza a listagem e restaura foco.

### MFA opcional após reset

A transação remove segredo TOTP, verificação, passo e recovery codes, revoga sessões/dispositivos e audita `account.mfa_reset`. Também grava `mfaEnrollmentOptional=true`. Essa exceção é criada apenas pelo reset administrativo autorizado: administradores da plataforma novos continuam com enrolamento obrigatório inicial. Master não admite a exceção, tanto na aplicação quanto no CHECK do banco. Senha, grants, cargo e histórico permanecem intactos.

Depois do reset, uma conta sem fator acessa normalmente após senha e eventual troca obrigatória, sem setup forçado. MFA ativo continua exigido no login de contas comuns e administrativas. Nas configurações, **Configurar MFA** inicia voluntariamente uma sessão restrita de setup via POST `/auth/mfa/start` (`{}`). Setup, enrolamento, confirmação dos recovery codes e desafio reutilizam os mecanismos existentes: `/auth/totp/setup`, `/auth/totp/enroll`, `/auth/confirm`, `/auth/mfa` para contas comuns e as rotas `/admin/auth/...` para administrativas. Cada namespace rejeita a outra identidade. O início voluntário exige sessão plena; não contorna troca de senha obrigatória. Recuperação e consumo de TOTP mantêm proteção contra replay.

A listagem de membros retorna `canResetCredentials` por linha e `resetRequiresMfa` para compor os controles. `canResetCredentials` representa a elegibilidade para senha; MFA requer adicionalmente identidade Master. Ambos são derivados no backend, sem autorização por campos enviados pelo cliente. A API revalida tudo no momento da mutação. A listagem de administradores permanece exclusiva do Master; convites não oferecem redefinição de credenciais.

Eventos de reset contêm somente ator, alvo e, para reset de MFA, o vínculo atual único do alvo resolvido no servidor; para reset organizacional de senha, o escopo autorizado, no envelope cifrado existente; metadados são vazios. Nenhuma senha, hash, TOTP ou código de recuperação é registrado.

## Implantação e verificação direcionada

Aplicar a migration aditiva `202610160004_administrative_credentials` antes da API. Ela acrescenta `User.mfaEnrollmentOptional` com default false e CHECK que impede exceção para Master. Não altera senhas, fatores ou política de contas existentes. Sem variáveis novas, reset de banco ou backfill.

Testes backend relevantes: `administrative-credentials.test.ts` (PostgreSQL descartável na porta 15460), `member-security.test.ts`, `member-security-contract.test.ts`, `initial-common-password.test.ts`, `auth.test.ts`, `profile.test.ts`, `platform-admin.test.ts`, `members.test.ts`, `organization-contract.test.ts` e `architecture.test.ts`. Execute lint/build e geração Prisma/OpenAPI. A fixture aplica migrations duas vezes, sem usar o banco ativo.

Frontend: lint/build, `playwright.invitations.config.ts member-security.spec.ts manage.spec.ts`, `playwright.platform-admin.config.ts` e testes de login/configuração diretamente afetados. Fixtures sintéticas validam teclado/foco, erros, refresh, axe e desktop/mobile. Não é necessária a suíte completa.

Validação desta implementação (16/10/2026): lint e build de backend/frontend, geração Prisma/OpenAPI e testes backend direcionados aos arquivos acima passaram após os ajustes. No navegador passaram 30 testes: 7 de membros/gestão organizacional, 11 de administradores da plataforma e 12 de login. A regressão final de credenciais, segurança de membros e autenticação passou com 24 testes, incluindo isolamento do orçamento de proteção do Master. Não foi executada a suíte completa nem aplicada a migration ao banco ativo.

## Restrição ao Master (17/10/2026)

O caso de uso nega reset de MFA pelo namespace organizacional antes de processar credenciais. A rota administrativa continua exigindo a identidade Master persistida, sessão plena, senha atual e TOTP novo. O frontend distingue identidade Master de namespace administrativo. Nenhuma migration adicional é necessária.

Validação desta alteração: lint/build dos dois projetos, geração Prisma/OpenAPI e quatro testes backend (`administrative-credentials`, `member-security`, `member-security-contract`, `architecture`) passaram. O contrato foi verificado novamente após acrescentar a asserção de depreciação. Passaram 18 testes Playwright: sete de `member-security.spec.ts`/`manage.spec.ts` e onze da configuração platform-admin. Os relatórios foram direcionados para `/tmp` por falta de permissão no diretório gerado existente; bibliotecas ausentes do Chromium foram extraídas em `/tmp` e fornecidas por `LD_LIBRARY_PATH`. Não foi executada a suíte completa nem alterado o banco ativo.
