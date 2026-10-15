# Convites para organizações

## Fluxo e interface

A aba Usuários contém as subabas **Membros** e **Convites**, exibidas separadamente. Membros preserva busca, filtros, paginação e ações; Convites carrega as emissões atuais ao abrir e mantém o feedback dentro do próprio painel. Setas e Home/End navegam entre as subabas; durante uma gravação, a troca fica bloqueada. A subaba Convites oferece **Convidar usuário**, com e-mail e papel (Membro por padrão), listagem paginada por estado, reenvio e cancelamento. Emitir um convite não cria conta nem vínculo. O sucesso informa enfileiramento, não entrega na caixa de entrada. Os vínculos existentes continuam permitindo consulta, alteração de cargo, remoção lógica e restauração conforme as regras anteriores.

O destinatário abre `/invitations/accept#token=...`. A página extrai o token, remove o fragmento com `replaceState` e o mantém somente em memória. Recarregar exige reabrir o e-mail. A rota é dinâmica, compatível com o nonce CSP, tem `Referrer-Policy: no-referrer` e não é indexável. Uma prévia via POST exibe organização, papel e validade, sem consumir o convite e sem informar se o e-mail tem conta. GET não aceita convites. O token nunca vai em query, cookie, storage, resposta JSON ou URL de retorno.

A pessoa escolhe entre criar conta e usar conta existente; as duas opções sempre aparecem. Para conta nova, informa username, senha e confirmação. Para conta existente, entra pelo login normal em outra aba e retorna para confirmar. A sessão deve ser plena, comum e corresponder ao fingerprint convidado. Senha temporária de conta antiga precisa ser trocada pelo fluxo já existente antes do aceite. Outra conta, Master ou sessão parcial não pode aceitar como conta existente.

Aceitação cria conta comum sem senha temporária quando necessário, cria o vínculo e marca o e-mail como verificado na mesma transação. Não cria sessão automaticamente. A resposta orienta login normal. Erros de colisão, identidade incompatível e vínculo removido usam resposta genérica; nenhuma resposta pública consulta ou revela estado de outra organização.

## Autorização

Master pode gerir convites de organizações distintas. Contas comuns precisam de vínculo ativo e capacidades atuais na organização ativa e não excluída, verificadas no caso de uso em cada chamada. O namespace administrativo continua exclusivo do Master, inclusive com variações de maiúsculas na URL.

- Listar convites exige `members.read`.
- Emitir, reenviar ou cancelar exige **ambas** `members.create` e `members.link`. O convite não pergunta se a conta existe; exigir ambas evita ampliar silenciosamente uma concessão que antes autorizava apenas cadastro ou apenas vínculo.
- Emitir, reenviar ou cancelar um convite `ORGANIZATION_ADMIN` exige também `members.roles`.
- Administrador organizacional já possui essas capacidades fixas; Membro sem concessões não administra convites. Não foram adicionados papéis nem catálogo genérico.

`POST /v1/{admin/}organizations/:id/members` agora retorna **410** depois da verificação de acesso, inclusive para Master. O caso de uso `Members.add` também está fechado para chamadas internas; não há provisionamento direto que contorne consentimento. Clientes antigos devem migrar para convites. Primeiro acesso de contas antigas com senha temporária permanece suportado.

## Ciclo de vida e persistência

Migration aditiva `202610140001_organization_invitations` cria `OrganizationInvitation`, sem modificar contas/vínculos existentes. O registro contém ID opaco, organização, e-mail cifrado, fingerprint HMAC, cargo, digest, criador e datas de emissão, expiração, aceite, revogação e entrega. Não contém token recuperável. FKs preservam integridade e uma constraint impede aceite e revogação simultâneos.

A chave única `(organizationId, emailFingerprint)` mantém uma linha por destinatário/organização, uma garantia mais forte que apenas unicidade de pendentes. Emissões concorrentes são serializadas e a constraint protege contra duplicidade. Convite pendente duplicado retorna 409. A validade é de sete dias por emissão.

Reenvio substitui o digest imediatamente, reinicia validade e entrega; tokens anteriores deixam de funcionar. Convites expirados podem ser reemitidos; cancelados podem ser emitidos novamente pelo formulário com o mesmo e-mail. A linha é reutilizada, atualizando criador/data da emissão, sem histórico separado de tentativas. Aceitos não são reemitidos. Os limites de envio não são reiniciados pela revogação ou reemissão.

Vínculo ativo existente é preservado sem duplicação nem alteração do cargo; o aceite autenticado consome o convite e verifica o endereço. Vínculo removido não é restaurado pelo convite: exige o procedimento explícito do Master já existente. Cancelar/expirar um convite não afeta vínculos ou contas existentes.

## Tokens, locks e atomicidade

Token aleatório de 32 bytes via `randomBytes`, codificado base64url. O link transporta `id.token`. PostgreSQL persiste apenas SHA-256 com domínio `organization-invitation.v1` e contexto de convite, organização e fingerprint. Comparação usa `timingSafeEqual`. O e-mail usa índice cego de identidade já existente e envelope AES-256-GCM com AAD exclusivo de convite/organização.

