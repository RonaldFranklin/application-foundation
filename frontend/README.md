# Application Foundation frontend

Projeto Next.js/React/TypeScript independente; não importa código ou dependências do backend. Contrato de integração publicado em `backend/openapi.json`, versão 1.0.0; a API decide estados e permissões.

```bash
cd /home/ronald/projetos/application-foundation/frontend
npm ci
cp .env.example .env.local
npm run dev
```

API deve estar em execução e permitir a origem exata do frontend. Acesse `http://localhost:3000/login` ou `/admin/login`. `npm run build` compila a aplicação; `npm start` executa o build local. A imagem usa o output standalone. `npm run lint` e `npm test` verificam código, interface responsiva, teclado, acessibilidade axe, OAuth desabilitado e fluxos de estado. Para instalar navegador: `npx playwright install chromium` e as dependências do sistema quando ausentes. Testes integrados reais: `python3 ../infra/scripts/test-browser.py`, a partir deste diretório ou outro.

## Ambiente

- `PUBLIC_API_ORIGIN`: única origem pública configurável da API, sem barra final; igual à variável do backend. `next.config.ts` incorpora esse valor como `NEXT_PUBLIC_API_ORIGIN` para o browser. Alterar exige reconstruir a imagem.
- `API_INTERNAL_ORIGIN`: origem acessível pelo servidor Next para verificar boas-vindas, por exemplo `http://backend:3001` no Compose. Somente runtime.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: site key pública; nunca a secret key. Vazia localmente impede continuar se o backend exigir desafio.
- `COOKIE_SECURE` foi removida; se ainda for fornecida, a inicialização falha com mensagem de migração. O nome da sessão vem do protocolo de `PUBLIC_API_ORIGIN`: HTTPS usa `__Host-login_session`, HTTP usa `login_session`. `HttpOnly`, `SameSite=Lax`, `Path=/`, ausência de Domain e Secure em HTTPS são impostos pela API.
- `NEXT_TELEMETRY_DISABLED=1`: desabilita telemetria Next.

Frontend e API usam o mesmo hostname, com portas distintas no desenvolvimento; cookie permanece host-only e o servidor Next pode verificar a sessão. Em produção, use HTTPS e reverse proxy no mesmo hostname, encaminhando `/v1` para a API. Defina ambas as origens públicas para a origem HTTPS e `API_INTERNAL_ORIGIN` para a rede interna. A instrumentação compara origem incorporada no build e origem de runtime: divergência encerra o processo Node com código 1, sem imprimir valores de configuração. Não amplie Domain do cookie para contornar hosts diferentes.

As páginas autenticadas (`/`, `/admin`, `/settings`, `/admin/settings`, `/admin/organizations`) são dinâmicas e verificam a sessão na API antes de renderizar. Acesso comum não abre master e vice-versa. Nenhum token vai para localStorage/sessionStorage. Senha permite colar, mostrar/ocultar e autocompletar com gerenciadores. Setup TOTP usa chave manual selecionável, compatível com autenticadores padrão. Recovery codes só ficam em memória durante a primeira exibição. Não há QR remoto ou serviço de geração de imagens que receba o segredo.

A UI de login segue a descrição fornecida: fundo escuro com grade discreta, formulário à esquerda, escultura abstrata em CSS à direita, marca Application Foundation. Painel decorativo é ocultado em telas menores. Google e Apple são desabilitados e não possuem handlers. Não existem links de cadastro ou recuperação de senha.

Headers incluem CSP restritiva por origem, `frame-ancestors 'none'`, `nosniff`, política de referência e permissões. O proxy existente usa nonce por requisição e scripts com nonce; essa proteção foi preservada na correção. O frontend não deve renderizar HTML arbitrário. Não há analytics, fontes remotas ou envio de credenciais a terceiros.

Auditoria de dependências de runtime está limpa nesta execução. A configuração ESLint do Next traz um alerta transitivo em `braces` sem correção publicada compatível; é uma ferramenta de desenvolvimento, ausente da imagem standalone. Não foi aplicado downgrade incompatível do Next para suprimir o alerta.


