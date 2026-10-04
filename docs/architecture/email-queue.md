# Infraestrutura da fila de e-mail

## Escopo e composição

`EmailQueueModule` é infraestrutura NestJS, importada pela composição de `AppModule`. Registra a fila estável `email` com `@nestjs/bullmq` 12.0.0, BullMQ 6.3.11 e o driver ioredis 6.0.0, compatíveis com NestJS 12 e Node 24. As dependências e o lockfile são exclusivos do backend; o Dockerfile existente já instala e inclui essas dependências de runtime.

O consumo técnico é opt-in. `EmailWorker` é um adaptador de entrada BullMQ com ciclo de vida NestJS, dentro do mesmo módulo e da mesma fila. `EmailProcessor` traduz o envelope e chama `DeliverEmail`; esse caso de uso valida a mensagem e coordena a porta `EmailSender`. `SmtpSender` implementa a porta com Nodemailer 10.0.14, dependência de runtime escolhida para SMTP configurável, TLS e tradução de respostas sem acoplar aplicação ou consumidor ao provedor. A verificação opcional usa um job dedicado e produtor autenticado descritos abaixo; não há endpoint genérico de envio, outbox ou enfileiramento automático.

## Configuração e disponibilidade

`readQueueConfig` retorna uma união tipada: desabilitada ou habilitada com host, porta e senha. `EMAIL_QUEUE_ENABLED` aceita somente `true`/`false` e assume `false`. Quando desabilitada, não registra BullModule, providers de fila ou conexões Redis; credenciais Redis não são necessárias. Quando habilitada, exige `REDIS_HOST`, `REDIS_PASSWORD` (64 dígitos hexadecimais, segredo independente) e valida `REDIS_PORT` (1–65535, padrão 6379). Erros de configuração informam somente nomes de variáveis, nunca valores.

O registro não aguarda Redis durante a inicialização HTTP. Reconexões usam atraso crescente limitado a 5 segundos. Conexão e comandos têm timeout de 1 segundo, uma repetição por solicitação e fila offline de comandos desabilitada. Nenhum fluxo de autenticação injeta ou aguarda a fila; o health check da API continua independente do Redis. Compose não condiciona a API à saúde do Redis. Falhas de configuração explícitas impedem a inicialização; falhas de conectividade não.

O listener de erros registra apenas `email_queue_unavailable`, no máximo uma vez por instância. Não registra exceções, URLs, credenciais ou dados de jobs. A recuperação da conexão é automática, mas esse evento não constitui um monitoramento completo da fila. O fechamento das conexões é gerenciado pelo BullModule no encerramento NestJS. O worker usa conexões separadas, com `maxRetriesPerRequest: null`, fila offline habilitada e sem timeout de comandos bloqueantes; não herda os limites de produtores. Concorrência inicial: 1. Seu listener registra apenas `email_worker_unavailable`, uma vez por instância. Encerramento aguarda o processamento ativo; se Redis nunca ficou pronto, fecha imediatamente sem esperar um loop que não pode terminar.

## Redis e dados

Compose fixa `redis:8.6.2-alpine`, também registrada em `infra/images.lock`. Apenas backend e Redis participam da rede interna `queues`; Redis não publica portas no host. O volume `application_foundation_redis_queue_data` é separado do PostgreSQL. AOF está habilitado com `appendfsync everysec` e política `noeviction`; uma falha abrupta pode perder aproximadamente o último segundo de escritas. Volume não substitui backup; monitorar disco/memória antes de colocar jobs reais em produção.

O script `infra/redis/start.sh` valida a senha, escreve a configuração em tmpfs com permissões restritas e delega à inicialização oficial da imagem, que executa Redis como usuário `redis`. A senha não é argumento de `redis-server`. O health check usa `REDISCLI_AUTH` no ambiente de `redis-cli`, sem `-a` e sem imprimir respostas de autenticação. Administradores do daemon ainda podem inspecionar o ambiente do container; usar um secret manager quando a plataforma oferecer essa integração. Nenhum segredo real faz parte do repositório.