A aplicação usa a ordem de locks **organização → conta existente → identity-update**; nenhum caminho de convite adquire locks na ordem inversa. Emissão, rotação, cancelamento, aceite e entrega compartilham o lock organizacional das alterações de membros, permissões e estado. Consultas/mutações administrativas incluem o ID da organização no repositório. Busca inicial pelo ID opaco só resolve a capacidade pública/worker e é seguida de validação criptográfica e releitura com escopo.

Argon2 ocorre fora da transação. Depois dos locks, o aceite relê convite/digest/estado/validade, organização, sessão, e-mail e vínculo. Criação de identidade, associação, consumo e verificação do e-mail concluem juntos ou sofrem rollback. O lock de identidade mantém as invariáveis dos dois namespaces de username/e-mail. Verificações de e-mail anteriores são invalidadas no aceite. Organização inativa ou excluída impede aceitação, mesmo com token válido.

## Fila, envio e falhas

Job dedicado `email.organization-invitation.v1` na fila BullMQ `email`, com somente `{invitationId, encryptedToken}`. Envelope cifrado pelo Vault com AAD separado de `email-verification`; Redis não recebe destinatário, papel, senha, sessão ou token puro. O contrato `email.send` não é usado. Não há segredo novo em ambiente.

O worker delega a `DeliverInvitation`, que carrega convite/organização, verifica estado, decifra somente em memória, compara digest e usa o sender SMTP existente. O link usa somente `FRONTEND_ORIGIN` configurada. Jobs antigos, aceitos, cancelados, expirados, de organização indisponível ou já entregues são ignorados. Até três tentativas, backoff exponencial inicial de cinco segundos, remoção dos jobs concluídos/falhos e erros sanitizados sem payload/detalhes SMTP.

Fila ou entrega desabilitada impede publicação e retorna 503. Falha/timeout de publicação (dois segundos) revoga somente a emissão correspondente, preservando os limites; uma compensação atrasada não revoga uma emissão posterior. PostgreSQL e Redis não têm transação distribuída/outbox. Se o banco também falhar na compensação, a resposta é erro mas a entrega pode ficar incerta. Falha SMTP posterior ao enfileiramento não pode ser conhecida na resposta de emissão: o job tenta novamente até o limite; operador pode reenviar pela interface.

O lock de organização permanece durante envio SMTP, com transação de até 60 segundos e os timeouts do sender. Isso pode atrasar operações daquela organização. Aceitação SMTP seguida de falha de commit/ACK pode produzir e-mail duplicado; não há garantia exactly-once. `deliveredAt` reduz duplicação após commit. Tokens antigos continuam recusados mesmo que um e-mail atrasado seja entregue.

## Limites e HTTP

Além do rate limit geral por IP, `RateState` mantém orçamento durável por organização/fingerprint: cooldown de **60 segundos**, até **5 emissões por hora móvel** e **20 por 24 horas**. Cada organização tem teto adicional de **100 emissões por hora móvel**. Consumo sob lock organizacional, compartilhado entre réplicas; falha de publicação também consome orçamento. Retorno 429 inclui `Retry-After`. E-mail é normalizado no servidor, até 254 caracteres, corpos são estritos.

| Método e rota (prefixo `/v1`) | Entrada / resultado |
|---|---|
| GET `/{admin/}organizations/:id/invitations` | Consulta paginada do escopo: `{items,total,page,pageSize,counts}` |
| POST `/{admin/}organizations/:id/invitations` | `{email,role?}` → `{queued:true,expiresAt}` |
| POST `/{admin/}organizations/:id/invitations/:invitationId/resend` | `{}` → nova emissão, mesmo ID |
| POST `/{admin/}organizations/:id/invitations/:invitationId/revoke` | `{}` → `{revoked:true}` |
| POST `/invitations/preview` | `{token}` → `{organization,role,expiresAt}`, sem consumo |
| POST `/invitations/accept` | `{token,mode:"existing"}` com sessão; ou `{token,mode:"new",username,password,confirmPassword}` → `{accepted:true}`, sem cookie novo |

POST exige JSON e Origin exata, inclusive prévia/aceite. O endpoint público não aceita organização, e-mail ou cargo no corpo. Falhas usam `code` e mensagem pública conhecida: 400 para estado/entrada/aceite incompatível, 401 para sessão requerida, 403 para autorização, 409 para convite pendente, 429 para limite e 503 para indisponibilidade. Prévia informa expirado/revogado/usado apenas após validar o token daquela emissão.

## Validação focada e implantação

Em `backend/`:

```bash
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm run db:generate
npm run lint
npm run build
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm run openapi
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npx tsx --test --test-concurrency=1 \
  test/organization-invitations.test.ts test/organization-admin.test.ts \
  test/organization-deletion.test.ts test/organization-permissions.test.ts \
  test/members.test.ts test/initial-common-password.test.ts \
  test/email-verification.test.ts test/email-delivery.test.ts \
  test/architecture.test.ts test/organization-contract.test.ts
```

