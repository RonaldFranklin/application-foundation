# Verificação opcional de e-mail

O perfil (`/settings` e `/admin/settings`) apresenta o estado do endereço e um modal nativo para solicitar, confirmar e reenviar o código. Início e perfil mostram aviso não bloqueante enquanto `emailVerifiedAt` for nulo. Login, permissões e funcionalidades não dependem desse estado. Trocar apenas nome/senha preserva a verificação; trocar o fingerprint do e-mail a remove.

## API e persistência

`POST /v1/auth/email-verification/request` recebe somente `{}`; `confirm` recebe somente `{"code":"123456"}`. Ambos exigem sessão plena (comum ou master), Origin exata, JSON e cookies existentes. Identidade e endereço nunca vêm do cliente. Solicitação aceita retorna `expiresAt` e `retryAfter`; confirmação retorna `emailVerifiedAt`. Aceitação da solicitação significa enfileiramento, não confirmação de entrega SMTP.

Erros específicos: `INPUT_INVALID`, `ALREADY_VERIFIED`, `CODE_INVALID`, `CODE_EXPIRED`, `CODE_USED` (400), `SESSION_REQUIRED` (401), `COOLDOWN`, `SEND_LIMIT`, `ATTEMPT_LIMIT` (429), `UNAVAILABLE` (503). Cooldown/limite de envios incluem `Retry-After` em segundos. Respostas não expõem códigos ou detalhes SMTP.

Migration aditiva `20261004000000_email_verification`: timestamp nullable no User e tabela EmailVerification, uma linha por usuário, identificador único por emissão. Não preenche usuários existentes como verificados. Histórico de no máximo cinco solicitações na última hora permanece após consumo/invalidação, inclusive ao trocar e-mail; é compactado na próxima emissão. A linha é removida em cascata apenas ao excluir a conta. Sem migração destrutiva, outbox ou alteração de permissões.

## Código e concorrência

Seis dígitos via `randomInt`, validade de dez minutos, cinco tentativas, cooldown de sessenta segundos e cinco solicitações por hora móvel. Requisições, confirmações, invalidação pelo perfil e envio usam o mesmo advisory lock transacional `account:<id>` do projeto. Sessão e identidade são relidas após obter o lock. Confirmação e consumo são atômicos; falhas incrementam tentativas antes de retornar. Emissão gira o identificador e evita repetir por acaso o código imediatamente anterior ainda com digest.

PostgreSQL guarda somente HMAC do código, ligado ao desafio/usuário/fingerprint do endereço. A subchave é derivada por HMAC-SHA256 da `HMAC_KEY` existente com propósito e `KEY_VERSION` específicos. Comparação usa `timingSafeEqual`. Chaves seguem o gerenciamento existente; não há chaves novas em ambiente.

O job `email.verification.v1` contém exclusivamente `challengeId` opaco e `encryptedCode`. O Vault existente protege o código com AES-256-GCM, envelope versionado e AAD que inclui propósito, desafio, conta e fingerprint. Redis não recebe destinatário, conteúdo ou código em claro. O contrato genérico `email.send` permanece para conteúdo não sensível.

## Entrega e limites operacionais

O worker delega a `DeliverVerification`, que carrega conta/desafio por portas, ignora estados expirados, consumidos, substituídos, bloqueados ou já entregues, decifra em memória e chama o sender existente. Até três tentativas, backoff exponencial inicial de cinco segundos, remoção imediata dos jobs concluídos/falhos. Erros permanentes não repetem; detalhes brutos são substituídos por códigos seguros. Nenhum payload é registrado em logs.

Publicação tem limite de dois segundos. Falha/timeout invalida apenas o desafio correspondente, mantendo o orçamento de envios, e não retorna sucesso. Publicação tardia encontra desafio inválido. Compensação depende do banco estar disponível; se ele também falhar, a resposta continua sendo erro, mas o estado/entrega pode ser incerto. Não há atomicidade distribuída PostgreSQL/Redis.

O lock de conta é mantido durante o envio para impedir que troca de endereço ou reemissão ultrapassem a validação do worker. Isso pode atrasar operações concorrentes da mesma conta; a transação tem timeout de 60 segundos e usa os limites SMTP existentes. Aceitação SMTP seguida de falha de commit pode provocar duplicidade em retry: não há garantia exactly-once nem cancelamento de mensagem já aceita. `deliveredAt` impede repetição após commit, mas não resolve essa janela. Códigos recebidos após expiração continuam inválidos.

A funcionalidade requer fila e entrega habilitadas para novas solicitações. Com entrega desabilitada, solicitar retorna indisponibilidade, sem afetar login. Os exemplos compartilhados mantêm envio desligado. A alteração autorizada no `.env` local só passa a valer na atualização futura do ambiente.

## Validação focada

- Backend: `npx tsx --test test/email-verification.test.ts test/email-delivery.test.ts`. PostgreSQL descartável, migration aplicada/reaplicada, filas e senders falsos; nenhum SMTP real.
- Frontend: `npx playwright test --config playwright.verification.config.ts`. API sintética isolada nas portas 18630/18631, sem dependência do ambiente local. Cobre aviso, modal por teclado, Escape/retorno de foco, cooldown, erros, sucesso, recarga, axe e larguras 1440/390/320.
- Lint/build em ambos os projetos e `npm run openapi` no backend. Não representam validação da suíte inteira.
- A migration e o processamento integrado Redis/SMTP reais exigem validação operacional posterior. Nenhum container é atualizado por esses testes.
