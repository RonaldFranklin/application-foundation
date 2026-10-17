# Auditoria de segurança e administração

## Finalidade e classificação

O registro persistente permite investigar ações de segurança e administração, com identidade e escopo derivados dos casos de uso. Não substitui monitoramento, controles de acesso ou uma política de privacidade. Esta implementação não constitui promessa de conformidade com a LGPD.

| Campo | Classificação e necessidade | Proteção |
|---|---|---|
| `id` | UUID aleatório do evento, necessário para distinguir registros | Texto, sem identidade embutida |
| `occurredAt` | Instante UTC da ação; para expiração, instante de vencimento | Timestamp, como os demais modelos do projeto |
| `action`, `outcome`, `resourceType` | Catálogo operacional fechado; resultado `success` ou `failure` | Texto; índices por data/ID e ação/data |
| `details.actorId` | ID interno do ator identificado, necessário para atribuição; ainda é dado pessoal pseudonimizado | Cifrado; `null` para sistema ou tentativa anônima |
| `details.organizationId` | ID interno do escopo autorizado, necessário para isolamento e investigação | Cifrado; `null` fora de organização ou quando não houve autorização do escopo |
| `details.resourceId` | ID interno do alvo persistido; em vínculo, ID do membro dentro da organização | Cifrado; nunca token/digest de sessão ou valor livre de rota |
| `details.metadata` | Apenas campos do catálogo abaixo, necessários para interpretar mudanças | Cifrado e validado por ação; demais propriedades são rejeitadas |

`PrismaAuditRepository` usa o `Vault` existente (AES-256-GCM, nonce aleatório, chave de cifragem separada da chave HMAC). O AAD inclui finalidade `audit:v1`, UUID, instante, ação, resultado e tipo do recurso, além da versão aplicada pelo Vault. Copiar o envelope para outro evento ou alterar seus campos autenticados impede a decifragem. Não há criptografia paralela, nova chave ou variável de ambiente.

Não são armazenados nomes, e-mails, valores antigos/novos de perfil ou nome de organização, IP, user-agent, senha/hash, tokens/digests, códigos MFA/recuperação/verificação, segredo TOTP, credenciais, conteúdo de e-mails ou corpos de requisições. O filtro de organização usa `organizationIndex`, HMAC versionado com finalidade exclusiva `audit-organization`, derivado do ID autenticado no envelope. Eventos sem organização usam um marcador protegido. O índice permite correlação de eventos da mesma organização no banco, mas não revela o ID e nunca é exposto pela API. Nenhuma busca por pessoa foi introduzida. Os campos operacionais em claro ainda permitem inferir horários e tipos de atividade; backup e acesso ao banco continuam exigindo proteção.

`account.sessions_revoked` registra a revogação pessoal atomicamente: ator/conta cifrados e metadados fechados `scope=current|other|others`, `count` inteiro não negativo. Não inclui UUID de sessão, token, digest ou organização inferida. A consulta apresenta escopo e quantidade.

## Catálogo e pontos de registro

As decisões estão em `application/`; os casos de uso validam o contrato fechado antes da persistência; os adaptadores repetem essa checagem defensivamente, cifram e inserem. `application/audit/events.ts` rejeita ações, campos e metadados desconhecidos, com erro fixo sem reproduzir o valor recebido.

