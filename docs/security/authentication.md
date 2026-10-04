# Autenticação e sessões

Esta documentação descreve a implementação atual da API e do frontend de Application Foundation. Os parâmetros refletem os valores padrão atuais e podem ser alterados pelas variáveis indicadas no [guia do backend](../../backend/README.md). Os controles reduzem riscos conhecidos, mas não constituem uma garantia de segurança absoluta nem substituem revisão e operação seguras.

## Modelo de identidade e autorização

- `User.master` identifica o único papel global de plataforma Master; a criação inicial ocorre por bootstrap usando `MASTER_USERNAME`, `MASTER_EMAIL` e `MASTER_INITIAL_PASSWORD`. O bootstrap usa lock transacional e uma constraint para impedir múltiplas contas Master. Depois que a conta existe, mudanças ou reinícios das variáveis de bootstrap não sobrescrevem suas credenciais.
- O login comum (`POST /v1/auth/login`) não autentica uma conta Master. Uma tentativa com credenciais Master nessa rota recebe resposta genérica de credencial inválida. O acesso Master usa o fluxo separado `/v1/admin/auth/*`.
- Contas comuns podem ser provisionadas pelo Master como membro de uma organização, com senha temporária e troca obrigatória no primeiro acesso. `MEMBER` e `ORGANIZATION_ADMIN` pertencem somente ao vínculo com a organização; nenhum deles concede privilégios de Master.
- O backend é a autoridade para identidade, estágio da sessão e autorização. IDs, tipo de conta e papel recebidos do cliente não determinam acesso.

## Senhas e dados armazenados

### Senhas

As senhas usam Argon2id com salt aleatório da biblioteca e os parâmetros atuais de memória de 64 MiB, três iterações e paralelismo 1. A política permite passphrases sem regras artificiais de composição; o limite configurado é de 15 a 1024 caracteres. Senhas não são cifradas e não podem ser recuperadas do banco.

O processo limita a quatro operações Argon2 simultâneas por padrão; ao esgotar a capacidade, a API responde temporariamente indisponível (503) com `Retry-After`. Cada operação consome aproximadamente 64 MiB, portanto a memória potencial cresce com o número de processos/contêineres.

### Identificadores e segredos

- Username, e-mail e segredo TOTP são cifrados com AES-256-GCM, nonce aleatório de 96 bits, tag de autenticação de 128 bits e AAD que vincula o valor à finalidade e à versão da chave.
- Busca e unicidade de username/e-mail usam índices cegos HMAC-SHA-256 com chave independente, após normalização NFKC, trim e lowercase. A aplicação não precisa consultar PII em texto claro no banco.
- `ENCRYPTION_KEY` e `HMAC_KEY` devem ser chaves independentes de 32 bytes (64 caracteres hexadecimais), mantidas fora do banco. A configuração atual carrega um único par e não oferece rotação automática. Trocar a chave ou `KEY_VERSION` sem um procedimento coordenado de recriptografia e reconstrução dos índices interrompe a leitura/autenticação; preserve backup protegido das chaves junto ao plano de recuperação.
- Senhas permanecem como hashes Argon2id. Tokens de sessão, tokens de dispositivo e códigos de recuperação são aleatórios e só seus digests SHA-256 são persistidos.

## Ciclo de sessão

A API não usa JWT como sessão. Após autenticação, gera um segredo aleatório opaco de 256 bits e o entrega somente em cookie; o banco armazena seu digest SHA-256, estágio, usuário e validade. O token não aparece em resposta JSON nem em `localStorage`/`sessionStorage`.

| Tipo | Validade padrão | Uso |
|---|---:|---|
| Sessão restrita | 10 minutos | Transições específicas, como troca obrigatória de senha, configuração/confirmação inicial de MFA ou conclusão de MFA. Não autoriza a aplicação inteira. |
| Sessão plena | 8 horas absolutas | Acesso permitido após o fluxo correspondente ser concluído. Não há renovação deslizante. |

O cookie de sessão é `HttpOnly`, `SameSite=Lax`, `Path=/` e não define `Domain`. Em HTTP local usa `login_session`; em HTTPS usa `__Host-login_session` com `Secure`. HTTPS é obrigatório quando `NODE_ENV=production`. A API rejeita sessão expirada na leitura, mesmo antes da tarefa periódica de limpeza.

Toda transição que eleva ou muda o estágio gira o token e invalida o anterior. Logout invalida a sessão no PostgreSQL. Alterar a senha revoga todas as sessões anteriores e, para o Master, revoga também os dispositivos reconhecidos; o usuário precisa fazer login completo novamente e o Master precisa concluir MFA.

## MFA do Master

O MFA TOTP é obrigatório para o Master antes de receber uma sessão plena. No primeiro acesso, a senha inicial exige troca; depois, o Master registra o autenticador, confirma um código e recebe dez códigos de recuperação de uso único. A sessão só se torna plena após a confirmação final do fluxo. Em logins posteriores, o Master informa senha e depois um código TOTP ou um código de recuperação ainda não consumido.

Parâmetros atuais do TOTP: SHA-1 conforme o perfil TOTP comum de autenticadores, seis dígitos, período de 30 segundos e janela de tolerância de um passo para cada lado. O último passo consumido é persistido de modo transacional para rejeitar replay e retrocesso de código. Códigos de recuperação contêm 128 bits aleatórios; somente hashes SHA-256 são armazenados e o consumo é atômico. Eles são apresentados uma única vez: não há regeneração nem recuperação silenciosa nesta versão. Se forem perdidos, o autenticador continua válido, mas os códigos antigos não podem ser exibidos novamente.

