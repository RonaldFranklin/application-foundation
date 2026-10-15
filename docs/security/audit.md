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

Não são armazenados nomes, e-mails, valores antigos/novos de perfil ou nome de organização, IP, user-agent, senha/hash, tokens/digests, códigos MFA/recuperação/verificação, segredo TOTP, credenciais, conteúdo de e-mails ou corpos de requisições. Não há índice cego adicional: nenhuma busca por pessoa foi introduzida. IDs cifrados não podem ser filtrados diretamente pelo PostgreSQL. Os campos operacionais em claro ainda permitem inferir horários e tipos de atividade; backup e acesso ao banco continuam exigindo proteção.

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

Esta entrega não oferece endpoint, tela, exportação, edição ou exclusão de eventos. O catálogo atual não tem permissão de auditoria; `permissions.manage` não foi ampliada para esse fim. Uma futura consulta deve definir permissão própria, validar Master/administrador no servidor, negar acesso automático a membros, garantir isolamento organizacional e paginação, e decidir como pesquisar identificadores cifrados sem enfraquecer sua proteção. O envelope é decifrável com as abstrações/chaves existentes, mas acesso operacional direto exige controle de acesso independente; não há ferramenta de exportação entregue.

A aplicação apenas acrescenta eventos. Administradores com acesso direto ao banco podem alterar/apagar registros; não há promessa de imutabilidade, cadeia criptográfica de integridade ou prova contra exclusão por esse administrador.

Permanecem pendentes, para definição responsável: fundamento e finalidade formal do tratamento, responsáveis e acesso operacional, prazo de retenção e descarte (inclusive backups), anonimização, atendimento a solicitações de titulares, exportação, eventual busca por pessoa, monitoramento de lacunas e rotação de chaves. Não há limpeza automática da auditoria nem prazo presumido. Pseudonimização/cifragem e append-only não dispensam essas decisões nem garantem conformidade legal.

## Migration e validação

`202610150001_audit` cria somente `AuditEvent` e acrescenta `expiryAuditedAt`/índice a `OrganizationInvitation`. Não remove, redefine ou copia dados existentes. Gerar tipos com `npm run db:generate`; aplicar no ambiente de destino com `npm run db:migrate` antes de executar a nova API. A entrega aplica/reaplica migrations apenas em PostgreSQL descartável, sem tocar no banco real.

Verificações focadas: lint/build backend; `test/audit.test.ts` testa contexto confiável, catálogo, cifragem/AAD, rollback em ambos os sentidos, falha de inserção com savepoint e expiração concorrente. As suítes existentes de autenticação, perfil e convites incluem asserções de eventos e ausência de segredos; suites organizacionais, de verificação de e-mail, unidade de trabalho e arquitetura verificam os fluxos alterados. Resultados efetivamente executados são informados na entrega, sem substituir essas verificações por resultados históricos.