Em `frontend/`: `npm run lint`, `npm run build` e `npx playwright test --config playwright.invitations.config.ts`. A suíte de convites usa API sintética nas portas 18830/18831 e cobre gestão, teclado/foco, erros, prévia sem consumo, remoção do fragmento, dois modos de aceite e axe/responsividade. As suítes organizacionais anteriores usam fixtures de contas legadas em servidor exclusivo de teste no loopback (porta da API + 1), nunca o endpoint de provisionamento da aplicação. A suíte geral não é necessária.

Testes de API usam PostgreSQL descartável na porta 15451 e filas/senders falsos; migrations são aplicadas/reaplicadas somente ali. Chromium pode usar `LD_LIBRARY_PATH=/tmp/invitation-browser-libs/usr/lib/x86_64-linux-gnu` enquanto existirem as bibliotecas extraídas temporariamente. Sem SMTP real ou containers nos testes. Validação executada em 2026-10-14: geração Prisma/OpenAPI, lint e build de backend/frontend aprovados; rodadas focadas do backend com 26 e 29 testes aprovados (há sobreposição), incluindo isolamento, concorrência, rollback, contratos e entrega; Playwright com 7 testes de convites e 6 de organizações aprovados. A suíte geral não foi executada.

Antes de implantar, aplicar a migration pelo procedimento operacional existente e habilitar fila/entrega conforme os guias de infraestrutura. Esta implementação não atualiza containers, banco ativo nem configurações locais. A entrega real Redis/SMTP exige validação operacional posterior autorizada.

Validação da separação em subabas: `npm run lint`, `npm run build` e `npx playwright test --config playwright.invitations.config.ts manage.spec.ts` aprovados. O teste focado cobre painéis exclusivos, envio/reenvio/cancelamento, carregamento e falhas com nova tentativa, teclado, axe e ausência de overflow da página em 390/320 px. Somente API sintética; sem SMTP, containers ou alteração de dados ativos.

A área de usuários usa um painel compacto com tabela, filtros e paginação. O cabeçalho mostra a contagem da consulta atual de membros (identificada quando filtrada/removida) e os convites pendentes após carregados, sem consultas adicionais para contagem. **Convidar usuário** abre um diálogo modal acessível a partir de qualquer subaba; cancelar/Escape devolve o foco ao botão, e envio bem-sucedido abre Convites com atualização e feedback. Erros de envio ficam no modal. Dados e permissões continuam vindo dos contratos existentes. Validação focada: lint/build frontend e `npx playwright test --config playwright.invitations.config.ts manage.spec.ts`.

## Consulta das emissões atuais

GET aceita `search` (trecho de e-mail, normalizado, até 254 caracteres), `status` (`all`, padrão; `pending`, `expired`, `accepted`, `revoked`), `page` (inteiro de 1 a 1000000, padrão 1) e `pageSize` (inteiro de 1 a 100, padrão 10). Parâmetros desconhecidos ou inválidos retornam 400. Cada item contém somente `id`, `email`, `role`, `createdBy` (username real do criador), `createdAt`, `deliveredAt` (data ou null), `expiresAt` e `status`. Não retorna digest, fingerprint ou envelopes.

A aplicação calcula o estado: aceito tem precedência sobre cancelado; sem ambos, prazo menor ou igual ao instante da consulta significa expirado; caso contrário, pendente. `counts` contém `all`, `pending`, `expired`, `accepted` e `revoked` após a busca e antes do filtro de estado. `total` considera ambos os filtros; a página não altera as contagens. Ordenação estável por emissão decrescente e ID crescente.

O repositório seleciona apenas campos de listagem da organização já autorizada. Como o e-mail é criptografado e o HMAC não permite busca parcial, a aplicação decifra, busca, conta e pagina em memória dentro desse escopo. O custo é proporcional aos convites dessa organização; não há índice em texto puro nem leitura de outras organizações. Essa estratégia pode exigir revisão para organizações com volumes muito grandes. Nenhuma migration é necessária.

A tabela exibe emissão junto ao e-mail; Envio usa exclusivamente `deliveredAt`, mostrando “Aguardando envio” quando null. Reenvio reutiliza a linha e atualiza criador, emissão, prazo e entrega; a tela não é histórico. Pendentes oferecem reenviar/cancelar; expirados, apenas reenviar; aceitos/cancelados não têm ações na linha. O formulário existente continua disponível no cabeçalho. Busca, filtro, estados e paginação pertencem apenas à subaba Convites, com rolagem restrita à tabela.

Verificação focada da listagem: backend `test/organization-invitations.test.ts`, `test/organization-contract.test.ts`, `test/organization-permissions.test.ts` e `test/architecture.test.ts`; frontend `manage.spec.ts` e `list.spec.ts` com API sintética, ambos os perfis, teclado, axe e capturas desktop/mobile. Execute lint e build de ambos os projetos junto dessas verificações.
