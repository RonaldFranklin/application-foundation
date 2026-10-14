# Infraestrutura — Application Foundation

Projeto independente; Dockerfile próprio deriva de PostgreSQL 17.9, `images.lock` fixa versões-base. `compose.yaml` executa imagens distintas para frontend, backend, PostgreSQL e Redis de filas. O serviço transitório `migrate` usa a imagem backend para aplicar migrações antes da API. Não há aplicação ou pacote npm de raiz.

## Preparar segredos localmente

```bash
cd /home/ronald/projetos/application-foundation/infra
cp .env.example .env
chmod 600 .env
```

Edite `.env` localmente. O arquivo é ignorado pelo Git e pelo build Docker. Nenhum valor real foi fornecido ou preenchido na implementação:

| Nome | Como preencher |
|---|---|
| `POSTGRES_PASSWORD` | senha local forte do banco |
| `DATABASE_URL` | `postgresql://login:<senha-percent-encoded>@db:5432/login`, com a mesma senha do PostgreSQL |
| `MASTER_USERNAME` | `Ronald`, valor inicial definido |
| `MASTER_EMAIL` | e-mail real, informado pelo operador exclusivamente no arquivo local/secret store |
| `MASTER_INITIAL_PASSWORD` | senha inicial real de pelo menos 15 caracteres, fornecida pelo operador |
| `ENCRYPTION_KEY` | 32 bytes aleatórios em 64 dígitos hexadecimais |
| `HMAC_KEY` | outros 32 bytes aleatórios independentes, mesmo formato |
| `KEY_VERSION` | `v1`; não alterar sem migração de chaves |
| `TURNSTILE_SECRET_KEY` | secret key somente backend; ambiente próprio |
| `TURNSTILE_SITE_KEY` | site key pública correspondente, incorporada no frontend |
| `TURNSTILE_HOSTNAME` | hostname esperado, `localhost` localmente |

Para gerar as duas chaves **diretamente no arquivo local**, sem imprimir seus valores, após copiar o exemplo:

```bash
node - <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
let env = fs.readFileSync('.env', 'utf8');
for (const name of ['ENCRYPTION_KEY', 'HMAC_KEY']) {
  const pattern = new RegExp(`^${name}=SUBSTITUA[^\\n]*$`, 'm');
  if (!pattern.test(env)) throw new Error(`${name} já preenchida; não sobrescrever`);
  env = env.replace(pattern, `${name}=${crypto.randomBytes(32).toString('hex')}`);
}
fs.writeFileSync('.env', env, {mode: 0o600});
NODE
```

Não cole valores reais em commits, README, terminal compartilhado ou esta conversa. Não execute `docker compose config` sem `--quiet` sobre um ambiente real para gerar relatórios; o comando expande segredos. Compose injeta segredos por env de runtime, nunca build args. Somente origem pública e site key pública são build args. Em uma plataforma real, prefira secret manager e acesso restrito ao daemon; env de container pode ser lido por administradores do host.

## Executar localmente com Docker

Habilite Docker Desktop → Settings → Resources → WSL Integration para esta distribuição (ou disponibilize Docker Engine/Compose localmente). Na inspeção inicial não havia daemon/CLI funcional; na correção de 3/10 o daemon local já estava disponível.

```bash
cd /home/ronald/projetos/application-foundation/infra
# Depois de preencher .env:
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

Abra `http://localhost:3000/admin/login` para o primeiro acesso master, ou `http://localhost:3000/login` para uma conta comum existente. O bootstrap cria somente a master; não cria usuários comuns de demonstração. O fluxo comum foi validado com fixtures descartáveis. O Master pode cadastrar contas comuns na gestão de usuários da organização, com senha temporária e troca obrigatória no primeiro acesso. Não há envio de convite/e-mail nem reset de senha.

