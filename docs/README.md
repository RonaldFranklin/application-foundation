# Documentação

Este diretório guarda documentação duradoura e relatórios de entregas anteriores. Prompts avulsos não são mantidos no repositório.

## Segurança

- [Auditoria persistente](security/audit.md) — catálogo, cifragem, atomicidade, consulta global autorizada e escopo organizacional e decisões pendentes de privacidade.

- [Autenticação e sessões](security/authentication.md) — fluxos, controles de armazenamento, limites de abuso e limites conhecidos da implementação.

## Arquitetura

- [Organização em camadas do backend](architecture/backend-organization.md) — árvore, dependências, responsabilidades e verificações da refatoração.

- [Infraestrutura da fila de e-mail](architecture/email-queue.md) — configuração opcional, isolamento, Redis e limites da etapa.

## Funcionalidades

- [Listagem de membros e redefinição administrativa de credenciais](features/member-security.md): projeção autorizada, último login, escopo Master/organização, senha temporária, MFA opcional após reset e revogação atômica.

- [Administradores delegados da plataforma](features/platform-administrators.md): identidade separada, concessões explícitas, convites, MFA, auditoria e implantação.

- [Convites para organizações](features/organization-invitations.md) — aceite do destinatário, tokens, fila dedicada, limites e migração do provisionamento direto.

- [Área do administrador organizacional](features/organization-administration.md) — destino após login, organização única/múltiplas, proteção de acesso e separação do Master.

- [Exclusão lógica de organizações e vínculos](features/organization-deletion.md) — autorização, restauração, filtros, migration e validação focada.

- [Verificação opcional de e-mail](features/email-verification.md) — desafio, segurança, fila dedicada e validação focada.

- [Perfil pós-login](features/profile.md) — escopo, interface e decisões da entrega.

- [Usuários, cargos e permissões organizacionais](features/organization-permissions.md) — catálogo, isolamento, migration e consistência concorrente.

## Validação e segurança

- [Auditoria de isolamento organizacional](validation/organization-isolation-review.md) — rotas rastreadas, correção do namespace Master e verificações focadas.

- [Verificações da implementação](validation/implementation-validation.md) — resultados históricos da primeira implementação e limitações registradas.
- [Auditoria e correções de segurança](validation/auth-security-review.md) — decisões, evidências de teste e limitações documentadas.

Os comandos e resultados acima são registros históricos datados. Para executar a aplicação agora, siga os READMEs atuais da raiz e de cada projeto.
