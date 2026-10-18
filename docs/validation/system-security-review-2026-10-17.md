# Revisão ampla de segurança e estado do sistema

**Data:** 2026-10-17
**Branch/commit:** main / 6e7c87a
**Conclusão:** nenhum segredo exposto ou caminho explorável foi confirmado no código inspecionado. Existem riscos operacionais e quatro falhas de testes. Isto não é certificação nem avaliação completa de produção.

## Escopo

Revisão estática do backend, frontend, configuração de infraestrutura e documentação: regras de negócio, autorização, login/MFA, sessão, convites, resets, auditoria, criptografia, logs e arquivos rastreados. Não foram feitos ataques de força bruta, teste de carga ou exploração de produção. Nenhum código de aplicação foi alterado.

## Evidências

- Autorização fica nos casos de uso do backend; sessão é a origem da identidade e banco define escopo organizacional.
- Master, PlatformAdmin e usuários organizacionais são contextos separados.
- Promoção a administrador organizacional é exclusiva do Master; testes de integração focados cobrem fronteiras de autorização. Convites, resets e permissões também são validados no servidor.
- Sessões armazenam digest de token opaco; senha usa Argon2id; campos sensíveis mapeados usam AES-GCM e HMAC cego.
- Busca limitada de padrões de segredo nos arquivos rastreados não encontrou credenciais. infra/.env não foi lido. Histórico Git e segredos externos não tiveram scanner especializado.
- Árvore de trabalho estava limpa na consulta inicial.

## Verificações

- Backend: 117 testes, 113 passaram, 4 falharam.
- Frontend unitário: 5 passaram.
- Lint/build: resultados anteriores registrados como sucesso, não reexecutados.
- Playwright: bloqueado por ausência de libnspr4.so no WSL.
- Compose/health: somente resultado anterior, sem nova validação de produção.

Falhas backend:
1. Fixture de troca de senha espera estágio setup, mas estado atual segue para MFA; rever setup/expectativa do caso.
2. Mock isolado de MFA não implementa busca de identidade usada na criação de sessão e atualização de lastLoginAt.
3. DTO esperado pelo teste de repositório não inclui platformAdmin: null.
4. DTO antigo do perfil não inclui emailVerifiedAt: null e platformPermissions: [].

Parecem deriva de mock/assertion frente ao contrato atual, não evidência de vulnerabilidade. Atualizar e executar novamente a suíte é necessário para confirmá-la verde.

## Riscos residuais

### Médio — Rotação e recuperação das chaves

Não foi encontrado fluxo automatizado de rotação AES/HMAC, migração de envelopes e reconstrução de índices cegos. Rotação sem migração pode quebrar leitura/busca. Definir custódia, backup, recuperação e procedimento antes de rotacionar.

### Médio — Integridade/retensão da auditoria

Cifragem protege confidencialidade, não impede operador do banco de editar/apagar linhas. Não foi encontrado armazenamento externo imutável, retenção formal nem alerta de lacunas.

### Médio — Disponibilidade sob carga

Concorrência Argon2 é limitada por processo e o consumo escala por réplica. Não houve teste de carga; rate limit não é proteção completa contra DDoS.

### Baixo/operacional — Backfill na inicialização

Backfill HMAC organizacional ocorre antes de servir tráfego em lotes, fail-closed; histórico grande pode atrasar startup.

### Informativo — MFA resistente a phishing

TOTP digitado manualmente não é resistente a phishing. Se exigido, avaliar WebAuthn/passkeys. Referência: [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html).

### Não avaliado

Config real de TLS/proxy/firewall, cofre de segredos, host/backups, integrações externas, advisories atuais de dependências e histórico Git inteiro. Padrões comuns no working tree não provam inexistência de segredos históricos/externos.

## Próximas ações

1. Corrigir as quatro expectativas/mocks e tornar backend verde.
2. Definir rotação e recuperação de chaves AES/HMAC.
3. Definir retenção e proteção externa da auditoria segundo requisitos.
4. Fazer scanner especializado do histórico Git e validar segredos/configuração de produção com acesso autorizado.
5. Dimensionar Argon2, observabilidade e defesa de borda.