Após MFA completo, o navegador master recebe um cookie de admissão por até 30 dias. Ele mantém um limite próprio contra bloqueios causados por terceiros; não é uma sessão e não dispensa senha, CAPTCHA nem MFA. Logout normal preserva esse reconhecimento. Em computador compartilhado, use **Sair e esquecer este dispositivo**, que também revoga o registro no backend. Dispositivos novos ainda podem sofrer indisponibilidade do fluxo anônimo durante ataque; consulte a política detalhada no README da API.

`npm run test:unit` cobre HTTP/HTTPS, nomes de cookies e configurações incompatíveis, sem browser ou backend. `npm test` executa esses testes antes do Playwright. Nenhum valor real de `.env` foi lido ou alterado na correção de segurança.

## Organização interna

`src/app/(auth)` contém as páginas `/login` e `/admin/login`; `src/app/(app)` contém as homepages, configurações da conta e a gestão de organizações. Os grupos não mudam URLs nem o layout raiz. Páginas continuam responsáveis pelos arquivos especiais Next, pelo nonce de request e pela composição dos componentes.

A funcionalidade está em `src/features/auth`: `components` para apresentação, `hooks/useAuthFlow.ts` para estados e ações, `hooks/useTurnstile.ts` para o widget, `services/auth-api.ts` para chamadas no navegador e `types/auth.ts` para seus tipos. A consulta SSR fica em `services/welcome.server.ts`, marcada `server-only`; verifica o cookie e a autorização na API antes de apresentar o perfil. O layout genérico Shell está em `src/components/layout`.

`src/proxy.ts`, `src/instrumentation.ts` e `src/lib/public-config.ts` permanecem nos caminhos anteriores, preservando CSP, nonce e configuração de cookies. O alias `@/*`, scripts e build standalone não mudaram. Veja [../docs/architecture/backend-organization.md](../docs/architecture/backend-organization.md) para a estrutura e resultados da refatoração.

## Perfil pós-login

`/settings` (comum) e `/admin/settings` (master) apresentam configurações de conta com edição de usuário/e-mail e alteração de senha. A composição usa fundo quase preto, navegação lateral com apenas **Profile**, painel **Profile Details**, linhas com separadores e tipografia compacta. Os títulos da referência permanecem em inglês com `lang="en"`; descrições e estados são apresentados em português. Em telas menores, navegação e dados passam para uma coluna, com quebra de textos longos e sem rolagem horizontal.

A lista semântica `dl/dt/dd` mostra username, e-mail, tipo **Comum/Master** e os indicadores de MFA **Configurado/Verificado**. Não há nome completo inferido, selo de e-mail verificado, avatar, preferências ou navegação para áreas inexistentes. O logout existente permanece, incluindo esquecer dispositivo para master.

`features/auth/services/welcome.server.ts` continua consultando a API no servidor, com o cookie e `cache: "no-store"`; `types/profile.ts` descreve a resposta consumida. `Welcome.tsx` apresenta o perfil e `Profile.module.css` mantém seus estilos isolados do login. Dados e categoria vêm do backend, sem fixtures na aplicação. Redirecionamentos e proteção server-side permanecem iguais.

Não existe conta comum real de demonstração criada por esta entrega. Os testes reais de navegador usam contas descartáveis no banco temporário. O cadastro comum pelo Master foi acrescentado posteriormente na gestão de usuários da organização. Resultados: [../docs/features/profile.md](../docs/features/profile.md).

### Editar informações e senha

`ProfileEditor.tsx` oferece formulários separados no painel existente, com salvar/cancelar, bloqueio de envios duplicados, mensagens gerais acessíveis e erros junto aos campos. Cancelar desmonta o formulário e descarta alterações/segredos; abrir novamente usa os valores do perfil consultado no servidor. Salvar os identificadores atualiza a consulta SSR.

As duas operações exigem senha atual; master também exige um TOTP novo, sem aceitar recovery code. O formulário informa que o novo e-mail passa a valer imediatamente **sem verificação de posse nesta versão**. Senha nova exige confirmação na interface e API, seguindo a política de 15–1024 caracteres. Segredos permanecem apenas nos inputs durante a operação; são removidos em falha da API, cancelamento ou sucesso, sem storage de navegador.