Na master, use a senha inicial local, escolha uma senha nova, configure um autenticador e confirme um TOTP. Salve os recovery codes e confirme a conclusão. Somente então há acesso pleno. Reiniciar ou mudar a senha nas variáveis não redefine a senha gravada. Sem autenticador e sem recovery codes, não existe bypass: restauração administrativa exige procedimento separado, não implementado aqui.

`docker compose stop` interrompe; `docker compose start` retoma. `docker compose down` remove containers/rede e preserva o volume. **Não use `down -v` em dados a preservar.** Faça backups consistentes do PostgreSQL e backups protegidos das chaves, separados do banco. O volume sozinho não é backup.

## Aplicações nativas, banco Docker

```bash
cd /home/ronald/projetos/application-foundation/infra
docker compose -f compose.yaml -f compose.dev-db.yaml up -d db
```

Esse override publica PostgreSQL apenas em `127.0.0.1:5432`. Em dois terminais:

```bash
cd /home/ronald/projetos/application-foundation/backend
npm ci
cp .env.example .env
# Preencha valores locais; DATABASE_URL usa localhost, não db.
npm run db:generate
npm run db:migrate
npm run dev
```

```bash
cd /home/ronald/projetos/application-foundation/frontend
npm ci
cp .env.example .env.local
npm run dev
```

Cada projeto instala e compila sozinho. Para builds separados: `docker build -t application-foundation-backend:local ../backend`, `docker build -t application-foundation-frontend:local ../frontend` e `docker build -t application-foundation-postgres:local .`.

## Rede, HTTPS e operação

Banco fica somente na rede `database` interna, sem porta publicada no Compose principal. Backend também usa `web` para atender frontend e acessar Siteverify; frontend não participa da rede do banco. Portas de aplicação são publicadas apenas no loopback. A imagem roda aplicações como usuário `node`; a imagem oficial PostgreSQL usa sua própria inicialização.

O Compose entregue é de desenvolvimento local: `APP_ENV=development`, HTTP loopback. **Não é uma configuração de publicação.** Para HTTPS real: `APP_ENV=production`, origens HTTPS exatas no mesmo hostname, chaves Turnstile de produção, terminação TLS e encaminhamento `/v1` no proxy. A API recusa modo produção com origem HTTP ou chaves Turnstile de teste/ausentes. Configure `TRUST_PROXY` somente com IPs/CIDRs confiáveis; valor vazio é o padrão seguro. Não confie em cabeçalhos X-Forwarded-For arbitrários.

Limites iniciais são 10 logins/IP/min e 100 requisições API/IP/min. Três falhas comuns/MFA ou três reservas de verificação de senha master em 15 min iniciam cooldown: comum 5/10/20/30 min e master 1/2/4/5 min. A admissão master anônima é global; dispositivos reconhecidos por MFA possuem orçamento independente. O PostgreSQL guarda esses estados e os compartilha entre réplicas; não há cache local por processo. Redis pode ser considerado depois se métricas mostrarem que a tabela/locks de rate limit pressionam o banco. Consulte `backend/README.md`; Compose encaminha todas as variáveis.

Turnstile é adaptativo: após duas admissões sem MFA concluído exige token validado por Siteverify para todo o fluxo master, independentemente do identificador. Sem configuração local, o login nessa condição é recusado, inclusive se o browser enviar uma string qualquer. Use as [chaves oficiais de teste](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) exclusivamente em desenvolvimento/teste; configure a ação `master-login` e hostname correspondente. Não há bypass para indisponibilidade. Nenhuma chamada real ao serviço foi feita pelos testes; sucesso, erro, timeout/rede e respostas inválidas são simulados.

## Verificação de infraestrutura

```bash
docker compose --env-file .env.example config --quiet
docker compose --env-file .env.example -f compose.yaml -f compose.dev-db.yaml config --quiet
python3 scripts/test-browser.py
```