| Ações | Origem e metadados permitidos |
|---|---|
| `organization.created`, `.updated`, `.deactivated`, `.reactivated`, `.deleted`, `.restored` | `Organizations`; sem metadados. Alterar nome e estado pode produzir dois eventos na mesma transação. Repetir exclusão/restauração ou reenviar valores iguais não produz nova transição. |
| `member.added`, `.removed`, `.restored`, `.role_changed` | Aceite de convite e `Members`; inclusão contém `role`, mudança contém `previousRole` e `role`. Nenhum evento de inclusão quando o vínculo já existe. |
| `permissions.changed` | `Permissions`; lista fechada `permissions` do papel MEMBER. Registra a gravação do conjunto, inclusive se igual. Não existem cargos customizados nem fluxo de criação de cargos: os dois papéis são estáticos. |
| `invitation.created`, `.resent` | `Invitations`; `role`. Emissão substituída no mesmo registro é `.resent`, inclusive ao emitir novamente após vencimento/cancelamento. Não significa envio SMTP. |
| `invitation.queue_failed`, `.revoked` | Falha de publicação que revoga a emissão atual; cancelamento explícito registra `.revoked` com ator autenticado. Revogação automática tem ator nulo. |
| `invitation.delivered`, `.delivery_failed` | `DeliverInvitation`; ator de sistema, sem metadados. Entrega significa aceite pelo servidor SMTP, não leitura ou chegada garantida à caixa postal. |
| `invitation.accepted` | Aceite confirmado; ator é a conta correspondente validada ou criada pelo aceite, com ID obtido da persistência. |
| `invitation.expired` | `ExpireInvitations`, ou antes de substituir/cancelar uma emissão vencida; ator nulo, `occurredAt` igual ao vencimento. |
| `account.updated` | `EditProfile`; somente nomes dos campos alterados (`username`, `email`), sem valores; lista vazia em gravação sem mudança. |
| `account.password_changed`, `.initial_password_changed`, `.email_verified` | Casos de uso de senha/perfil/verificação; sem metadados. O aceite de convite já representa a confirmação correspondente naquele fluxo. |
| `auth.password_accepted`, `.login` | Senha aceita e emissão de sessão plena são eventos distintos; a sessão restrita Master não é registrada como login completo. |
| `auth.logout` | Revogação de sessão válida, inclusive restrita; `forgetDevice` registra a intenção solicitada, não garante revogação do dispositivo. Repetição sem sessão válida não gera outro evento. |
| `auth.mfa_setup`, `.mfa_enrolled`, `.mfa_verified`, `.recovery_used` | Configuração inicial, enrolamento, TOTP aceito e código de recuperação consumido; nenhum segredo armazenado. Não há fluxo de recuperação de senha. |
| `auth.login_failed`, `.mfa_failed`, `.reauthentication_failed` | Recusas de credenciais após validação estrutural/admissão; login negado não atribui o identificador tentado a um ator. MFA e reautenticação usam a identidade da sessão já validada. |
| `administration.denied` | Recusas de permissão/namespace nas mutações organizacionais e tentativa de alterar estado global sem Master; `permission` limitado ao catálogo, `master` ou `organization.access`. Fora de escopo, registra a própria conta como recurso, sem copiar a organização solicitada. |

As ações terminadas em `_failed` e `.denied` têm resultado `failure`; as demais descrevem transições concluídas. Não há log de toda requisição. Entradas malformadas, sessões inexistentes, leituras negadas, erros genéricos e conflitos como último administrador não geram eventos automaticamente. Os limites HTTP e de autenticação existentes continuam aplicados. A auditoria de recusas administrativas cobre tentativas autenticadas nos pontos indicados, não todas as recusas possíveis de cada regra.

## Atomicidade e falhas

`AuthTransaction.audit` é obrigatório, compartilhando o cliente transacional com os repositórios existentes. Mutações, autorização sob locks e eventos de sucesso confirmam ou revertem juntos. Criação de organização e logout passaram a usar a unidade de trabalho para essa garantia. Não há sucesso sem auditoria nesses fluxos; falha de inserção impede a confirmação da mutação. Não há FK com exclusão em cascata para os eventos.

Recusas usam `bestEffort`: um savepoint isola falhas de inserção para que não abortem as alterações de limites ou convertam uma recusa em sucesso. O aviso operacional é somente `audit_write_failed`, sem erro original, IDs ou payload. Falhas de login/reautenticação registradas fora da transação de autenticação também têm erros contidos. Indisponibilidade geral do banco continua sujeita aos erros de dependência já existentes; não se promete autenticação sem banco. Falhas de auditoria de tentativa podem deixar lacunas, que o aviso operacional permite detectar.