Após `POST /auth/password`, a API revoga todas as sessões e dispositivos master e expira os cookies. Navegação completa para `/login` ou `/admin/login` descarta o estado autenticado e o cache do roteador; não há login automático. O bootstrap mantém seu fluxo próprio. Contratos e limites detalhados no README backend.

## Homepage e navegação autenticada

| Rota | Conteúdo | Contexto exigido pela API |
|---|---|---|
| `/` | Início, boas-vindas e espaço reservado para funcionalidades futuras | Sessão plena comum |
| `/settings` | Perfil existente, edição de usuário/e-mail e senha | Sessão plena comum |
| `/admin` | Início master | Sessão plena master, senha trocada e MFA |
| `/admin/settings` | Perfil existente master | Sessão plena master, senha trocada e MFA |
| `/admin/organizations` | Lista e gestão de organizações | Sessão plena master, senha trocada e MFA |

Cada página dinâmica chama `requireWelcome(false)` ou `requireWelcome(true)` com contexto fixado no servidor e consulta o endpoint de perfil correspondente com `cache: "no-store"`. Ausência, expiração, sessão restrita ou tipo incorreto continuam redirecionando para `/login` ou `/admin/login`. O shell é composto depois dessa autorização em cada página, sem depender de um layout persistente ou de flags do navegador. As páginas de login e os destinos após autenticação permanecem iguais.

`AuthenticatedShell.tsx` e seu CSS Module fornecem sidebar fixa no desktop, marca LOGIN, seção Plataforma, Início e Organizações apenas para master, além do breadcrumb da seção. Em telas pequenas, a navegação permanece visível em uma faixa superior com quebra de linhas, sem menu modal ou rolagem horizontal. A homepage usa apenas o username real da API e um painel explicitamente reservado; não há métricas ou atividades fictícias.

`UserMenu.tsx` mostra a inicial do username e usa um botão de expansão com `aria-expanded`/`aria-controls`. É um disclosure com links e botões nativos: Enter/Espaço abrem, Tab percorre as opções, Escape fecha e devolve o foco. Sair do grupo com o foco também fecha. Escolher uma opção fecha o menu. Configurações aponta para a rota do contexto autorizado. O componente `Logout.tsx` existente é reutilizado em modo compacto, com as mesmas chamadas e redirecionamentos; falha reabre as opções e anuncia o erro. Master preserva Sair e esquecer este dispositivo. O perfil/editor e a área de sessão existentes permanecem disponíveis.

**Escopo daquela etapa de navegação:** organizações ainda eram um placeholder; a implementação posterior está descrita abaixo.

Validação desta navegação (03/10/2026): `npm run lint` e `npm run build` aprovados; 2 testes unitários e 10 testes Playwright aprovados com API/PostgreSQL descartáveis. A suíte cobre homepage comum/master, breadcrumb, Organizações exclusiva, acesso direto sem sessão e com sessão restrita, rejeição entre contextos, menu por teclado/Escape, perfil/edição/senha e ambos os logouts. Axe e ausência de overflow foram verificados em 1440, 390 e 320 px; capturas de homepage inspecionadas em desktop/mobile. Execução isolada usou portas 16930/16931/16940 e `LD_LIBRARY_PATH=/tmp/login-security-browser-libs/usr/lib/x86_64-linux-gnu`, conforme suporte local ao Chromium já documentado. Nenhuma imagem Docker foi reconstruída.

## Organizações

`/admin/organizations` lista organizações reais com busca por nome, filtro ativa/inativa, paginação (5, 10, 25, 50 ou 100 itens), criação, edição do nome e ativação/desativação. O formulário aceita nomes repetidos, de 1 a 200 caracteres após remoção de espaços nas extremidades. A coluna Usuários abre a gestão de vínculos da organização.

