# Administradores delegados da plataforma

## Identidade e autoridade

`User.master` continua reservado ao bootstrap. `PlatformAdmin` indica elegibilidade administrativa separada, estado ativo e concessões explícitas por conta. Concessões podem ser individuais ou derivadas de um cargo da plataforma criado pelo Master. Contas comuns existentes não são convertidas: o convite exige uma identidade nova, sem organização. Constraints e triggers impedem coexistência de PlatformAdmin com Master ou qualquer vínculo organizacional, inclusive removido. Desativar preserva a elegibilidade registrada; não converte a conta em usuário comum.

Somente Master com sessão plena pode listar, convidar, reenviar, cancelar, desativar, restaurar ou alterar concessões. Não há permissão delegável para gerir administradores. Os casos de uso verificam o estado persistido em cada operação; frontend e campos enviados pelo cliente não autorizam nada.

| Chave global | Operação |
|---|---|
| `organizations.read` | Listagem, detalhes e capacidades de organizações |
| `organizations.create` | Criação de organização |
| `organizations.update` | Alteração do nome |
| `organizations.status` | Ativação/desativação |
| `organizations.delete` | Exclusão lógica/restauração pelo fluxo existente |
| `audit.read` | Lista, detalhes e opções de organizações da auditoria global |

Nenhuma concessão é implícita, inclusive auditoria. Atualizar nome e estado no mesmo corpo exige ambas as permissões. Excluir/restaurar segue a política existente de desativar/reativar. As permissões de membros, convites organizacionais e cargos não são delegáveis nesta versão: essas áreas permanecem sob Master e controles organizacionais existentes. Para usar o diretório na interface, conceda `organizations.read`; somente `organizations.create` permite abrir o cadastro sem consultar a listagem. Outras permissões não concedem leitura implicitamente. O catálogo de aplicação é tipado e a migration mantém uma allowlist correspondente em CHECK sobre as listas persistidas.

## Convites e ativação

`PlatformAdminInvitation` é independente de organizações, com e-mail cifrado, índice HMAC, digest, concessões, criador e datas. Há uma linha única por fingerprint. Não se cria usuário ao emitir o convite. Um endereço já cadastrado ou convite pendente é recusado para o Master; não há consulta pública de existência de conta.

Token de 256 bits, validade de sete dias, digest SHA-256 com domínio `platform-admin-invitation.v1` e contexto de ID/fingerprint, comparação constante. Apenas o envelope AES-GCM segue para a fila em `email.platform-admin-invitation.v1`, com ID e token cifrado; nunca destinatário ou senha. O link usa `/admin/invitations/accept#token=id.token`; o frontend remove o fragmento, não persiste o token em storage e define no-referrer/noindex. O aceite é POST com Origin exata, JSON e limites HTTP existentes.

A pessoa define username, senha de 15–1024 caracteres e confirmação. Corpos são estritos, sem Master, organização ou concessões. O aceite verifica colisões de ambos os namespaces de identidade, cria `master=false`, registra concessões, verifica e-mail, consome o convite e audita na mesma transação. Não retorna sessão. Depois é obrigatório entrar pelo login administrativo e concluir TOTP e confirmação dos códigos de recuperação.

Cada convite admite dez tentativas válidas estruturalmente, reservadas antes de Argon2; palpites incorretos também consomem o limite. Revalidação após Argon2 impede uso de token rotacionado, expirado, revogado ou consumido. IDs e tokens desconhecidos recebem erro genérico. Expirado/revogado/usado são informados somente após validar o digest. O rate limit geral por IP continua ativo. Conhecer o ID permite esgotar o orçamento do convite; reenvio pelo Master rotaciona o token e reinicia as tentativas.

Envios têm cooldown de 60 segundos, teto de cinco por hora e vinte por dia/endereço, além de cem por hora na plataforma. Cancelamento/reenvio não limpa esse orçamento. Duplicatas concorrentes são serializadas; a constraint única é a defesa adicional. Reenvio invalida imediatamente o link anterior. Aceitos não são reenviados; cancelados podem ser convidados novamente pelo formulário.