Fila e SMTP são sistemas externos e não participam de transação distribuída. A emissão registra criação/reenvio antes da publicação. Falha conhecida de fila revoga e registra a falha; queda do processo entre confirmação e publicação pode deixar emissão pendente sem job, como no fluxo existente. Não se afirma entrega a partir da emissão. O evento SMTP confirma junto de `deliveredAt`; falha de banco após aceite SMTP pode causar reenvio/duplicação. `delivery_failed` confirma antes de lançar a falha sanitizada ao worker. Não existe garantia exactly-once entre SMTP e PostgreSQL.

A expiração é observada pela manutenção horária existente, em lotes de até 500 candidatos. `expiryAuditedAt` marca a emissão auditada na mesma transação; lock por organização evita duplicação entre réplicas. Reemissão limpa a marca somente depois de registrar eventual expiração antiga. A validade continua sendo aplicada imediatamente nas leituras, sem depender da manutenção. Grandes filas de expirados podem levar vários ciclos. Convites já vencidos na implantação serão observados pelo mesmo mecanismo; não há reconstrução retroativa dos demais eventos anteriores à migration.

## Consulta, acesso e decisões pendentes

A consulta global é exclusiva do Master da plataforma: `QueryAudit` exige `Sessions.authorized(raw, true)` antes de consultar ou decifrar registros, tanto na lista quanto no detalhe. Sessões ausentes, expiradas, restritas, contas com senha temporária, Master sem MFA e contas organizacionais são recusadas. Administradores organizacionais usam uma consulta separada e restrita, descrita abaixo. Membros não recebem acesso, mesmo com `permissions.manage`; nenhuma concessão organizacional foi ampliada. Não há exportação, edição ou exclusão de eventos.

### API e apresentação

- `GET /v1/admin/audit`: retorna `{items,total,page,pageSize,actions}`. Os filtros opcionais são `from` e `to` (instantes ISO 8601 com fuso, limites inclusivos), `action` (catálogo fechado), `outcome=success|failure` e `organizationId` (UUID ativo e não excluído). `page` começa em 1 (máximo 1.000.000), `pageSize` tem padrão 10 e limite 100. Campos desconhecidos, filtros repetidos, datas inválidas e início posterior ao fim são rejeitados com 400. Não são aceitos filtros de ator ou papel. Organização inexistente, inativa ou excluída retorna 409 com código `AUDIT_ORGANIZATION_UNAVAILABLE`; a consulta nunca amplia o escopo silenciosamente. Sem `organizationId`, todos os eventos, inclusive sem organização, permanecem elegíveis.
- `GET /v1/admin/audit/organizations`: exige sessão plena Master e retorna somente `{items:[{id,name}],total,page,pageSize}` das organizações ativas e não excluídas. Paginação validada, padrão/limite de 100 opções por página; a interface percorre as páginas para preencher a seleção. Nenhum ID de pessoa, envelope ou índice protegido é retornado.
- `GET /v1/admin/audit/:id`: exige novamente sessão plena Master, não aceita query adicional e retorna o detalhe mínimo; ID inválido ou ausente retorna 404. Ausência de autorização retorna 401 em ambas as rotas, conforme o padrão existente. Respostas usam `no-store` e erros sanitizados.
- Filtros são aplicados no PostgreSQL. Linhas e contagem usam o mesmo snapshot RepeatableRead; `take` limita a página antes de qualquer decifragem. Ordenação `occurredAt DESC, id DESC` e paginação por offset seguem o padrão organizacional existente. Inserções entre requisições podem deslocar itens entre páginas. Não há leitura de todo o histórico em memória.
- O DTO da lista contém somente ID do evento, instante UTC, ação/chave e rótulo em português, resultado, ator, organização, recurso e tipo legíveis. O detalhe acrescenta uma lista explícita de `{label,value}` derivada dos metadados permitidos. O JSON bruto, o envelope cifrado e IDs internos de pessoas/organizações/recursos não são retornados.
- O backend autentica o AAD, valida o envelope e reaplica o catálogo fechado antes de projetar qualquer dado. Referências são resolvidas pelos repositórios existentes, com cache limitado à requisição/página; apresenta apenas username atual e nome atual da organização, nunca e-mail ou credenciais. Conta/organização inexistente recebe indicação de indisponibilidade; ator nulo recebe “Sistema ou ator não identificado” e organização nula, “Não se aplica”. Recurso de convite é apresentado apenas como “Convite”, sem destinatário ou token. Cifragem, versão ou metadados inválidos falham com resposta sanitizada; não se retorna conteúdo parcial do evento corrompido.