`/admin/organizations/[id]` apresenta breadcrumb de retorno, nome, estado e aba Visão geral com criação/atualização e ações. O administrador permanece na própria identidade. Ambas as páginas verificam a sessão master no servidor; cada chamada da API é autorizada novamente pelo backend. `features/organizations` contém componentes, estilos e serviço HTTP próprios, reutilizando `AuthenticatedShell`. Requisições obsoletas são canceladas, estados vazios/erros/carregamento são apresentados e sessão expirada encaminha ao login. A tabela tem rolagem interna em telas estreitas.

Validação de organizações (03/10/2026): lint/build aprovados; 2 testes unitários e 10 testes Playwright aprovados com API e PostgreSQL descartáveis. Fluxo master cria, edita, desativa/ativa, filtra, busca e recarrega organização persistida. Axe e ausência de overflow da página verificados em desktop (1440 px) e mobile (390/320 px); tabela usa rolagem interna. Chromium utilizou as bibliotecas temporárias existentes em `/tmp/login-security-browser-libs/usr/lib/x86_64-linux-gnu`.

### Cadastro e gestão de usuários

A página `/admin/organizations/[id]` agora inclui **Usuários da organização**, mantendo o formulário de nome e a visão geral existentes. Não existe wizard nem terceiro passo de cadastro na versão encontrada no repositório. O componente `features/organizations/Members.tsx` oferece cadastrar conta comum (usuário, e-mail, senha temporária e papel), vincular conta existente pelo e-mail, listar, alterar papel e confirmar a remoção do vínculo. Os papéis exibidos são **Membro** e **Administrador da organização**; não alteram o Master global.

Formulários usam controles nativos, foco inicial, retorno ao acionador ao cancelar e foco no título da seção após salvar, bloqueio de envios concorrentes, mensagens acessíveis e limpeza da senha em sucesso, erro ou cancelamento. Remover vínculo preserva a conta e as outras organizações. Não existe envio de convite; isso é informado no cadastro. A API é a autoridade para autorização, validação e duplicidade. A tabela reutiliza os estilos responsivos e rolagem interna das organizações. A suíte integrada inclui cadastro dos dois papéis, alteração, duplicidade, remoção/revinculação, persistência após reload, teclado, axe e larguras 1440/390/320 px.

Validação em 04/10/2026: lint e build de ambos os projetos aprovados; Prisma Client e OpenAPI regenerados; **52/52 testes backend**, **2/2 unitários frontend** e **10/10 Playwright** aprovados. Suíte real com API/PostgreSQL descartáveis nas portas 17530/17531/17540, incluindo novos cenários de membros, teclado, axe sem violações e ausência de overflow da página em 1440/390/320 px. As bibliotecas ausentes do Chromium foram extraídas em `/tmp/login-members-browser-libs` e usadas via `LD_LIBRARY_PATH`, sem instalação global. Nenhuma migration foi aplicada ao banco real e nenhuma imagem Docker foi reconstruída. Não há fluxo de convites ou terceiro passo de cadastro para verificar nesta versão.

### Primeiro acesso com senha temporária

O cadastro explica que o Master deve entregar as credenciais por um canal combinado e que a senha é temporária. Vincular conta existente não pede senha nem altera suas credenciais ou sessões. Nenhum e-mail é enviado e sua titularidade não é verificada.

A própria página `/login` apresenta **Uma senha só sua** quando a API retorna `stage=password` para uma conta comum. Solicita nova senha e confirmação, valida igualdade, limpa os campos sensíveis após envio e chama `POST /auth/initial-password`. A etapa é retomada após reload pela consulta de sessão. Homepage, perfil e páginas administrativas permanecem inacessíveis até a conclusão. Sucesso gira o cookie e abre a homepage comum; não abre configuração MFA nem telas Master. O `/admin/login` preserva o primeiro acesso Master com troca de senha, configuração MFA e códigos de recuperação. Não foram criadas rotas de login para administradores organizacionais.

