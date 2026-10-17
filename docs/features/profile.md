# Configurações da conta e sessões

## Interface atual — 16/10/2026

`/settings` e `/admin/settings` usam o mesmo layout: título **Configurações da conta**, navegação **Perfil / Sessões**, cartão com rótulos/descrições à esquerda e valores/controles à direita. Em mobile, a navegação fica horizontal e as linhas se empilham. Apenas dados reais são apresentados: usuário, e-mail e verificação, tipo de conta e MFA. Edição inline, confirmação de identidade, alteração de senha e configuração voluntária de MFA reutilizam os fluxos existentes. Não foram alteradas políticas de senha, MFA, e-mail ou login.

Sessões usa `?tab=sessions`, com links acessíveis e `aria-current`; recarregar e voltar preservam o destino. Só a aba selecionada é montada. Alterações de perfil não enviadas são descartadas ao sair da aba. A lista tem carregamento, vazio, erro/retry, atualização manual, confirmação nativa com foco inicial em Cancelar, Escape e retorno ao acionador. Revogação concluída atualiza os dados e leva o foco ao título; revogação da atual descarta o estado do cliente e encaminha ao login comum/administrativo. O logout e a opção de esquecer este dispositivo permanecem no menu da conta.

## API de sessões pessoais

Todas as operações exigem sessão plena e passam por `Sessions.authorized`, incluindo senha obrigatória, validade, status administrativo e política de MFA. Identidade vem exclusivamente do cookie autenticado. Administrador organizacional, delegado e Master consultam somente a própria conta nessas rotas; não há concessão para consultar acessos de membros, nem parâmetro de usuário/organização.

| Operação | Entrada | Resposta |
| --- | --- | --- |
| `GET /v1/auth/sessions` | Sem query | `{items:[{id,current,createdAt,expiresAt,status}]}` |
| `POST /v1/auth/sessions/:id/revoke` | `{}`; UUID público da sessão | `{ok:true,endedCurrent}` |
| `POST /v1/auth/sessions/others/revoke` | `{}` | `{ok:true,endedCurrent:false}` |

`status` é `authenticated` ou `pending`, indicando acesso pleno ou autenticação ainda em andamento. A lista exclui expiradas e ordena por criação decrescente/UUID; a interface separa atual e demais. Datas são instantes ISO UTC, formatadas no fuso do navegador. Identificador público não autentica nem permite consultar outra conta. Não são retornados IDs de conta, cookies, tokens, hashes, segredos ou fatores. Respostas usam `no-store`.

Query extra, corpo com campos extras ou ID malformado recebe 400. Sessão sem autorização recebe 401. UUID inexistente, expirado, já revogado ou pertencente a outra conta recebe o mesmo 404, sem informação sobre o proprietário. Escritas mantêm Origin/CSRF e limites existentes. A revogação atual também expira o cookie de sessão no transporte HTTP.

## Atomicidade e dispositivos reconhecidos

`ManageSessions` obtém `account:<id>` e relê autorização dentro da transação. Esse lock é compartilhado com emissão/rotação de sessão, troca/reset de senha, MFA e revogação administrativa. Revogação e evento `account.sessions_revoked` são atômicos: falha de auditoria desfaz a exclusão. Encerrar outras elimina todas as sessões da conta exceto o digest da sessão autenticada, sem renovar sua validade ou trocar o cookie. A ação também pode limpar registros expirados; a contagem auditada corresponde aos registros removidos. Repetir a ação é seguro. A lista só representa o instante consultado; novos logins posteriores podem criar novos acessos.

Dispositivos reconhecidos não são sessões nem dispensam senha/MFA. Como no logout normal existente, encerrar sessões preserva esse reconhecimento. **Sair e esquecer este dispositivo** continua removendo o reconhecimento deste navegador. Não há associação persistida entre `Session` e `MasterDevice`; nenhuma associação é inferida por data. Resets administrativos de credenciais e outras revogações administrativas existentes continuam revogando sessões/dispositivos conforme sua política, incluindo os fluxos exclusivos do Master. Esta entrega não amplia permissões administrativas nem acrescenta consulta de sessões alheias.