O publisher reutiliza os limites da fila existente: timeout de dois segundos, três tentativas SMTP, backoff exponencial inicial de cinco segundos, remoção após conclusão/falha. Falha de publicação revoga somente o digest daquela emissão e audita. Não há outbox/transação distribuída: uma falha simultânea do banco pode impedir compensação e tornar entrega incerta. SMTP aceito antes de falha no commit pode duplicar a mensagem; tokens continuam de uso único. O worker descarta jobs antigos, expirados, revogados, consumidos, esgotados ou já entregues. SMTP real não faz parte dos testes automatizados.

## Login, MFA e concorrência

`/admin/auth/login` mantém os controles atuais de senha, Turnstile adaptativo, admissão, dispositivos, TOTP, replay e recuperação para Master e delegados. `/auth/login` exclui ambos, inclusive administradores desativados. Falhas de login continuam genéricas. Não há recuperação pública. Convites exigem senha escolhida pelo destinatário; reset administrativo permite ao Master definir somente uma senha temporária, com troca obrigatória.

A sessão informa `master` real e `administrative`; o perfil retorna `accountType=platform-admin` e `platformPermissions`. Sessões restritas continuam limitadas aos estágios `password`, `setup`, `mfa`, `recovery`; acesso pleno exige senha regular e conclusão do MFA quando configurado ou obrigatório. Configurações de perfil exigem senha atual e TOTP quando verificado. Master mantém MFA obrigatório; novos delegados também precisam enrolar inicialmente. Somente um reset administrativo autorizado torna o enrolamento opcional para o delegado, conforme [redefinição de credenciais](member-security.md).

Mudanças de estado ou permissões adquirem `platform-access` e depois `account:<id>`, salvam acesso, revogam sessões/dispositivos e auditam atomicamente. Login/MFA/perfil continuam serializados pelo lock da conta e releem estado após adquiri-lo. Operações globais protegidas mantêm `platform-access` durante autorização e trabalho; uma operação que já o adquiriu pode terminar antes da revogação, e as que aguardam revalidam o estado revogado. Não há cache de permissões.

Operações organizacionais mantêm `organization:<id>`; quando o ator é delegado, adquirem em seguida `platform-access` e releem a sessão. Nenhum fluxo que detém `platform-access` adquire um lock organizacional existente. Operações de contas organizacionais mantêm seus locks anteriores, sem serialização global adicional. Aceite administrativo usa `platform-access` → `identity-update`. Entrega SMTP mantém `platform-access` até concluir (timeout transacional de 60 segundos), portanto pode atrasar operações globais; é um limite de disponibilidade conhecido desta primeira versão. Consultas de auditoria usam o mesmo lock, com leitura em repositórios existentes. A aplicação privilegia consistência sobre paralelismo global nesta versão.

## Auditoria e privacidade

Eventos fechados `platform_invitation.created/resent/revoked/accepted/delivered`, `platform_admin.activated/deactivated/restored/permissions_changed`. Ator e escopo são derivados no backend. Eventos de permissão contêm somente listas allowlisted `granted` e `removed`. Identificadores e metadados usam o envelope cifrado da auditoria existente. Não há e-mail, nome, senha/hash, token/digest, TOTP ou conteúdo de mensagem nos eventos. A lista administrativa retorna somente projeções de apresentação, nunca envelopes/digests.

Busca parcial de identidade cifrada exige decifrar as linhas autorizadas antes de filtrar/paginar. A consulta é exclusiva do Master, mas seu custo cresce com o total de administradores/convites; não foi criado índice com PII em claro. A interface mostra MFA configurado/não configurado, concessões, conta ativa/inativa e convites pendentes/expirados/aceitos/cancelados, com confirmação modal e foco restaurado.

## API e implantação

