# Verificações — 2 de outubro de 2026, America/Sao_Paulo

Implementação no WSL `/home/ronald/projetos/application-foundation`. Node 24.16.0, npm 11.13.0. Não houve deploy, push, criação de conta real ou leitura de arquivos locais de segredo. Só existem `.env.example` no projeto; configuração real cabe ao operador. Nenhum código/segredo foi enviado a serviço de análise externo. Downloads de dependências/documentação e bibliotecas públicas foram necessários para os testes.

## Resultados finais

| Verificação | Comando / mecanismo | Resultado |
|---|---|---|
| Backend lint | `cd backend && npm run lint` | Passou |
| Backend build | `cd backend && npm run build` | Passou, `dist/main.js` |
| Backend testes | `cd backend && npm test` | **20 passaram**, zero falhas/skip; pretest gera Prisma e compila |
| PostgreSQL/migrations | `prisma migrate deploy` duas vezes por fixture | Passou contra PostgreSQL **17.9** real, temporário, sem Docker |
| Bootstrap/execução compilada | teste inicia `node dist/main.js`, usa health e confere hash persistido | Passou, sem reset de senha |
| OpenAPI | `cd backend && npm run openapi` | Passou; `openapi.json` v1.0.0, rotas `/v1` |
| Frontend lint | `cd frontend && npm run lint` | Passou |
| Frontend build | `cd frontend && NEXT_TELEMETRY_DISABLED=1 npm run build` | Passou; logins renderizados e boas-vindas dinâmicas |
| Navegador | `LD_LIBRARY_PATH=/tmp/login-browser-libs/usr/lib/x86_64-linux-gnu python3 infra/scripts/test-browser.py` | **9 passaram**, zero falhas/skip; Chromium real |
| Acessibilidade | Playwright + axe, teclado, labels, OAuth inerte | Passou em 1440×1000, 390×844 e 320×700; sem violações axe encontradas |
| Compose principal | `/tmp/login-docker-compose --env-file .env.example -f compose.yaml config --quiet`, dentro de `infra` | Passou |
| Compose com porta local de banco | comando anterior com `-f compose.dev-db.yaml` adicional | Passou |
| Separação | estrutura, ausência de package.json raiz, locks, Dockerfiles, env ignores | Passou |
| Auditoria backend | `cd backend && npm audit` | **0 vulnerabilidades reportadas** |
| Auditoria frontend runtime | `cd frontend && npm audit --omit=dev` | **0 vulnerabilidades reportadas** |
| Auditoria frontend completa | `cd frontend && npm audit` | **5 alertas altos** na cadeia de desenvolvimento de `braces`; ver abaixo |
| Imagens Docker / execução Compose | não executável sem daemon Docker neste WSL | **Pendente**, não considerado aprovado |

Os nove testes de navegador incluem sete verificações de UI/contrato simulado e dois fluxos reais completos: usuário comum → boas-vindas SSR → logout; master → senha nova → TOTP → recovery codes → confirmação → boas-vindas → novo login com recovery code. API e PostgreSQL são iniciados pelo script com senhas sintéticas aleatórias em memória. Nenhuma credencial real é necessária.

A suite backend cobre: validação da configuração; Argon2id, salt, passphrases e não truncamento; AES-GCM, nonce, AAD e tag inválida; índice HMAC; bootstrap concorrente/idempotente; SQL injection tratado como dado; respostas genéricas; estágios restritos e rotação; TOTP e replay; recovery codes de uso único, inclusive concorrência; isolamento comum/master; CSRF; tamanho do payload; expiração/revogação; IP concorrente; cooldown/aliases/escalada até 30 min; Turnstile adaptativo e validações; X-Forwarded-For não confiável; cookie HTTPS e CORS; expiração restrita; inicialização compilada.

## Correções feitas após executar verificações

- Ajustes de configuração TypeScript para NestJS 12, Node 24 e pacotes ESM; tipagens de Swagger/Argon2.
- Respostas HTTP de sucesso padronizadas em 200, evitando o 201 padrão de POST Nest.
- Limpeza dos campos ao mudar o estágio do formulário; validação do mínimo da senha também por pontos de código Unicode.
- Selectors Playwright específicos para o título principal e erro de formulário (Next também cria anunciador acessível).
- Dependências Prisma transitivas com alertas corrigidas por overrides explícitos: `deepmerge-ts=8.0.2`, `mysql2=3.24.5`. Geração, migração, build, startup e testes passaram com os overrides, sem migrar para Prisma 8.
- Cookies `Secure`/prefixo `__Host-` em qualquer origem pública HTTPS; configuração exige mesmo hostname para SSR e cookie host-only.

Argon2id foi medido entre **109 e 120 ms/hash** nas rodadas, com 64 MiB, 3 iterações e paralelismo 1. Não é benchmark de capacidade sob carga nem garantia de segurança perfeita.

## Ambiente e limitações

Docker não está integrado nesta distribuição WSL e sudo não é não interativo. Foi usado o binário público standalone do Compose **2.39.4**, em `/tmp/login-docker-compose`, apenas para validar YAML. Não foram construídas ou iniciadas imagens; isso deve ser validado após habilitar Docker. Migrations e runtime da API foram executados nativamente contra PostgreSQL real, fornecido pelo pacote de teste `embedded-postgres@17.9.0-beta.17` (o rótulo beta é do wrapper; o servidor é PostgreSQL 17.9). Não houve substituição por mock de banco.

