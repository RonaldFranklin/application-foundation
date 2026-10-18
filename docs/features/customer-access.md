# Contas de clientes externos

## Decisão de arquitetura (18/10/2026, antes da implementação)

A identidade interna é `User`: Master é uma marca imutável; `PlatformAdmin` acrescenta elegibilidade administrativa; `OrganizationMember` associa uma conta comum a uma organização. Sessões internas referenciam exclusivamente User. Convites internos não representam contas de clientes.

Cliente será um principal independente (`Customer`, `CustomerSession`, `CustomerToken`, `CustomerRecoveryCode`), sem vínculo com User, promoção administrativa ou fallback entre logins. Cada cliente pertence permanentemente a uma organização. O índice HMAC de e-mail será globalmente único nessa tabela, inclusive para pendentes/suspensos; colisões com identidades internas não associam contas. E-mail e nome serão cifrados com propósito próprio. Não haverá exclusão nesta entrega.

Estados: pending → active por aceite; active ↔ suspended por gestão organizacional. Convite cancelado/expirado conserva a reserva do e-mail e a conta pendente para reemissão pela mesma organização. A resposta a colisão não revela organização ou identidade externa.

Permissões novas e mínimas: customers.read (lista/detalhe), customers.invite (emissão/cancelamento/reemissão), customers.manage (suspensão/reativação). Administrador organizacional tem essas capacidades; Member somente por concessão explícita. Master/PlatformAdmin são recusados antes da leitura de clientes, inclusive se possuírem IDs ou grants. Escopo vem do vínculo interno atual, nunca do corpo ou query.

Reutilizar Vault AES-GCM/HMAC, PasswordWork Argon2id, gerador de tokens, TOTP, RateState, UnitOfWork, auditoria cifrada e fila SMTP. Locks seguem organização → cliente; emissão usa também lock global do índice do e-mail. Consumo de tokens/fatores e revogação ocorrem dentro da mesma transação. Argon2 é calculado fora da transação e credenciais são revalidadas sob lock.

Dados básicos: nome de exibição editável pelo titular; e-mail verificado somente leitura. Alteração de endereço exigiria um fluxo próprio de verificação e não será improvisada. Sem telefone, endereço ou dados de negócio. MFA perdido sem autenticador e sem códigos não tem bypass nem reset administrativo.

Auditoria de clientes usa resourceType próprio e não fica disponível na consulta global, mesmo com filtro de organização; consulta organizacional conserva escopo. Eventos não contêm e-mail, nome, token ou códigos.

## Contrato e interface

Prefixo público `/v1/customer`, cookie exclusivo `customer_session` (HTTP local) ou `__Secure-customer_session` (HTTPS), HttpOnly, Secure conforme origem pública, SameSite=Lax, host-only, Path=/v1/customer. O path permite chamadas da UI à API sem transmitir o cookie para rotas internas; a página de conta carrega seus dados pela API, sem depender do cookie no SSR. Tokens de sessão têm 256 bits; apenas digest SHA-256 e UUID público independente ficam no banco. Sessões plenas duram SESSION_HOURS (8h por padrão); etapa MFA dura 10 minutos. Não há renovação deslizante. MFA concluído, ativado, substituído ou removido gira o cookie; troca por recuperação revoga todas as sessões. Suspensão também revoga sessões e tokens de reset. A sessão interna não consulta CustomerSession e vice-versa.

| Método | Rota | Entrada / resultado |
|---|---|---|
| POST | `/customer/accept` | token, name, password, confirmPassword; ativa sem criar sessão |
| POST | `/customer/login` | email, password; stage full ou mfa, token somente no cookie |
| POST | `/customer/password/request` | email; resposta genérica, inclusive fila indisponível |
| POST | `/customer/password/reset` | token, password, confirmPassword; revoga sessões, preserva fator confirmado e códigos restantes |
| GET | `/customer/session` | etapa atual, inclusive MFA pendente |
| GET/POST | `/customer/account` | perfil próprio / atualização somente de name |
| POST | `/customer/logout` | objeto vazio; revoga sessão e limpa cookie |
| GET | `/customer/sessions` | UUID público, etapa, criação, expiração e indicação da atual |
| POST | `/customer/sessions/revoke` | id ou others:true; nunca revoga sessão de outro cliente |
| POST | `/customer/mfa/verify` | code TOTP ou recuperação, somente sessão mfa |
| POST | `/customer/mfa/setup` | password e, se já habilitado, code do fator atual |
| POST | `/customer/mfa/enroll` | code do novo autenticador; retorna recoveryCodes uma única vez |
| POST | `/customer/mfa/disable` | password e code atual; revoga sessões e códigos |
| GET | `/organization-customers` | search (e-mail completo), page, pageSize; exige customers.read |
| GET | `/organization-customers/:id` | detalhe mínimo e estado do último convite; customers.read |
| POST | `/organization-customers/invite` | email; customers.invite |
| POST | `/organization-customers/:id/resend` | objeto vazio; customers.invite |
| POST | `/organization-customers/:id/cancel` | objeto vazio; customers.invite |
| POST | `/organization-customers/:id/status` | status active ou suspended; customers.manage |