Auditoria registra ator e conta no envelope cifrado, sem organização inferida. Metadados fechados incluem apenas escopo `current|other|others` e quantidade removida; nenhum UUID de sessão, token/digest, IP ou user-agent. A consulta de auditoria apresenta escopo e quantidade com rótulos em português.

## Modelo e implantação

O modelo já possui `createdAt`, `expiresAt` e estágio; não possui navegador, dispositivo ou último acesso por sessão. Não foram acrescentados IP, geolocalização, user-agent nem atualizações por requisição. `User.lastLoginAt` descreve o login da conta e não é usado como atividade da sessão.

Migration aditiva **202610160005_session_public_id** acrescenta `Session.publicId`, UUID aleatório gerado no banco, NOT NULL e único, inclusive para registros existentes. Justificativa: permitir seleção e revogação sem expor o digest que hoje identifica internamente a sessão. Tokens, estágio, criação e validade permanecem intactos. Aplicar a migration antes de iniciar a API atualizada e gerar Prisma. Não há novos segredos ou variáveis de ambiente.

## Validação direcionada

Backend: `npm run db:generate`, `npm run lint`, `npm run build`, `npm run openapi`; `npx tsx --test --test-concurrency=1 test/manage-sessions.test.ts test/profile.test.ts test/administrative-credentials.test.ts test/architecture.test.ts`. A fixture usa PostgreSQL descartável, aplica/reaplica migrations e cobre escopo inclusive administrador organizacional/Master, contrato sem segredos, sessão restrita, expiração, rollback, revogação concorrente, preservação da atual e dispositivos, e auditoria. Testes de perfil e reset preservam senha obrigatória/MFA e revogações globais.

Frontend: lint/build e `npx playwright test --config playwright.verification.config.ts`. API sintética, sem SMTP/banco ativo. Cobre edição/verificação/MFA existentes e sessões para comum/Master, confirmação, cancelamento, foco, erros/retry, vazio, revogação individual/em lote, saída atual e axe/overflow em 1440/390/320 px. Resultados desta entrega são registrados abaixo; o relatório histórico seguinte não os substitui.

Resultados de 16/10/2026: geração Prisma/OpenAPI e lint/build backend aprovados; os quatro testes de integração/arquitetura direcionados passaram. Após incluir a apresentação dos metadados de auditoria, a regressão de sessões e arquitetura passou novamente (2/2). No frontend, lint/build e os nove testes Playwright de perfil, verificação e sessões passaram, incluindo axe e responsividade. Capturas de perfil e sessões foram inspecionadas em desktop/mobile. Não foram executadas a suíte completa, migrations no banco ativo, SMTP real ou deploy.

---

# Registro histórico — perfil pós-login em 03/10/2026

## Entrega

As rotas `/` (comum) e `/admin` (master) apresentam o perfil somente para consulta. A composição segue a referência: fundo quase preto, navegação lateral com apenas Profile, painel Profile Details, linhas com separadores e tipografia compacta. Em telas pequenas, navegação e dados ficam em uma coluna. Não há campos editáveis, dados inventados ou links para funcionalidades inexistentes. O logout existente permanece, incluindo esquecer dispositivo para master.

O backend estende `GET /v1/welcome` e `GET /v1/admin/welcome` com `username`, `email`, `accountType` (`common`/`master`) e `mfa.configured`/`mfa.verified` (booleanos). O campo `message` anterior permanece por compatibilidade. A sessão no cookie é a única fonte de identidade; parâmetros de identificação do cliente não selecionam perfil. A consulta reflete o registro atual. Username e e-mail só são descriptografados após os controles existentes de sessão plena, validade, categoria, troca da senha inicial e MFA master. Nenhum segredo ou identificador interno integra o contrato.