Os dois primeiros comandos validam estrutura, sem precisar de segredos reais ou iniciar containers. O terceiro inicia API com PostgreSQL real descartável e executa os testes independentes do frontend via HTTP; precisa das dependências npm instaladas em cada projeto e de Chromium disponível. Credenciais sintéticas são geradas em memória e nunca impressas. As portas padrão 3000/3001/15440 precisam estar livres. Para preservar serviços existentes, escolha três portas livres distintas com `LOGIN_TEST_FRONTEND_PORT`, `LOGIN_TEST_API_PORT` e `LOGIN_TEST_DB_PORT`, por exemplo:

```bash
LOGIN_TEST_FRONTEND_PORT=16430 LOGIN_TEST_API_PORT=16431 LOGIN_TEST_DB_PORT=16440 python3 scripts/test-browser.py
```

## Alterações operacionais da correção de segurança (2026-10-03)

- **Uma origem pública:** Compose passa `PUBLIC_API_ORIGIN` ao backend, ao build frontend e ao runtime frontend. Não configure mais `COOKIE_SECURE`; remova essa variável de configurações locais por conta própria, sem expor seus valores. No frontend nativo, configure `PUBLIC_API_ORIGIN` no lugar da duplicação de `NEXT_PUBLIC_API_ORIGIN`; esta última agora é derivada no build. Valores concorrentes diferentes são rejeitados. Nunca use a origem interna HTTP para decidir se o cookie público é Secure.
- **Reconstrução obrigatória quando a origem muda:** o frontend encerra com erro claro se build/runtime divergirem. O Dockerfile usa o argumento público `--build-arg PUBLIC_API_ORIGIN=https://login.example.invalid`; Compose já o preenche. Nenhum segredo é argumento de build.
- **Migration aditiva:** `202610030001_master_device` cria apenas a tabela de hashes/validade de dispositivos. O serviço `migrate` aplica antes da API. Não aplicar migrations nem resetar dados reais para testar esta correção; a suite usa bancos temporários.
- **Dispositivos:** `MASTER_DEVICE_DAYS=30` (máximo 30). Após MFA pleno, token HttpOnly/Secure em HTTPS permite usar um orçamento separado de senha, compartilhado entre réplicas. Logout normal preserva essa admissão; “Sair e esquecer este dispositivo” a revoga. Não é bypass de autenticação, CAPTCHA ou MFA.
- **Disponibilidade:** a proteção contra bloqueio provocado por terceiros vale para dispositivos já reconhecidos. Primeiro acesso e navegador sem cookie continuam no orçamento anônimo global, não contornável trocando IP. Bootstrap exige planejamento de acesso controlado. IP/NAT compartilhado, WAF, TLS, capacidade e indisponibilidade de Siteverify ainda precisam de validação operacional. Não foi feito teste de carga ou sondagem de produção.

## Implantação da edição de perfil

Reconstrua as imagens backend/frontend para disponibilizar os novos formulários e rotas. Não há migration, variável, serviço ou dependência novos. A revogação de sessões e dispositivos após alteração de senha é transacional no PostgreSQL compartilhado, inclusive entre réplicas. Variáveis de bootstrap não redefinem usuário/e-mail/senha após edição. O teste isolado de navegador agora cobre edição, cancelamento, erros e novo login após troca de senha, sem modificar o banco real.

## Implantação de organizações

A versão de organizações acrescenta a migration aditiva `202610030002_organizations`. Reconstrua as imagens frontend/backend; o serviço `migrate` existente aplica a tabela antes de iniciar a API. Não há variáveis ou serviços novos. Preserve o volume atual; não use reset, db push ou remoção de volumes. A migration foi validada apenas em PostgreSQL descartável, incluindo reaplicação idempotente pelo fluxo `migrate deploy`.

## Redis para a futura fila de e-mail

O Compose inclui `redis:8.6.2-alpine`, fixado em `images.lock`, na rede interna `queues`, sem porta publicada. Apenas backend compartilha essa rede. O volume `application_foundation_redis_queue_data` usa AOF (`appendfsync everysec`) e `noeviction`; é independente de `login_postgres_data`. Preserve ambos; monitoramento de memória/disco e backups devem ser definidos antes de enfileirar dados reais.