Prefixo `/v1`:

- GET `/admin/platform-admins`: `search`, `status` (all/active/inactive/pending/expired/revoked/accepted), `page`; retorna items/total/page/pageSize/catalog/roles, dez itens por página.
- POST `/admin/platform-admins/invitations`: `{email,permissions}` ou `{email,roleId}` (exclusivos).
- POST `/admin/platform-admins/invitations/:id/resend` e `/revoke`: `{}`.
- POST `/admin/platform-admins/:id`: `{active,permissions}`; somente elegibilidade já existente.
- POST `/platform-admin-invitations/accept`: `{token,username,password,confirmPassword}`; sem sessão nova.

200 sucesso; 400 entrada/convite inválido; 403 acesso negado; 409 duplicidade; 429 limite; 503 fila/capacidade indisponível. Acesso global existente mantém os status 401/403 anteriores. OpenAPI é gerado dos controllers.

Migration aditiva `202610160001_platform_admin`: duas tabelas, FKs, índices, allowlists e triggers, sem reescrever dados existentes. Aplicar pelo processo operacional antes da nova API; nunca `db push` ou reset. Não há variáveis novas: fila/SMTP usam a configuração atual. Nesta entrega, migrations são aplicadas e reaplicadas somente pela fixture de PostgreSQL descartável; banco real, imagens e volumes são preservados.

## Verificações focadas

Backend: `npm run lint`, `npm run build`, geração Prisma/OpenAPI com `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1`, e testes `platform-admin.test.ts`, `platform-admin-contract.test.ts`, `auth.test.ts`, `profile.test.ts`, `initial-common-password.test.ts`, `organization-admin.test.ts`, `organization-permissions.test.ts`, `organization-invitations.test.ts`, `organization-deletion.test.ts`, `audit-query.test.ts`, `architecture.test.ts`, `organization-contract.test.ts`. A fixture aplica migrations duas vezes e usa porta 15457 no novo teste. Filas e SMTP são falsos; o teste exercita HTTP, PostgreSQL, MFA, concorrência, constraints, revogação e rollback de auditoria.

Frontend: `npm run lint`, `npm run build`, `npx playwright test --config playwright.platform-admin.config.ts`. API sintética e Next usam portas 19031/19030. Testes de navegador cobrem gestão, concessões explícitas, confirmação/teclado/foco, filtros, navegação restrita, remoção do fragmento, axe e larguras 1440/390/320. Bibliotecas ausentes do Chromium podem ser extraídas em diretório temporário e passadas via `LD_LIBRARY_PATH`, sem instalação global. A suíte completa não é necessária.

Validação executada em 16/10/2026: geração Prisma/OpenAPI e lint/build dos dois projetos aprovados; testes reais do backend aprovados nas rodadas focadas descritas acima (com sobreposição). A migration foi aplicada e reaplicada pela fixture descartável, com constraints, aceite concorrente, autorização individual, revogação imediata e rollback de auditoria exercitados. Os cinco testes novos de navegador passaram, incluindo estados de erro, teclado/foco e axe sem violações em desktop/mobile. O contraste inicial do diálogo foi corrigido antes da rodada aprovada. Não foram executados suíte completa, SMTP/Redis reais, teste de carga, implantação ou migrations no banco ativo.

A suíte focada `tests/login.spec.ts` também passou (11 testes), preservando login, desafios, primeiro acesso, TOTP e recuperação no navegador com API simulada. O contrato gerado possui teste próprio para impedir que schemas legados substituam os de administradores.

## Listagem e redefinição de MFA

A listagem organizacional inclui organização, estado do vínculo, senha/TOTP e último login concluído (`lastLoginAt`, nullable). O Master pode redefinir MFA de outra conta com senha atual e TOTP novo em `/v1/admin/accounts/:id/mfa/reset`; revogação de fatores, sessões e dispositivos e evento `account.mfa_reset` são atômicos. Após reset administrativo, delegados podem configurar MFA voluntariamente nas preferências; Master permanece obrigatório. [Contrato, migration aditiva e verificações focadas](member-security.md).