Chromium estava disponível, mas faltavam `libnspr4`, `libnss3` e `libasound2t64`. Foram baixados os pacotes públicos Ubuntu e extraídos com `dpkg-deb -x` em `/tmp/login-browser-libs`, sem instalação global. O LD_LIBRARY_PATH acima permitiu executar todos os testes. Esse diretório é temporário; em uma máquina configurada com as dependências do Playwright, não é necessário.

Frontend completo possui cinco alertas altos referentes à mesma cadeia `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. O advisory é [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); a versão publicada `braces@3.0.3` ainda está afetada. Não houve correção compatível disponível; a sugestão automática de downgrade para ESLint config do Next 14 foi rejeitada. A exposição é em ferramenta de lint com padrões locais, não nas dependências de runtime nem na imagem standalone. Acompanhar atualização upstream.

Siteverify foi validado por simulações de sucesso, rejeição, hostname/ação/timestamp incorretos e falha de rede. Não foi feita chamada real à Cloudflare nem teste com chave de produção. TLS real, proxy de produção e restauração de backups também não foram exercitados. O cookie Secure foi verificado na resposta HTTP com origem configurada HTTPS, não em uma terminação TLS real.

A CSP frontend ainda admite inline script/style para o Next; nonce por requisição é um aprimoramento futuro. Rotação automática de chaves, provisionamento de usuários comuns, regeneração de recovery codes e recuperação administrativa não foram adicionados fora do escopo. Limites e custo de hash requerem calibração em carga real. Não há promessa de ausência de vulnerabilidades.

O `AGENTS.md` da raiz e `docs/planejamento-login.md` citados no prompt não existiam. Posteriormente o próprio Next dev gerou `frontend/AGENTS.md` e `CLAUDE.md`; o guia local de cookies foi lido e a implementação usa a API assíncrona documentada. A imagem de referência não estava disponível, então o visual foi baseado na descrição textual.

## Iniciar a aplicação

Leia `infra/README.md` para preencher segredos sem registrá-los. Após habilitar Docker e configurar `infra/.env`:

```bash
cd /home/ronald/projetos/application-foundation/infra
docker compose config --quiet
docker compose build
docker compose up -d
```

Entradas: `http://localhost:3000/login` e `http://localhost:3000/admin/login`. As instruções para rodar frontend/backend nativamente em terminais separados também estão no README da infraestrutura.


## Melhorias de segurança e revalidação — 3 de outubro de 2026

- O login consulta o estado de bloqueio antes de Siteverify e Argon2. CAPTCHA e Argon2 são executados fora de transações/locks do PostgreSQL; a decisão final e a atualização de falhas continuam protegidas por lock e transação, com revalidação do hash para rejeitar senha que tenha sido rotacionada durante a verificação.
- Um CAPTCHA ausente/inválido não bloqueia a conta master. O rate limit por IP segue limitando essas chamadas; apenas senha incorreta após CAPTCHA válido incrementa as falhas da conta.
- Cooldown progressivo comum: 5/10/20/30 min. Master: 1/2/4/5 min. Bloqueio ativo retorna cedo e novas chamadas não o estendem.
- Identificadores inexistentes compartilham um bucket por IP protegido por HMAC, em vez de criar uma linha de rate state por e-mail/username arbitrário.
- Concorrência de Argon2 limitada a 4 operações por processo por padrão (64 MiB por operação); capacidade cheia retorna 503 com Retry-After e não cria fila de hashes. Configurável em `PASSWORD_HASH_CONCURRENCY`.
- A CSP usa nonce aleatório por resposta em `frontend/src/proxy.ts`; produção não permite `unsafe-inline` em scripts/estilos. As páginas de login são renderizadas dinamicamente e o nonce também é aplicado ao script Turnstile.
- Decisão sobre Redis: `RateState` já é persistido no PostgreSQL e compartilhado atomicamente entre réplicas, então não existe o problema de bloqueio preso ao processo local. Redis fica como opção futura para throughput se métricas indicarem pressão dos contadores no banco; o PostgreSQL continua sendo a fonte durável dos bloqueios de conta.
- Backend: `npm test` — 23 passaram; `npm run lint` — passou.
- Frontend: `npm run lint` e `npm run build` — passaram. Teste HTTP da saída standalone retornou 200, encontrou CSP sem `unsafe-inline`, 12 scripts com o nonce daquela resposta e nonces diferentes entre duas respostas.
- Compose: `docker compose --env-file .env.example config --quiet` e `build` concluídos; imagens frontend, backend e PostgreSQL construídas com placeholders. Containers não foram iniciados nem configurados com segredos.
- A suíte Playwright atual não foi reproduzida: Chromium aborta antes dos testes por falta de `libnspr4.so`. O teste de CSP por navegador foi adicionado, mas permanece sem execução neste ambiente; a verificação HTTP acima cobre a geração do header e aplicação do nonce no HTML SSR.