### Tela e limites

`/admin/audit` usa o shell existente, com opção **Auditoria** global somente para Master, ao lado de Início e Organização. A página faz a verificação SSR existente e a API autoriza independentemente. A tabela oferece filtros por período, ação, resultado e organização, paginação no servidor, carregamento, vazio, erro e nova tentativa. O período tem precisão de minuto no horário local do navegador e é convertido para UTC: início em `:00.000`, fim inclusivo em `:59.999`. Datas inválidas e horários inexistentes por mudança de fuso são rejeitados; em horários locais repetidos, aplica-se a primeira ocorrência conforme a interpretação nativa do navegador. Aplicar usa o rascunho e retorna à primeira página; Atualizar preserva filtros aplicados, mesmo com rascunho diferente; Limpar remove todos os filtros e retorna à primeira página. Contagens e páginas antigas ficam ocultas durante carregamento/erro. Organização removida das opções permanece identificada como indisponível até nova seleção ou limpeza; uma rejeição da API não retorna resultados sem filtro. Detalhes abrem em diálogo modal nativo, com foco inicial em Fechar, contenção de foco, Escape e retorno ao acionador, sem perder a listagem.

Nomes são resolvidos no momento da consulta para apresentação: não representam nomes históricos e não são copiados para os registros. Nenhum valor anterior é reconstruído. Metadados vazios recebem “Nenhum detalhe adicional foi registrado”. Não há pesquisa por ator. O filtro opcional de organização pertence somente ao Master; a consulta organizacional não aceita troca de escopo pelo cliente. Acesso operacional direto ao banco e às chaves continua exigindo controle independente.

A aplicação apenas acrescenta eventos. Administradores com acesso direto ao banco podem alterar/apagar registros; não há promessa de imutabilidade, cadeia criptográfica de integridade ou prova contra exclusão por esse administrador.

Permanecem pendentes, para definição responsável: fundamento e finalidade formal do tratamento, responsáveis e acesso operacional, prazo de retenção e descarte (inclusive backups), anonimização, atendimento a solicitações de titulares, exportação, eventual busca por pessoa, monitoramento de lacunas e rotação de chaves. Não há limpeza automática da auditoria nem prazo presumido. Pseudonimização/cifragem e append-only não dispensam essas decisões nem garantem conformidade legal.

## Migration e validação

`202610150001_audit` cria somente `AuditEvent` e acrescenta `expiryAuditedAt`/índice a `OrganizationInvitation`. Não remove, redefine ou copia dados existentes. Gerar tipos com `npm run db:generate`; aplicar no ambiente de destino com `npm run db:migrate` antes de executar a nova API. A entrega aplica/reaplica migrations apenas em PostgreSQL descartável, sem tocar no banco real.