## Painel compacto

A listagem administrativa segue o acabamento dos membros organizacionais: cabeçalho compacto, filtros integrados, identidade com iniciais, badges, linhas de 42 px e paginação no rodapé. As ações de conta/convite usam o mesmo componente de menu acessível, sem alterar as telas de organizações. Convites informam explicitamente que MFA não se aplica. O estado vazio ocupa apenas uma mensagem curta; a rolagem horizontal fica dentro da tabela.

A consulta mantém debounce de 200 ms, AbortController e paginação no servidor, com dez itens e sem seletor de tamanho. Não há consultas extras para contagens. Cancelar diálogos devolve foco ao botão do menu; sucesso leva ao título persistente enquanto a lista atualiza. Validação focada: lint/build frontend e `playwright.platform-admin.config.ts`, incluindo autorização SSR, ações, teclado, axe, paginação, busca e viewports 953/390/320.

Nesta refatoração, lint/build frontend e os sete testes de `playwright.platform-admin.config.ts` passaram. As capturas e a verificação de geometria confirmaram filtros alinhados e ausência de rolagem horizontal na página; teclado/foco e axe permaneceram aprovados. Backend, contratos e telas organizacionais não foram alterados.

## Cargos e matriz de permissões

A seção administrativa oferece abas **Contas e convites** e **Cargos e permissões**, com ícone na navegação lateral. A matriz utiliza somente as seis concessões globais existentes: linhas de permissões, coluna Master fixa e colunas dos cargos criados pelo Master. Nenhum cargo é semeado e nenhuma conta existente é migrada para um cargo. O Master não é um cargo atribuível; sua identidade e autorização permanecem protegidas.

Somente sessão plena do Master pode consultar, criar, renomear, excluir ou atribuir cargos. Nomes têm 1–80 caracteres após trim, unicidade normalizada e limite de 50 cargos. Nomes reservados do modelo (`Master`, `platform-admin`, `platform_admin`, `organization_admin`, `member`) são recusados. Cargos novos são criados pela interface sem permissões; a API aceita apenas o catálogo fechado, sem duplicatas. Cada edição envia a versão salva; uma versão obsoleta retorna 409, exigindo recarregar. A interface edita um cargo por vez, mantém o rascunho em falhas e oferece descarte e atualização explícitos.

Atribuir um cargo substitui as concessões da conta/convite pelas do cargo. Removê-lo (`roleId: null`) conserva as concessões atuais como individuais. Contas com cargo não podem sobrescrevê-las pelo endpoint legado de estado/permissões. Alterações de permissões do cargo atualizam atomicamente contas vinculadas e convites não aceitos/não cancelados, inclusive expirados; revogam sessões e dispositivos das contas e auditam na mesma transação. Reenvio e aceite resolvem novamente as permissões do cargo. O lock `platform-access` serializa esses fluxos; locks de conta são adquiridos em ordem de ID. Renomear sem alterar permissões não encerra sessões.

Cargos associados a qualquer conta ou convite, inclusive histórico, não podem ser excluídos. A política é validada no caso de uso e reforçada por FKs RESTRICT. Cargos/permissões organizacionais continuam independentes e inalterados.

Endpoints exclusivos do Master, sob `/v1/admin/platform-admins`:

- GET `/roles`: `{roles: [{id,name,permissions,version}], catalog}`.
- POST `/roles`: `{name,permissions}`; POST `/roles/:id`: `{name,permissions,version}`.
- POST `/roles/:id/remove`: `{version}`.
- POST `/:id/role` e `/invitations/:id/role`: `{roleId: UUID|null}`. Convites aceitos/cancelados não admitem atribuição.