A consulta Next continua no servidor, encaminhando cookie com `cache: "no-store"`, e preserva os redirecionamentos. O tipo da conta e os dois estados do MFA são renderizados a partir da resposta, sem inferência pela URL. Login, MFA, limites, cookies, persistência e logout não foram redesenhados.

## Arquivos alterados

- Backend: `src/application/auth/results.ts`, `src/application/auth/use-cases/sessions.ts`, `src/export-openapi.ts`, `openapi.json`, `README.md`.
- Frontend: `src/features/auth/components/Welcome.tsx`, novo `Profile.module.css` no mesmo diretório, `src/features/auth/services/welcome.server.ts`, novo `src/features/auth/types/profile.ts`, `README.md`.
- Testes backend: `test/application.test.ts`, `test/security.test.ts`, `test/helpers.ts`, `test/browser-server.ts`.
- Testes frontend: `tests/integration.spec.ts`, `tests/login.spec.ts`, `playwright.config.ts`.
- Infraestrutura de testes: `infra/scripts/test-browser.py`, `infra/README.md`. Portas alternativas são opcionais; os padrões permanecem 3000/3001/15440.
- Este registro foi preservado em docs/features/profile.md.

## Verificações

Executadas da raiz do workspace:

```bash
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm --prefix backend run openapi
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm --prefix backend run lint
DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 npm --prefix backend test
npm --prefix frontend run lint
NEXT_TELEMETRY_DISABLED=1 npm --prefix frontend run build
LOGIN_TEST_FRONTEND_PORT=16430 LOGIN_TEST_API_PORT=16431 LOGIN_TEST_DB_PORT=16440 \
  DOTENV_CONFIG_PATH=/dev/null CHECKPOINT_DISABLE=1 NEXT_TELEMETRY_DISABLED=1 \
  LD_LIBRARY_PATH=/tmp/login-security-browser-libs/usr/lib/x86_64-linux-gnu \
  python3 infra/scripts/test-browser.py
```

- OpenAPI gerado; lint backend/frontend e builds backend/frontend aprovados. O build backend faz parte de `pretest`.
- Backend: 49 testes aprovados. Cobertura adicional verifica contrato mínimo, registro atual, identidade exclusivamente da sessão, rotas cruzadas, ausência/expiração/restrição de sessão e nenhuma descriptografia antes da autorização.
- Frontend: 2 testes Node e 10 testes Chromium aprovados. Integração usa API e PostgreSQL descartáveis e mantém os fluxos completos de autenticação/logout. Para ambos os perfis, valida dados, ausência de edição, navegação única, acessibilidade axe e ausência de overflow nas larguras 1440, 390 e 320 pixels. Inspeção visual adicional dos screenshots desktop comum e mobile master.
- A primeira tentativa nas portas padrão falhou com `RuntimeError: Port 3000 must be free before isolated browser tests` (`OSError: [Errno 98] Address already in use`). A execução acima passou sem interromper o serviço existente. As bibliotecas Chromium já disponíveis no diretório temporário foram usadas; esse caminho é específico deste ambiente.

## Limites e execução

Não foi criada conta comum real. A cobertura automatizada usa exclusivamente fixtures sintéticas descartáveis já previstas pelo projeto. A validação manual com uma conta comum real depende de uma forma acordada de provisionamento.

Não foram executados deploy, push, commit, testes de carga ou sondagens de produção. Não foram executados builds Docker nesta entrega; os builds nativos foram validados. Nenhuma alteração de schema/migration, dependências, segredos, banco real ou containers foi necessária.

Para executar no ambiente já configurado, use `npm --prefix backend run dev` e, em outro terminal, `npm --prefix frontend run dev`; o banco deve estar disponível conforme a configuração existente. Para execução Docker, consulte `infra/README.md`. Acesse `/login` ou `/admin/login`; após autenticação completa, o perfil aparece em `/` ou `/admin`.