Não existe variante `/admin` dos endpoints de clientes. Queries de leitura e corpos são estritos; IDs de ator, organização ou outro cliente não selecionam a conta pessoal. O ID administrativo apenas seleciona um recurso dentro do escopo derivado. Master/PlatformAdmin são recusados antes de buscar clientes. GET não consome convite ou reset. POST exige JSON e Origin exata; os controles existentes de CORS, corpo de 8 KiB, no-store e headers continuam ativos. OpenAPI documenta entradas e cookie sem exemplos de segredos reais.

UI: `/customer/accept`, `/customer/login`, `/customer/forgot`, `/customer/reset`, `/customer/account`. Links de e-mail usam fragmento `#token=id.secret`; a página remove o fragmento imediatamente e mantém o segredo apenas em memória. Recarregar exige reabrir o link. Páginas de entrada usam no-referrer e noindex. A conta contém nome, endereço verificado, MFA e sessões; não tem painel de negócio. Organização tem aba Clientes com busca exata, paginação, convite, detalhe e estados. Não existe UI de clientes na área Master.

## Credenciais, convites e MFA

Senhas usam PasswordWork e a política existente: 15–1024 caracteres, Argon2id 64 MiB/3 iterações/paralelismo 1 e limite de concorrência por processo. Login desconhecido verifica hash fictício. Reserva durável por conta (ou índice HMAC do IP desconhecido) precede Argon2; o orçamento e cooldown seguem Rates. O limite HTTP de login inclui também aceite, reset e operações MFA, independentemente de caixa da rota ou barra final. Nenhum mecanismo faz fallback para identidade interna, mesmo com e-mail coincidente.

Convites duram sete dias; reset dura quinze minutos; ambos usam 32 bytes aleatórios, digest SHA-256 com domínio customer-access.v1 e contexto de ID, cliente e finalidade. Cinco tentativas incorretas revogam a capacidade sob lock; consumo é único. Reemissão invalida imediatamente tokens anteriores. O e-mail pendente permanece reservado após expiração/cancelamento: não é transferido para outra organização. A organização original pode reemitir; transferência/descarte exige decisão futura explícita. Não há exclusão permanente ou exclusão lógica adicional de cliente.

Envio de convite: máximo 5/h e 20/dia por cliente, intervalo de 60s, máximo 100/h por organização. Reset: 5/h por conta com intervalo de 60s; casos inelegíveis, limitados ou indisponíveis mantêm a mesma resposta pública. IP continua sujeito aos limites HTTP persistentes. Esses limites mitigam abuso, sem prometer disponibilidade contra ataque distribuído nem tempo perfeitamente constante nas respostas de recuperação.

TOTP reutiliza o adaptador existente: SHA-1, seis dígitos, período de 30s, tolerância ±1 passo. O último passo aceito impede replay. Configuração pendente expira em dez minutos e só substitui o fator atual após confirmação. Substituição e remoção exigem senha e fator atual. Dez códigos de 128 bits são apresentados uma única vez, com digest por cliente e consumo transacional. A substituição confirmada revoga os códigos anteriores. Recuperar senha limpa apenas configuração ainda pendente, nunca fator confirmado ou seus códigos restantes. Não há reset de MFA por Master, PlatformAdmin ou organização. Sem autenticador/códigos, a conta permanece inacessível: exige decisão futura de recuperação de identidade, sem bypass nesta implementação.

## Atomicidade, e-mail e auditoria

Ordem de locks: organização → índice de e-mail (na emissão nova) → cliente → orçamento de envio. Login reserva orçamento em transação separada antes do Argon2; confirmação relê hash/estado depois de organização → cliente. MFA usa orçamento por cliente sob o mesmo lock. Aceite, reset, códigos, estados, revogação e auditoria confirmam ou revertem juntos. A constraint global de emailIndex e FKs protegem persistência; checks validam estados, credenciais mínimas de conta ativa/suspensa, etapa, finalidade e exclusividade de consumo/revogação. E-mails internos e externos são namespaces independentes.

Job `email.customer-access.v1` reutiliza BullMQ e SMTP existentes. Redis recebe somente ID de capacidade e token cifrado com contexto, nunca destinatário ou token puro. Worker relê cliente, organização, digest, validade e revogação antes de enviar; jobs obsoletos são ignorados. Há três tentativas, backoff e sanitização de erros. Publicação indisponível revoga somente a emissão correspondente. Como no fluxo interno, não há transação distribuída/outbox: timeout/commit/ACK pode deixar entrega incerta ou duplicar e-mail; tokens antigos permanecem inválidos. SMTP roda sob lock, com timeout transacional de 60s, podendo atrasar operações da organização. Habilitar fila e entrega é requisito para entregar convites; não existe fallback que retorne tokens ao administrador.