Mutações retornam `{saved:true}`; conflitos de versão/nome ou cargo inexistente retornam `ROLE_CONFLICT` (409), exclusão vinculada retorna `ROLE_IN_USE` (409). Corpos são estritos. A lista inclui `roleId` nullable e a projeção de cargos, sem consulta adicional para os seletores.

Eventos `platform_role.created/updated/deleted` registram ator e recurso, sem nomes ou conteúdo livre. `platform_admin.role_assigned` e `platform_invitation.role_assigned` registram apenas `roleId` nullable nos metadados cifrados. Falha de auditoria reverte a alteração e suas revogações.

Implantação: aplicar a migration aditiva `202610160003_platform_roles` pelo procedimento operacional antes da API. Ela adiciona `PlatformRole`, versão, allowlist, FKs e índices; preserva concessões e dados anteriores, sem seed/backfill. Não há nova variável de ambiente.

Verificação direcionada dos cargos: `platform-roles.test.ts` usa PostgreSQL descartável na porta 15459 e cobre autorização em cada operação, isolamento, entradas inválidas, versão concorrente, materialização, revogação, aceite, constraints e rollback de auditoria. Execute junto de `platform-admin.test.ts`, `platform-admin-contract.test.ts`, `member-security.test.ts` e `architecture.test.ts`, além de lint/build e geração Prisma/OpenAPI. A suíte `playwright.platform-admin.config.ts` inclui matriz, atribuições, erros, teclado/foco, axe e responsividade; não requer a suíte completa.

Validação da gestão de cargos em 16/10/2026: geração Prisma/OpenAPI e lint/build dos dois projetos aprovados; sete testes de backend aprovados nos cinco arquivos direcionados acima mais `audit-query.test.ts` (que contém dois testes), incluindo arquitetura e contratos; nove testes Playwright aprovados, com axe e geometria em 1440/953/390/320 px. Foram corrigidos o posicionamento do rótulo acessível da matriz e o retorno de foco ao fechar a confirmação de exclusão. Migrations foram aplicadas somente em fixtures descartáveis; não houve implantação ou alteração do banco ativo.

### Matriz alinhada à gestão organizacional

A aba da plataforma reutiliza diretamente `Organizations.module.css` para o painel, cabeçalho, faixa de escopo, contadores, matriz, switches, indicação de concessões alteradas e rodapé. Não há outra implementação visual dos switches. A folha compartilhada aceita também h1 no cabeçalho, preservando a hierarquia da página da plataforma e a aparência do h2 organizacional.

O total de cargos inclui o Master fixo. A matriz permanece visível mesmo sem cargos personalizados, exibindo o catálogo global e o Master protegido. Criação e edição de nomes ficam em uma faixa compacta do cartão; um seletor escolhe o cargo a renomear ou excluir. Alterar uma concessão seleciona seu cargo na faixa de edição. O rodapé salva o único cargo alterado, com a versão original; descarte, atualização explícita e confirmações de exclusão mantêm o fluxo anterior. Nenhuma regra, permissão, endpoint ou autorização foi modificada.

Comparação visual: desktop apresenta a mesma hierarquia da referência organizacional (título/contagens, valores salvos, escopo/badges, colunas com switches e rodapé); em 390/320 px os controles se reorganizam e somente a matriz rola horizontalmente. Capturas também cobrem múltiplos cargos e foco nos switches fora da área inicialmente visível. Artefatos de validação ficam fora do repositório, em `/tmp/platform-matrix-layout` e `/tmp/platform-matrix-extra`.

Validação desta refatoração: lint/build frontend aprovados; nove testes da suíte de plataforma e, após ampliar a cobertura, os três testes de `platform-roles.spec.ts` aprovados (dez casos distintos, com sobreposição entre rodadas). Os quatro testes direcionados de `permissions.spec.ts` organizacional também passaram. Axe sem violações e geometria/capturas em desktop e 953/390/320 px; múltiplos cargos em 1440/390/320 px. Backend e contratos não foram alterados; a suíte completa da aplicação não foi executada.