Acrescente `REDIS_PASSWORD` ao ambiente local/secret store: 32 bytes aleatórios codificados em 64 dígitos hexadecimais, diferentes dos segredos do banco e da aplicação. O exemplo contém somente placeholder. A senha de Redis local fica apenas em `infra/.env`, ignorado pelo Git, e não deve ser compartilhada. O script Redis valida o formato, cria um arquivo de configuração restrito em tmpfs e usa o entrypoint oficial para executar como usuário `redis`. O health check autentica por variável `REDISCLI_AUTH`, sem senha nos argumentos ou na saída.

Compose habilita `EMAIL_QUEUE_ENABLED=true` na API, com host `redis` e porta 6379, mas não inclui dependência de saúde do Redis no startup do backend: login continua disponível durante falha da fila. O desenvolvimento nativo permanece desabilitado por padrão. Não publique a porta Redis para habilitar a aplicação nativa sem uma decisão operacional específica.

Validação sem alterar o ambiente: os comandos `docker compose --env-file .env.example config --quiet` acima continuam válidos. Para o teste opcional de integração, execute `npm run test:queue` em `backend/`; usa um container isolado com dados em tmpfs, sem tocar no Compose ou volumes existentes. Nesta etapa não executar `compose up`, reconstruções ou reinicializações locais. Leia [a infraestrutura de fila](../docs/architecture/email-queue.md).

### Ativar o consumidor SMTP em uma implantação posterior

O Compose encaminha `EMAIL_DELIVERY_ENABLED` (padrão `false`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_FROM`. Preencha pelo secret store/ambiente e ative explicitamente somente quando o consumo for desejado. A fila pode continuar habilitada com consumo desligado. Falta de SMTP não descarta jobs nem produz sucesso fictício. Somente o backend recebe essas variáveis; nada é build arg ou enviado ao frontend. Nenhum container precisa ser atualizado para validar o YAML com `.env.example` e `config --quiet`.

### Gmail SMTP para desenvolvimento

A configuração preparada usa `smtp.gmail.com`, porta `587` e `SMTP_SECURE=false`; o adaptador exige STARTTLS e valida o certificado TLS. `SMTP_USER` deve ser o endereço Gmail completo. Para começar, configure `EMAIL_FROM` com esse mesmo endereço; outro remetente precisa estar autorizado como alias. Consulte a [configuração SMTP do Gmail](https://support.google.com/mail/answer/7104828).

Ative a verificação em duas etapas da Conta Google e gere uma senha de app dedicada a este projeto. Use-a em `SMTP_PASSWORD`, nunca use a senha normal da conta. Senhas de app exigem verificação em duas etapas e podem não estar disponíveis para contas com determinadas políticas ou proteções ([requisitos e gerenciamento](https://support.google.com/accounts/answer/185833)). O Google recomenda Sign in with Google quando aplicável; esta integração usa SMTP com senha de app para envio de servidor.

Edite `infra/.env` localmente e preencha `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_FROM`. Não cole a senha de app no chat, terminal compartilhado, README ou Git. Mantenha `EMAIL_DELIVERY_ENABLED=false` enquanto configura e valida. Após reconstruir a imagem backend, valide conexão, TLS e autenticação sem enviar e-mail e sem ligar o consumidor:

```bash
cd /home/ronald/projetos/application-foundation/infra
docker compose run --rm --no-deps backend npm run email:verify
```

A verificação não depende do Redis e imprime somente resultado genérico. Só depois de passar, defina `EMAIL_DELIVERY_ENABLED=true` em `infra/.env` e recrie o backend com `docker compose up -d --build backend`. Isso liga o consumidor, mas não dispara e-mails automaticamente: ainda não existe produtor. Senhas de app são revogadas quando a senha principal da Conta Google muda. Para produção ou volume elevado, revise limites e considere OAuth2 ou um provedor transacional.
