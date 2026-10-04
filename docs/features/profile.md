# Perfil pós-login — 2026-10-03

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