O destinatário e o texto são dados potencialmente pessoais armazenados no Redis. O contrato abaixo é exclusivo para mensagens não sensíveis: nunca incluir senhas, tokens, credenciais SMTP, mensagens de autenticação ou anexos. A validação estrutural rejeita campos adicionais, mas não consegue determinar se texto arbitrário contém um segredo; essa classificação deve ocorrer antes de um futuro produtor enfileirar dados. O produtor de verificação não utiliza esse contrato; sua persistência é descrita na documentação específica.

## Contrato de consumo

Não existia payload anterior. O nome do job aceito é `email.send`, na fila existente `email`. Dados JSON estritos:

| Campo | Regra |
|---|---|
| `version` | Número literal `1` |
| `correlationId` | UUID da mensagem lógica, reutilizado nas tentativas |
| `to` | Um único endereço de e-mail, até 254 caracteres |
| `subject` | Texto de 1–200 caracteres após trim; sem CR, LF ou NUL |
| `text` | Texto simples de 1–10.000 caracteres após trim; sem NUL |

Não aceita HTML, anexos, headers, remetente fornecido pelo job, múltiplos destinatários, credenciais ou campos extras. O remetente e a conexão SMTP vêm exclusivamente da configuração. O processor verifica nome/versão e formato do envelope; a aplicação valida os campos semânticos. Retorno do job contém apenas `{accepted: true}`, depois da aceitação do destinatário pelo SMTP. Aceitação não comprova chegada à caixa de entrada.

## SMTP e ativação

`EMAIL_DELIVERY_ENABLED` aceita `true`/`false` e assume `false`, inclusive no Compose. Sem ativação, nenhum worker ou sender é registrado: jobs permanecem aguardando, sem envio simulado ou remoção. Ativar exige `EMAIL_QUEUE_ENABLED=true` e configuração completa: `SMTP_HOST`, `SMTP_PORT` (1–65535), `SMTP_SECURE` (`true`/`false`), `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_FROM` (endereço simples). Configuração inválida encerra o startup com nomes de variáveis, nunca seus valores. Nenhum arquivo real de ambiente deve ser versionado.

`SMTP_SECURE=true` usa TLS desde a conexão (normalmente 465); `false` exige STARTTLS (normalmente 587). Certificados são verificados e TLS mínimo é 1.2. Não há modo silencioso de plaintext, transporte de console nem sucesso fictício em produção ou desenvolvimento. A criação do transporte não verifica SMTP no bootstrap; a conexão ocorre somente durante o envio. DNS/conexão/greeting têm limites de 10 segundos e socket de 30 segundos. Logs/debug SMTP, leitura de arquivos e carregamento por URL ficam desabilitados.

## Falhas, tentativas e duplicidade

Dados inválidos e recusas permanentes viram `UnrecoverableError` no consumidor. SMTP 5xx e erros de autenticação/envelope/mensagem/TLS são permanentes; SMTP 4xx prevalece como transitório, inclusive falha temporária de autenticação. Falhas de rede/timeouts e erros desconhecidos são transitórios e chegam ao BullMQ como `Error`. Nunca persistir detalhes brutos do provedor em `failedReason`, stacktrace ou logs: apenas códigos `EMAIL_*` sanitizados.

A infraestrutura anterior não definia `attempts` nem `backoff`. Essa política permanece: sem opções no job, há uma tentativa; se um futuro produtor definir tentativas/backoff, BullMQ os aplicará às falhas transitórias. Não há loop próprio de envio ou retry ilimitado. As opções de conexão Redis não são a política de tentativas de jobs.

A entrega é at-least-once. O `Message-ID` usa o UUID de correlação e o domínio de `EMAIL_FROM`, mantendo-se estável em retries com a mesma configuração. Isso ajuda rastreabilidade, mas não é uma chave de idempotência SMTP e não impede duplicidade após aceitação seguida de interrupção antes do ACK no Redis. Não existe suporte de idempotência no provedor genérico nem outbox neste projeto. Cada mensagem lógica deve ter UUID próprio. Retenção (`removeOnComplete`/`removeOnFail`), minimização e controles de acesso devem ser definidos pelo futuro produtor antes de uso com dados reais; a retenção padrão anterior do BullMQ permanece inalterada.