Os testes integrados cadastram uma pessoa pelo Master, entram em outro contexto de navegador com a senha temporária, conferem os redirecionamentos das páginas protegidas, retomada da etapa, confirmação divergente, limpeza dos campos, acessibilidade/responsividade e acesso comum depois da troca. Os fluxos de vínculo, alteração de papel, remoção e primeiro acesso Master continuam cobertos.

Validação da correção de senha temporária (04/10/2026): lint/build backend e frontend aprovados; OpenAPI regenerado; **55/55 testes backend**, **2/2 unitários frontend** e **10/10 Playwright** aprovados. Testes reais com PostgreSQL descartável verificaram troca comum concorrente (somente uma conclusão), prazo de 8 horas, revogação das sessões antigas, rejeição da senha temporária, separação de Master/MFA, preservação de credenciais ao vincular conta existente e rollback da conta/vínculo na mesma unidade de trabalho. Testes isolados verificaram mudanças de identidade, validade, estágio, papel global, flag e hash durante o processamento. Navegador com API e banco descartáveis nas portas 17630/17631/17640 incluiu o primeiro acesso comum, teclado e axe/responsividade em 1440/390/320 px; fluxo Master existente preservado. Sem nova migration, sem alteração do banco/volume real e sem reconstrução das imagens Docker. E-mail permanece sem verificação de titularidade.

### Navegação e ações de organizações

A listagem usa a largura disponível e mantém a coluna de ações compacta, com rolagem horizontal restrita à tabela. O nome abre a organização; a linha não é clicável. O lápis abre as ações Abrir, Editar e Ativar/Desativar. Adicionar organização usa a paleta escura dos controles existentes.

Visão geral e Usuários são abas de navegação com links Next e `aria-current`: apenas a seção selecionada é montada. `?tab=users` seleciona Usuários, inclusive em recarga e voltar/avançar; a URL sem esse parâmetro abre Visão geral. Trocar de aba descarta formulários de usuários ainda não enviados.

Adicionar usuário reúne cadastro e vínculo em um disclosure nativo, compartilhado com as ações da listagem (`ActionMenu.tsx`). Os popovers usam a camada superior do navegador para evitar corte pela tabela, nome acessível, estado expandido, Tab entre opções, Enter/Espaço para abrir, Escape e clique externo para fechar. A seleção fecha as opções; cancelar o formulário devolve o foco ao acionador. Requer navegador com suporte à API Popover. Não há novas dependências nem mudanças nos contratos de API.

### Apresentação de erros

`src/lib/api-errors.ts` centraliza a tradução de códigos/status HTTP e aceita somente mensagens e erros de campo públicos conhecidos. Login inválido permanece genérico; senha repetida no primeiro acesso, código MFA inválido e senha atual não confirmada têm orientações próprias. Sessão/acesso, validação, conflito, limite de tentativas, indisponibilidade e falha inesperada têm fallbacks seguros; falhas de rede e respostas sem JSON não exibem exceções técnicas. O serviço de organizações reutiliza esse mapeamento, preservando mensagens autorizadas de cadastro/vínculo.

Identificadores preenchidos permanecem após falhas; senha e código de autenticação são limpos após envio. Perfil mantém seus erros por campo e limpeza de segredos; formulários de perfil e membros associam a mensagem geral ao formulário. `npm run test:unit` também verifica o mapeamento seguro e a proteção contra detalhes de enumeração no login.

## Usuários, cargos e permissões organizacionais

A organização tem três abas: Visão geral, Usuários e Cargos e permissões (`?tab=permissions`). Usuários oferece busca por usuário/e-mail, filtro por cargo, paginação e ações em menu. Somente dados existentes são exibidos. A configuração mostra o administrador com acesso geral protegido e concessões de Membro inicialmente desmarcadas.

Contas comuns com acesso organizacional navegam por `/organizations` e `/organizations/[id]`. SSR consulta capacidades na API; a sidebar mostra Organizações somente quando há acesso. Sem concessões, Membro mantém suas áreas pessoais e não abre páginas organizacionais. Cada chamada é autorizada novamente pela API; alterações não dependem de novo login. O Master permanece no namespace administrativo. [Modelo, migration e limitações da busca cifrada](../docs/features/organization-permissions.md).