O Master também pode ter até dez dispositivos reconhecidos. Após MFA completo, o servidor define cookie aleatório de 256 bits com validade padrão de até 30 dias e mantém somente seu hash no banco. Esse cookie separa o orçamento de tentativas do dispositivo do orçamento anônimo global; **não é uma sessão, não autentica, não concede acesso e não substitui senha, CAPTCHA ou MFA**. Cookies inválidos, expirados ou revogados usam o orçamento anônimo. Logout normal preserva o reconhecimento do dispositivo; a opção de sair e esquecê-lo também o revoga.

## Limites contra abuso e enumeração

Os valores abaixo são os padrões configurados; consulte a tabela completa no [guia da API](../../backend/README.md#limites-configuráveis).

| Controle | Padrão atual | Comportamento |
|---|---:|---|
| Requisições de login por IP | 10 em 60 s | Soma os fluxos comum e Master; retorna 429 com `Retry-After`. |
| Requisições gerais da API por IP | 100 em 60 s | Limite móvel complementar por IP. |
| Falhas de login comum por conta | 3 em 15 min | Cooldown progressivo de 5, 10, 20 e até 30 min. |
| Falhas de MFA Master por conta | 3 | Cooldown Master compartilhado entre sessões, dispositivos e réplicas. |
| Admissões anônimas no login Master | 3 em 15 min | Cooldown global Master progressivo de 1, 2, 4 e até 5 min; compartilhado entre IPs e réplicas. |
| Falhas de MFA Master | 3 | Cooldown separado por conta, compartilhado entre sessões, dispositivos e réplicas. |
| Desafio adaptativo Master | após 2 admissões sem MFA concluído | Exige token Turnstile no fluxo Master, inclusive para identificadores não existentes; sucesso MFA limpa o sinal global. |

Contadores, bloqueios, sessões e dispositivos são persistidos no PostgreSQL. Reservas de tentativas usam advisory locks transacionais antes do trabalho de senha, evitando que requisições concorrentes em diferentes réplicas ultrapassem o orçamento com base em leituras antigas. Não há estado de rate limit somente em memória e Redis não é usado nesta versão. Registros expirados são removidos periodicamente, mas sua validade já é imposta durante a leitura.

Identificadores inválidos, conta desconhecida, senha incorreta, fluxo de login errado, cooldown e MFA inválido usam resposta genérica para reduzir enumeração. O login comum consulta apenas contas não Master. Para identificadores inexistentes, o sistema usa bucket HMAC por IP em vez de criar um registro ilimitado por texto arbitrário. A equalização de trabalho reduz diferenças óbvias, mas não promete tempo matematicamente constante.

### Turnstile

O desafio é verificado no servidor por Siteverify, com timeout de quatro segundos. A resposta deve indicar sucesso e corresponder à ação `master-login`, hostname configurado e timestamp com menos de cinco minutos; a validação de uso único/expiração também é aplicada pelo serviço. Quando o desafio é exigido, token inválido, configuração ausente ou indisponibilidade resulta em negação do login (fail closed). CAPTCHA não substitui os limites nem os fatores de senha e MFA.

## Proteções HTTP e banco

- Helmet fornece headers de segurança; CORS permite uma origem exata e credenciais.
- Métodos de escrita exigem `Origin` exatamente igual a `FRONTEND_ORIGIN`, rejeitam `Sec-Fetch-Site: cross-site` e aceitam apenas JSON. Payloads têm limite de 8 KiB. Respostas autenticadas usam `Cache-Control: no-store` e `Pragma: no-cache`.
- Em produção, frontend e API devem usar HTTPS e o mesmo hostname público compatível com o cookie host-only. Configure `TRUST_PROXY` apenas com IPs/CIDRs dos proxies confiáveis; valor vazio ignora `X-Forwarded-For`.
- Prisma usa consultas parametrizadas; SQL explícito de locks usa tagged templates parametrizados, sem concatenação de entrada em SQL.
- Erros de dependência são sanitizados. Eventos de segurança mantêm somente nome do evento e fluxo, sem identificador, IP bruto, senha, cookie, token ou código. Não habilite query logging ou request/body logging em proxy sem redação adequada.

## Limites conhecidos e operação

- A troca de e-mail é imediata após reautenticação, mas a posse do novo endereço não é verificada. Não há serviço de e-mail, verificação de e-mail nem recuperação de senha nesta versão.
- MFA obrigatório está implementado para o Master; MFA para contas comuns não faz parte do escopo atual.
- Sem prova prévia de MFA, o servidor não consegue distinguir com certeza um primeiro acesso legítimo de alguém que conhece o identificador e resolve o desafio. Ataque distribuído, indisponibilidade do Turnstile, abuso de um mesmo IP/NAT ou exaustão de recursos ainda podem afetar a disponibilidade. As proteções não são uma solução geral de DDoS.
- Calibre memória Argon2, limites e proteção de borda para o número real de réplicas/carga. Os limites persistentes são compartilhados, mas a capacidade de hash é configurada por processo.
- Segredos e backups das chaves precisam de controle de acesso fora do banco e do repositório. `.env` real não deve ser versionado; use `.env.example` somente como modelo sem valores reais.

Este documento descreve o comportamento do código atual. Rotas, contratos, variáveis e procedimentos operacionais completos estão nos READMEs de [backend](../../backend/README.md) e [infraestrutura](../../infra/README.md). Mudanças futuras de segurança devem atualizar ambos e ser validadas com auditoria e testes apropriados.
