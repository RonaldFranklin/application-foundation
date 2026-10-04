# Application Foundation

Base reutilizável para iniciar aplicações. A implementação atual fornece autenticação e gestão inicial de organizações. Backend, frontend e infraestrutura ficam no mesmo repositório-base, mas continuam como projetos separados, com dependências, configuração, imagem Docker e ciclo de execução próprios.

## Estrutura

- **backend/** — API NestJS e TypeScript, Prisma e PostgreSQL.
- **frontend/** — aplicação Next.js, React e TypeScript.
- **infra/** — Docker, Compose, banco de dados e operação local.
- **docs/** — arquitetura, funcionalidades e registros de validação.

Cada diretório de aplicação possui seu próprio package.json, lockfile e Dockerfile. Não há pacote npm, workspace ou código de aplicação compartilhado na raiz. Consulte o [guia do backend](backend/README.md), o [guia do frontend](frontend/README.md) e o [guia de infraestrutura](infra/README.md) para os comandos e detalhes específicos.

## Começar localmente

Siga primeiro as instruções de preparação de ambiente e execução em [infra/README.md](infra/README.md). O Compose fica em infra/ e executa imagens separadas para frontend, backend e banco. Para executar as aplicações fora do Docker, consulte os READMEs de cada projeto.

A versão Node suportada está declarada no arquivo .nvmrc de cada projeto. Instale dependências separadamente com npm ci dentro de backend/ e frontend/.

## Documentação

- [Índice de documentação](docs/README.md)
- [Organização e responsabilidades do backend](docs/architecture/backend-organization.md)
- [Perfil pós-login](docs/features/profile.md)
- [Verificações da implementação](docs/validation/implementation-validation.md)
- [Auditoria e correções de segurança da autenticação](docs/validation/auth-security-review.md)

## Dados sensíveis

Não versione arquivos .env nem valores reais de segredos. Use os arquivos .env.example como referência e mantenha os arquivos locais ignorados pelo Git. Não inclua credenciais, tokens, chaves ou dados de usuários em documentação, logs ou exemplos.
