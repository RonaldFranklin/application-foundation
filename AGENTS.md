# AGENTS.md — Application Foundation

## Propósito e estrutura

Este repositório é uma base reutilizável chamada Application Foundation. Atualmente inclui autenticação e gestão inicial de organizações em três projetos separados:

- backend/: API NestJS/TypeScript, domínio, casos de uso, HTTP e adaptadores de infraestrutura.
- frontend/: Next.js/React/TypeScript, rotas, componentes e funcionalidades de interface.
- infra/: Dockerfiles, Compose, PostgreSQL e scripts operacionais.
- docs/: decisões, arquitetura, descrição de funcionalidades e relatórios de validação.

Os diretórios são agrupados no mesmo repositório-base, mas mantêm dependências, lockfiles, imagens e responsabilidades independentes. Não crie pacote npm, workspace, dependência de código compartilhado ou imagem combinada na raiz sem decisão explícita.

## Regras de arquitetura

### Backend

- Casos de uso na camada application/ são a autoridade para regras de negócio, autorização e decisões de fluxo.
- Validações semânticas pertencem à aplicação e devem ser executadas pelo caso de uso. DTOs e controllers podem fazer apenas a tradução e validação estrutural necessária ao protocolo HTTP.
- Controllers tratam transporte: recebem dados HTTP, chamam o caso de uso e apresentam a resposta. Não acessam banco, repositórios concretos ou regras de negócio.
- Portas e contratos de repositório ficam na aplicação. Implementações em infra/database/ persistem e mapeiam dados; não decidem políticas de negócio.
- domain/ contém modelos puros. Integrações, segurança técnica, Prisma, Nest e PostgreSQL ficam nas respectivas fronteiras de infraestrutura e composição.
- Preserve atomicidade, índices, constraints, locking e comportamento concorrente exigidos pelo caso de uso; mantenha a política na aplicação e o mecanismo de persistência na implementação.

### Frontend

- Páginas Next cuidam da composição de rotas e dos pontos de integração com o framework.
- Organize funcionalidades em frontend/src/features/; mantenha componentes, hooks, serviços e tipos coesos.
- A API é a autoridade para identidade, autorização e estado persistido. Proteções visuais no frontend não substituem controles do backend.

### Infraestrutura

- Compose e imagens permanecem em infra/; mantenha frontend, backend e banco em serviços e imagens próprios.
- Preserve volumes de dados. Não use reset, down -v ou remoção de dados reais sem solicitação explícita.
- Migrações devem ser aditivas e documentadas; nunca substitua migrations por sincronização destrutiva de schema.

## Segurança e arquivos locais

- Nunca imprima, copie ou versione valores de infra/.env ou outros segredos locais. Use .env.example com placeholders.
- Não retire regras de ignore para arquivos .env, dependências, builds ou relatórios gerados.
- Senhas usam hashing próprio para senhas; tokens de sessão e dados sensíveis seguem os mecanismos documentados nos READMEs.
- Não registre prompts avulsos de implementação no repositório. Registre decisões duradouras como documentação concisa em docs/.

## Documentação e validação

- Leia este arquivo e os READMEs do projeto afetado antes de alterar código ou configuração.
- Mantenha o README da raiz como visão geral e os READMEs de backend/, frontend/ e infra/ como guias operacionais de cada projeto.
- Registre documentação duradoura em docs/ e atualize o índice docs/README.md quando criar ou mover documentos.
- Siga os comandos de verificação documentados no README de cada projeto. Execute testes quando forem solicitados ou necessários para a tarefa autorizada.
- Ao concluir, resuma mudanças, verificações realmente executadas e pendências conhecidas. Não apresente resultados históricos dos relatórios como validação executada nesta tarefa.