Verificações focadas: lint/build backend; `test/audit.test.ts` testa contexto confiável, catálogo, cifragem/AAD, rollback em ambos os sentidos, falha de inserção com savepoint e expiração concorrente. As suítes existentes de autenticação, perfil e convites incluem asserções de eventos e ausência de segredos; suites organizacionais, de verificação de e-mail, unidade de trabalho e arquitetura verificam os fluxos alterados. Resultados efetivamente executados são informados na entrega, sem substituir essas verificações por resultados históricos.

Verificação focada da consulta: `npx tsx --test --test-concurrency=1 test/audit-query.test.ts test/architecture.test.ts` no backend, além de lint/build e `npm run openapi`. A fixture PostgreSQL verifica autorização antes de decifrar, filtros estritos, desempate por ID, limite antes da decifragem, projeção mínima, nomes atuais/ausentes e falhas de envelope/metadados sem vazamento. No frontend: lint/build e `npx playwright test --config playwright.audit.config.ts`, com API sintética em loopback nas portas 18930/18931, cobrindo navegação, filtros, paginação, estados, modal, teclado, responsividade e axe. A autorização real é verificada pela suíte backend; a fixture do navegador não a substitui.

## Índice de organização e implantação

`202610150002_audit_organization_index` acrescenta coluna nullable e índice composto por organização/data/ID. Escritas novas gravam envelope e índice na mesma transação. A inicialização de `main.ts`, antes de abrir a porta HTTP, preenche os índices pendentes em lotes transacionais de 100: autentica AAD, valida o catálogo e deriva o HMAC com o Vault existente. Não altera envelopes, instantes, identidades nem metadados. O procedimento é idempotente, retomável após interrupção e seguro entre réplicas; não carrega o histórico inteiro em memória. Envelopes inválidos interrompem a inicialização com erro fixo, sem revelar conteúdo. A primeira inicialização pode levar mais tempo conforme o histórico.

Implantação: parar processos da versão anterior (incluindo workers), aplicar migrations, gerar/buildar os novos artefatos e iniciar somente a nova versão. Nunca executar versão antiga em paralelo, pois ela não preenche o índice. Consultas com organização recusam histórico ainda não indexado em vez de devolver contagens parciais. Rotação da chave/versão HMAC exige reconstrução coordenada desse índice, junto dos demais índices protegidos existentes; não há rotação automática. Não existe comando HTTP para reindexação.

## Consulta do administrador organizacional

`GET /v1/audit/access`, `GET /v1/audit` e `GET /v1/audit/:id` exigem sessão plena comum e exatamente um vínculo não removido, com papel `ORGANIZATION_ADMIN`, em organização ativa e não excluída. `OrganizationScope` resolve e revalida o vínculo atual em cada requisição, inclusive após obter o lock da organização. Zero ou múltiplos vínculos, revogação de papel ou organização indisponível negam acesso; nenhuma organização é escolhida por ordem de registros. Member não recebe auditoria. O Master mantém `/v1/admin/audit` e os filtros globais.

Não há contexto organizacional na sessão, endpoint de seleção ou seletor comum. A navegação entra diretamente na única organização autorizada. Rotas com ID continuam exigindo vínculo e permissões no backend. A sessão não precisa ser recriada quando o vínculo muda.

A listagem organizacional rejeita `organizationId` e propriedades desconhecidas. O HMAC derivado do vínculo validado é obrigatório no SQL da listagem, contagem e detalhe; eventos globais/nulos nunca são incluídos. Detalhe alheio e ID inexistente recebem o mesmo 404. Depois de autenticar o envelope, a apresentação compara seu `organizationId` ao escopo antes de resolver nomes. Respostas não incluem IDs protegidos, ciphertext, índices, e-mails ou dados de sessão.

A origem permanece nos casos de uso: organizações, membros e permissões usam a entidade autorizada; convites usam a organização validada na emissão e a associação persistida no aceite/entrega. O frontend não determina origem de eventos. Login, MFA e outros eventos sem associação inequívoca permanecem globais. Eventos históricos sem associação autenticada não recebem organização por inferência.