## Verificação

`npm test` no backend inclui configuração, módulo desabilitado e inicialização/login/encerramento com Redis indisponível, usando PostgreSQL descartável. `npm run test:queue` é opt-in: exige Docker e a imagem Redis, inicia um único container descartável com credencial aleatória em memória, porta aleatória apenas no loopback e dados em tmpfs, verifica conexão BullMQ, autenticação, AOF e noeviction e remove somente esse container. Não cria mensagens nem toca nos volumes do Compose.

Fontes de integração: [filas no NestJS](https://docs.nestjs.com/techniques/queues), [conexões BullMQ](https://docs.bullmq.io/guide/connections) e [falha rápida sem Redis](https://docs.bullmq.io/patterns/failing-fast-when-redis-is-down). As opções foram conferidas também no código das versões instaladas.

### Validação focada do consumo

`npx tsx --test test/email-delivery.test.ts` testa somente aplicação/processor/adaptador/configuração de e-mail e encerramento do worker sem Redis. Usa sender e transporte SMTP falsos; não envia mensagens reais nem cria containers. Não requer a suíte geral, banco, frontend ou testes de autenticação/organizações. A entrega SMTP real e o processamento completo com Redis disponível exigem validação operacional posterior; não executar `test:queue` nesta etapa, pois ele cria um container.

Referências: [transporte SMTP do Nodemailer](https://nodemailer.com/smtp) e [erros irrecuperáveis do BullMQ](https://docs.bullmq.io/patterns/stop-retrying-jobs).

## Perfil Gmail SMTP preparado para desenvolvimento

Os arquivos de exemplo usam `smtp.gmail.com:587` com `SMTP_SECURE=false`. O adaptador exige STARTTLS, TLS mínimo 1.2 e valida o certificado. Configure `SMTP_USER` com o endereço Gmail completo e use inicialmente o mesmo endereço em `EMAIL_FROM`; outro remetente precisa estar autorizado como alias. O Gmail exige autenticação e documenta TLS/STARTTLS na porta 587 ([configuração SMTP](https://support.google.com/mail/answer/7104828)).

Use uma senha de app dedicada em `SMTP_PASSWORD`, nunca a senha normal da conta. A senha de app requer verificação em duas etapas e pode não estar disponível conforme a política ou proteção aplicada à conta ([requisitos do Google](https://support.google.com/accounts/answer/185833)). O Google recomenda Sign in with Google quando aplicável; esta configuração SMTP usa senha de app para o envio de servidor acordado.

Os exemplos compartilhados mantêm a entrega desligada. Preencha `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_FROM` em `infra/.env`; não cole a credencial no chat, terminal compartilhado ou Git. Para conferir conexão, TLS e autenticação sem enviar mensagem nem iniciar o worker:

```bash
cd /home/ronald/projetos/application-foundation/infra
docker compose run --rm --no-deps backend npm run email:verify
```

O comando imprime apenas sucesso ou uma orientação genérica; não revela credenciais nem detalhes brutos do Google. Depois da verificação, `EMAIL_DELIVERY_ENABLED=true` ativa o worker ao recriar o backend. Isso não envia e-mails por conta própria: o produtor de verificação opcional cria jobs apenas após solicitação autenticada. Ao mudar a senha da Conta Google, senhas de app existentes são revogadas. Para produção ou volume elevado, avalie OAuth2 ou um provedor transacional dedicado.

## Verificação de titularidade

O job dedicado `email.verification.v1` usa somente identificador opaco e envelope cifrado. Possui retry/backoff limitado e remoção imediata próprios, sem modificar o contrato ou as opções padrão de `email.send`. [Segurança, persistência e limites de entrega](../features/email-verification.md).
