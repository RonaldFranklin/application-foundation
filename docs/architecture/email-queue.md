# Infraestrutura da fila de e-mail

## Escopo e composição

`EmailQueueModule` é infraestrutura NestJS, importada pela composição de `AppModule`. Registra a fila estável `email` com `@nestjs/bullmq` 12.0.0, BullMQ 6.3.11 e o driver ioredis 6.0.0, compatíveis com NestJS 12 e Node 24. As dependências e o lockfile são exclusivos do backend; o Dockerfile existente já instala e inclui essas dependências de runtime.

Não há produtor, consumidor, endpoint, job, payload, transporte de e-mail, template ou outbox. O contrato de envio será definido em etapa posterior, na fronteira adequada da aplicação. A existência da fila não envia e-mails nem confirma titularidade de endereços.

## Configuração e disponibilidade

`readQueueConfig` retorna uma união tipada: desabilitada ou habilitada com host, porta e senha. `EMAIL_QUEUE_ENABLED` aceita somente `true`/`false` e assume `false`. Quando desabilitada, não registra BullModule, providers de fila ou conexões Redis; credenciais Redis não são necessárias. Quando habilitada, exige `REDIS_HOST`, `REDIS_PASSWORD` (64 dígitos hexadecimais, segredo independente) e valida `REDIS_PORT` (1–65535, padrão 6379). Erros de configuração informam somente nomes de variáveis, nunca valores.

O registro não aguarda Redis durante a inicialização HTTP. Reconexões usam atraso crescente limitado a 5 segundos. Conexão e comandos têm timeout de 1 segundo, uma repetição por solicitação e fila offline de comandos desabilitada. Nenhum fluxo de autenticação injeta ou aguarda a fila; o health check da API continua independente do Redis. Compose não condiciona a API à saúde do Redis. Falhas de configuração explícitas impedem a inicialização; falhas de conectividade não.

O listener de erros registra apenas `email_queue_unavailable`, no máximo uma vez por instância. Não registra exceções, URLs, credenciais ou dados de jobs. A recuperação da conexão é automática, mas esse evento não constitui um monitoramento completo da fila. O fechamento das conexões é gerenciado pelo BullModule no encerramento NestJS. Antes de adicionar consumidores, revisar suas conexões bloqueantes e encerramento separadamente; não reutilizar automaticamente os limites de conexão de produtores em workers.

## Redis e dados

Compose fixa `redis:8.6.2-alpine`, também registrada em `infra/images.lock`. Apenas backend e Redis participam da rede interna `queues`; Redis não publica portas no host. O volume `application_foundation_redis_queue_data` é separado do PostgreSQL. AOF está habilitado com `appendfsync everysec` e política `noeviction`; uma falha abrupta pode perder aproximadamente o último segundo de escritas. Volume não substitui backup; monitorar disco/memória antes de colocar jobs reais em produção.

O script `infra/redis/start.sh` valida a senha, escreve a configuração em tmpfs com permissões restritas e delega à inicialização oficial da imagem, que executa Redis como usuário `redis`. A senha não é argumento de `redis-server`. O health check usa `REDISCLI_AUTH` no ambiente de `redis-cli`, sem `-a` e sem imprimir respostas de autenticação. Administradores do daemon ainda podem inspecionar o ambiente do container; usar um secret manager quando a plataforma oferecer essa integração. Nenhum segredo real faz parte do repositório.

Futuros payloads podem conter dados pessoais. Definir minimização, retenção de jobs concluídos/falhos, acesso, criptografia/backup e tratamento de retries junto do contrato futuro. Não registrar payloads ou usar senha temporária como contrato implícito. Nenhuma tabela, migration ou dado persistente existente é alterado nesta etapa.

## Verificação

`npm test` no backend inclui configuração, módulo desabilitado e inicialização/login/encerramento com Redis indisponível, usando PostgreSQL descartável. `npm run test:queue` é opt-in: exige Docker e a imagem Redis, inicia um único container descartável com credencial aleatória em memória, porta aleatória apenas no loopback e dados em tmpfs, verifica conexão BullMQ, autenticação, AOF e noeviction e remove somente esse container. Não cria mensagens nem toca nos volumes do Compose.

Fontes de integração: [filas no NestJS](https://docs.nestjs.com/techniques/queues), [conexões BullMQ](https://docs.bullmq.io/guide/connections) e [falha rápida sem Redis](https://docs.bullmq.io/patterns/failing-fast-when-redis-is-down). As opções foram conferidas também no código das versões instaladas.
