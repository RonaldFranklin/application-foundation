# Visão geral atual do sistema

Revisado em 2026-10-17. Checkout observado: branch main, commit 6e7c87a.

Application Foundation é uma base reutilizável de autenticação e administração multi-organização.

## Arquitetura

- backend/: API NestJS/TypeScript, casos de uso, domínio, adaptadores Prisma/PostgreSQL.
- frontend/: Next.js/React/TypeScript; a interface apenas espelha permissões. O backend é a autoridade.
- infra/: Docker Compose, imagens, PostgreSQL e Redis. Projetos independentes, cada um com dependências, lockfile, imagem e ciclo próprios.
- Redis e fila de e-mail são opcionais conforme configuração. PostgreSQL mantém também sessões e limites de taxa.
- Casos de uso aplicam políticas; controllers tratam HTTP; adaptadores persistem. Ver backend-organization.md.

## Identidades e regras atuais

1. **Master:** conta global única User.master, inicializada por configuração/segredos de ambiente; autoridade global.
2. **Administrador da plataforma:** identidade PlatformAdmin separada, com permissões globais explícitas. Não é Master. Master gerencia contas, convites e cargos.
3. **Usuário organizacional:** membro associado a no máximo uma organização ativa. O vínculo guarda o papel local e o backend resolve seu escopo.

Regras essenciais:
- Identidade vem da sessão validada; organização e permissões vêm do estado persistido. Não confiar em valores do frontend.
- Admin da organização só administra sua organização e os membros que sua permissão autoriza.
- Só Master promove/rebaixa/remove/restaura administrador organizacional. Admin local gerencia permissões delegáveis de membros conforme o catálogo do backend.
- Papéis da plataforma e cargos organizacionais são diferentes.
- Exclusão de organização/vínculo é lógica e restaurável conforme regras documentadas.
- Convites exigem aceite do destinatário; provisionamento direto não é o fluxo normal.
- Reset administrativo de senha revoga sessões/dispositivos e força troca no próximo acesso. Reset de MFA é ação privilegiada reservada ao Master conforme a regra atual.
- Não há recuperação de senha self-service por e-mail. Verificação de e-mail é separada e opcional.

Detalhes: [admins da plataforma](../features/platform-administrators.md), [permissões organizacionais](../features/organization-permissions.md), [administração organizacional](../features/organization-administration.md), [exclusão lógica](../features/organization-deletion.md), [convites](../features/organization-invitations.md), [segurança de membros](../features/member-security.md).

## Funcionalidades presentes

Login e MFA TOTP em contextos administrativos; sessões opacas, listagem/revogação das próprias sessões; perfil e credenciais; organizações e membros; convites; cargos/permissões organizacionais e de plataforma; auditoria global e organizacional; verificação opcional de e-mail; entrega de e-mail via fila opcional.

Índice: [docs/README.md](../README.md).

## Dados e controles

- Senhas com Argon2id (código observado: 64 MiB, 3 iterações, paralelismo 1); não são reversivelmente criptografadas.
- Username, e-mail e segredo TOTP com AES-256-GCM autenticado, nonce/tag e propósito/versionamento; índices cegos HMAC-SHA-256 para busca.
- Chaves de cifragem/HMAC são configuração operacional separada dos dados.
- Sessões usam bearer aleatório de 256 bits; banco guarda SHA-256 digest. Cookies HttpOnly, SameSite=Lax, host-only e Secure em HTTPS (prefixo __Host- quando aplicável).
- Sessão completa: 8h; etapas restritas: 10 minutos.
- Convites usam token aleatório, digest e envelope protegido em fila; verificação de e-mail usa digest HMAC, limite de tentativas e expiração.
- Detalhes de auditoria são cifrados; índice HMAC permite escopo organizacional. Tipo, ação, resultado e horário permanecem pesquisáveis em claro.
- Status, timestamps, relações e parte dos metadados ficam em claro por operabilidade/minimização; não se afirma que toda coluna seja cifrada.
- HTTP: CORS por origem explícita, validação de origem em métodos mutáveis, Helmet, CSP nonce no frontend, sem cache em resposta autenticada, limite de corpo; proxy confiável só quando configurado.
- Docker roda serviços como não-root. .env local é ignorado e excluído do build; .env.example deve conter placeholders.

Detalhes: [autenticação e sessões](../security/authentication.md), [auditoria](../security/audit.md).

## Riscos residuais / limites da revisão

Nenhuma credencial exposta ou vulnerabilidade explorável foi confirmada no código inspecionado. Isso não é certificação de segurança nem validação de produção.

1. **Rotação/recuperação de chaves:** não foi encontrado fluxo automatizado de rotação AES/HMAC e reconstrução de índices cegos. Trocar chave sem migração pode tornar dados ilegíveis ou buscas inconsistentes.
2. **Auditoria:** cifragem protege confidencialidade, mas quem controla diretamente o banco pode alterar/apagar eventos. Não foi encontrado sink imutável externo nem política formal de retenção/alertas.
3. **Disponibilidade:** o limite de concorrência de Argon2 é por processo; custo total cresce com réplicas. Não houve teste de carga; rate limit não substitui proteção de borda contra DDoS.
4. **Backfill:** índices organizacionais de auditoria são reconstruídos em lotes antes de aceitar tráfego; bases grandes podem atrasar startup.
5. **MFA:** TOTP digitado não é resistente a phishing. Se isso virar requisito, avaliar WebAuthn/passkeys. A [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) distingue OTP manual de autenticadores resistentes a phishing.
6. **Fora do escopo:** TLS/proxy/firewall e cofre de segredos de produção, host/backups, advisories atuais de dependências, integrações externas e histórico Git inteiro não foram verificados.
7. **Segredos:** busca limitada por padrões comuns nos arquivos rastreados não achou credenciais. infra/.env não foi aberto. Não houve scanner especializado no histórico nem nos ambientes externos; ausência não está provada.

Princípios de operação: OWASP [gestão de segredos](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) e [gestão de sessão](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Validação registrada

- Backend: 117 testes; 113 passaram, 4 falharam.
- Frontend unitário: 5 passaram.
- Lint/build passaram em validação anterior, não reexecutados agora.
- Playwright não executou por ausência de libnspr4.so no WSL.
- Compose/health checks foram vistos saudáveis em verificação anterior; não é validação de produção nesta tarefa.

As quatro falhas são antigas expectativas/mocks incompatíveis com mudanças atuais: estágio de senha/MFA no fixture, consulta de identidade para sessão/lastLoginAt, campo platformAdmin ausente no DTO esperado e campos emailVerifiedAt/platformPermissions ausentes na expectativa do perfil. São compatíveis com deriva dos testes, não evidência de bypass, mas devem ser corrigidas antes de considerar a suíte verde. Veja [relatório da revisão](../validation/system-security-review-2026-10-17.md).