Eventos customer.* abrangem convite, cancelamento, ativação, suspensão/reativação, login e falha, logout, reset solicitado/concluído, setup/ativação/remoção/falha MFA, recovery consumido, revogação de sessões e entrega/falha de e-mail. Identificadores são cifrados pelo AuditRepository existente; não há e-mail, nome, senha, token, URL ou código nos metadados. ResourceType customer é excluído no SQL da listagem/contagem/detalhe global mesmo com filtro de organização; somente consulta organizacional autenticada pode incluí-lo. Ator é apresentado genericamente para não resolver um cliente como User interno. Auditoria não é imutável contra o operador do banco. Retenção, descarte, rotação de chaves e integridade externa continuam pendentes conforme documentação de segurança. Registros expirados de cliente são recusados imediatamente; esta versão preserva histórico de tokens e não implementa sua purga automática.

## Implantação e reversão

Aplicar `202610180001_customer_access` antes da nova API, gerar Prisma e reconstruir backend/frontend. A migration acrescenta quatro tabelas, três permissões e constraints; não migra contas internas, não altera senhas e não apaga dados. Não há serviço, variável, segredo ou dependência novos. Produção continua bloqueada até cumprir [segredos de produção](../security/production-secrets.md); esta entrega não implementa integração AWS.

Parar versões antigas e workers antes da atualização, pois não reconhecem as novas permissões/eventos. Reversão operacional preserva as tabelas, permissões, histórico e chaves: requer uma versão compatível que desabilite a superfície de clientes e continue decodificando os eventos/grants novos. Não fazer downgrade cego para main anterior nem apagar as tabelas para reverter código. Remover o schema após haver contas destruiria dados e exige migração corretiva separada, backup e autorização; não existe down destrutivo automático. O histórico de migrations permanece intacto. `backend/prisma/rollback/customer-access.sql` fornece um modelo de migration corretiva reversível somente enquanto não houver cliente, evento customer ou grant novo: o guard recusa bases populadas, e todas as instruções devem rodar em uma transação. Ele remove apenas o schema vazio novo e restaura o enum anterior, sem alterar `_prisma_migrations`; deve ser incorporado a uma nova migration revisada, nunca usado para apagar histórico. O teste descartável verifica reversão dentro de transação seguida de rollback e a recusa com dados.

## Verificação

Backend: `DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm test`, lint, build e OpenAPI. `customer-validation.test.ts` cobre validação isolada; `customer-access.test.ts` usa PostgreSQL descartável (porta 15465), aplica/reaplica migrations, fila e sender falsos. Inclui dois escopos organizacionais, Master/PlatformAdmin, grants mínimos, cookies/CSRF, e-mail único concorrente, tokens/fatores de uso único, expiração/tentativas, rollback de auditoria, reset mantendo MFA e revogação de sessões. Nenhum teste usa SMTP ou banco real.

Frontend: lint, build, `npm run test:unit` e `npx playwright test --config playwright.customers.config.ts --output /tmp/customer-browser-results`. API sintética em loopback 19030/19031; não substitui autorização real dos testes backend. Cobre entrada/aceite/recuperação, fragmentos, perfil, MFA, sessões, gestão, erro/retry, axe e overflow em 1440/390/320 px. Neste WSL Chromium precisa das bibliotecas extraídas em `/tmp/customer-browser-libs/usr/lib/x86_64-linux-gnu` via LD_LIBRARY_PATH; o caminho é temporário, não dependência do produto.

A validação não inclui SMTP/Redis reais, teste de carga, implantação ou alterações no banco/containers ativos. Resultados finais executados são registrados na entrega, sem usar relatórios históricos como evidência atual.

### Resultados executados em 18/10/2026

- Backend: suíte completa **128/128**, sem falhas; geração Prisma, lint, build e OpenAPI aprovados. Rodada focada final **11/11**, incluindo reversão protegida e validação isolada.
- Frontend: lint/build aprovados; **5/5** testes unitários; **3/3** Playwright de clientes e **4/4** de regressão organizacional aprovados. Axe e ausência de overflow verificados em 1440/390/320 px; capturas de conta mobile e gestão desktop inspecionadas.
- Infra: as duas configurações Compose, usando somente `.env.example` e `config --quiet`, passaram. Migrations aplicadas/reaplicadas apenas em bancos descartáveis.
- Revisão de alterações e busca limitada por padrões comuns de credenciais sem achados; `.env` não foi lido. Isso não é scanner especializado de histórico nem garantia de produção.
- As quatro falhas históricas foram corrigidas nas fixtures/expectativas de testes: estado TOTP da troca inicial, mock de lastLoginAt, projeção platformAdmin e campos atuais do perfil. Nenhuma política interna foi enfraquecida.
- Falhas intermediárias foram resolvidas: asserção síncrona de validação, atualização OpenAPI, constraint do enum no script de reversão e colisão de porta da fixture. Chromium executou com bibliotecas temporárias; resultados foram direcionados a `/tmp` para preservar o diretório gerado existente sem permissão de escrita.
- Não foram executados SMTP/Redis reais, carga, deploy ou migrations em dados ativos. Para uso operacional, habilitar e validar entrega de e-mail; produção continua dependente da política AWS Secrets Manager/KMS.