### Vínculo único e implantação

A migration `202610150005_single_organization`:
- Bloqueia escritas na tabela de vínculos e verifica duplicidades não removidas antes de alterar dados.
- Falha com `ACTIVE_MEMBERSHIP_CONFLICT`, sem IDs ou PII, se encontrar mais de um vínculo ativo por usuário. A transação não altera os registros nesse caso.
- Cria o índice único parcial `OrganizationMember_one_active_user`, sobre `userId WHERE deletedAt IS NULL`.
- Remove explicitamente as colunas obsoletas `Session.activeOrganization` e `Session.auditOrganization`, preservando tokens, prazos e demais dados das sessões.

O limite se refere ao vínculo não removido, independentemente do status da organização. Desativar ou excluir logicamente uma organização não libera o vínculo para outra; isso evita conflito na reativação. Vínculos removidos permanecem no histórico. O Master acessa organizações globalmente sem precisar de vínculos organizacionais e não passa pela resolução comum.

Aceite de convite e restauração validam o limite na aplicação dentro da transação, usando lock `account:<id>` após o lock da organização. Convites pendentes não criam vínculo. Aceites concorrentes para organizações diferentes são serializados; somente um cria o vínculo. O índice protege também contra escritas que contornem a aplicação. Conflitos retornam 409 com mensagem segura, sem nome ou ID da organização existente.

Antes de implantar, parar versões antigas e workers, executar as migrations e gerar Prisma Client. Para verificar duplicidades sem expor dados pessoais, executar em acesso operacional autorizado:

```sql
SELECT COUNT(*) AS conflicting_accounts
FROM (
  SELECT "userId" FROM "OrganizationMember"
  WHERE "deletedAt" IS NULL
  GROUP BY "userId" HAVING COUNT(*) > 1
) conflicts;
```

Se houver conflitos, interromper a implantação e resolver os vínculos sob decisão controlada. Não escolher uma organização automaticamente. Após corrigir dados e confirmar rollback, seguir o procedimento de recuperação de migration falha do Prisma antes de reaplicar. Não apagar sessões, eventos ou volumes.

Validação focada: testes backend `audit-scope`, `audit-query`, `audit`, `organization-admin`, `organization-invitations`, `members`, `organization-deletion`, `organization-permissions` e `architecture`; Playwright `playwright.audit.config.ts`; lint dos arquivos alterados e builds dos projetos. Os testes usam PostgreSQL descartável, cobrem duplicidades, upgrade com sessão existente, concorrência e regressões de filtros do Master.

## Extensão: administração delegada da plataforma

Leitura global de lista, detalhes e opções organizacionais admite Master ou administrador delegado ativo com `audit.read` explícito e MFA concluído. Revogação compartilha lock com a consulta; a conta organizacional continua restrita ao próprio escopo. Eventos administrativos novos e seus metadados fechados estão descritos em [administradores da plataforma](../features/platform-administrators.md#auditoria-e-privacidade). Eles não contêm identidade pessoal em claro nem segredos de convite/MFA.

## Listagem e redefinição de MFA

A listagem organizacional inclui organização, estado do vínculo, senha/TOTP e último login concluído (`lastLoginAt`, nullable). O Master pode redefinir MFA de outra conta com senha atual e TOTP novo em `/v1/admin/accounts/:id/mfa/reset`; revogação de fatores, sessões e dispositivos e evento `account.mfa_reset` são atômicos. Após reset, delegados podem configurar MFA voluntariamente nas preferências. [Contrato, migration aditiva e verificações focadas](../features/member-security.md).

A redefinição de MFA é exclusiva do Master, com senha atual e TOTP novo; permissões delegadas ou organizacionais não autorizam a operação. A rota legada `POST /v1/accounts/:id/mfa/reset` sempre nega com 401. O evento inclui a organização do vínculo atual do alvo, quando existente, sem credenciais.
