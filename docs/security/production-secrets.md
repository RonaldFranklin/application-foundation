# Gestão de segredos por ambiente e requisito de produção

**Status:** decisão operacional obrigatória para qualquer implantação de produção.
**Escopo:** chaves de cifragem/HMAC e demais credenciais privadas consumidas pelo backend.

## Decisão

- **Desenvolvimento local:** é permitido usar um arquivo `.env` local, fora do Git e fora das imagens Docker. Esse arquivo é conveniência de desenvolvimento, não um cofre.
- **Produção:** sem exceção, segredos devem ser armazenados no AWS Secrets Manager, protegidos pelo AWS KMS, e disponibilizados somente ao backend por uma identidade de workload IAM de privilégio mínimo.
- **Bloqueio de release:** não publicar produção enquanto o backend/deploy não buscar ou receber os segredos do mecanismo aprovado e a configuração não tiver sido verificada. Não substituir essa integração por um `.env` persistente no servidor.

## Segredos abrangidos

No mínimo, considerar:

- `ENCRYPTION_KEY`: chave AES de 32 bytes que cifra campos sensíveis.
- `HMAC_KEY`: chave independente de 32 bytes usada para índices cegos e derivados de verificação.
- `MASTER_INITIAL_PASSWORD`: credencial de bootstrap Master; atualmente a configuração da aplicação exige esse valor na inicialização, mesmo depois do bootstrap. Tratar como segredo de alta criticidade até que o código suporte um fluxo seguro de bootstrap concluído sem manter essa credencial permanentemente disponível.
- `DATABASE_URL` e credenciais de infraestrutura, quando contiverem senha.
- `TURNSTILE_SECRET_KEY`, credenciais SMTP e outros tokens privados de integração.

Nunca disponibilizar esses valores no frontend, em variáveis `NEXT_PUBLIC_*`, argumentos de build, Dockerfile, imagem, repositório, logs, telemetria ou resposta HTTP. `ENCRYPTION_KEY`, `HMAC_KEY` e a chave KMS são materiais distintos; não reutilizar a mesma chave para AES e HMAC. A chave KMS protege o segredo armazenado no Secrets Manager, não substitui diretamente as chaves de dados da aplicação.

## Implementação exigida antes de produção

O backend atual valida configuração através de `process.env`; isso **não significa que exista integração com AWS Secrets Manager**. O trabalho de produção precisa implementar e validar uma das opções abaixo:

1. Preferida: o backend obtém o segredo do AWS Secrets Manager no startup usando o SDK e a role IAM da tarefa/instância, valida o documento e fornece os valores à configuração em memória; ou
2. Um agente/serviço de deploy confiável obtém o segredo e monta arquivos somente leitura para o backend, que deve suportar leitura desses arquivos.

Não colocar credenciais IAM de longa duração na aplicação. Usar role de workload (por exemplo, task role do ECS ou instance profile apropriado), limitada aos ARNs dos segredos necessários e à chave KMS correspondente. Só o serviço backend deve ter acesso aos segredos de cifragem e credenciais privadas; frontend e serviços que não precisam deles não recebem permissões.

Manter o tráfego com a AWS em TLS e rede privada quando disponível. Restringir quem pode ler, alterar e administrar os segredos; registrar acessos administrativos e alterações com CloudTrail; alertar sobre leitura/alteração inesperada. O valor do segredo não deve aparecer na auditoria/log.

Se um secret for fornecido como arquivo, restringir leitura ao usuário do processo/container, montar como somente leitura e proteger a origem no host/deploy. Se um adaptador temporário copiar o valor para uma variável de ambiente, reconhecer que ela pode ser observada via configuração/inspeção de container e processos com privilégios; isso não é a opção preferida.

## Desenvolvimento local

1. Usar `backend/.env` ou o caminho local documentado no README do backend, conforme o comando de execução.
2. Nunca versionar o arquivo. Manter `.env.example` apenas com placeholders e verificar `.gitignore`/contexto Docker.
3. No Linux/WSL, restringir permissões do arquivo ao usuário local (por exemplo, `chmod 600`) e proteger o disco/conta do sistema.
4. Não colar segredos em comandos, screenshots, tickets, chats, logs ou saída de `docker compose config` / `docker inspect`.
5. Gerar valores distintos, aleatórios e próprios para cada ambiente. Não usar a mesma chave em dev, staging e produção.

Em máquina compartilhada ou com risco de comprometimento, prefira um secret manager também para dev. `.env` local é permitido no ambiente pessoal de desenvolvimento por decisão explícita, mas não deve ser copiado para o servidor de produção.

## KMS, backup e recuperação

- AWS Secrets Manager cifra os valores armazenados com KMS. Definir se a política do sistema permite a chave gerenciada pela AWS ou exige uma chave KMS gerenciada pelo cliente; para a chave do cliente, restringir uso ao Secrets Manager e à role responsável.
- Fazer backup/recuperação das chaves conforme as capacidades e políticas AWS aprovadas. O banco e as chaves não podem depender do mesmo conjunto de credenciais/acesso.
- Testar restauração em ambiente isolado: recuperar segredo, iniciar backend, decifrar dados existentes e validar busca por índices cegos.
- Não rotacionar `ENCRYPTION_KEY`, `HMAC_KEY` ou `KEY_VERSION` como operação manual. A versão atual da aplicação carrega um único par e não executa migração de dados/índices. Rotação exige feature de migração compatível, plano de rollback, backup e exercício de restauração. Rotação do segredo no Secrets Manager, sem migração coordenada na aplicação, pode tornar dados existentes ilegíveis ou não pesquisáveis.
- Definir retenção e controle de acesso para versões antigas antes de qualquer rotação; removê-las somente após validar registros, índices e backups.

## Checklist obrigatório de go-live

- [ ] Backend lê segredos de AWS Secrets Manager (ou arquivos montados pelo mecanismo aprovado), não de `.env` persistente no host.
- [ ] A identidade IAM do workload tem acesso somente aos segredos e à chave KMS necessários.
- [ ] Frontend e demais serviços não recebem as chaves AES/HMAC.
- [ ] Secrets são únicos por ambiente; AES e HMAC são independentes e atendem ao formato exigido pela configuração.
- [ ] Bootstrap Master foi tratado de acordo com a exigência atual de configuração e o acesso ao segredo está restrito.
- [ ] Nenhum valor real aparece no Git, imagem, logs, pipeline output, telemetry ou documentação.
- [ ] TLS, auditoria de acesso ao secret manager e alertas estão configurados.
- [ ] Backup/restauração das chaves foi testado junto com restauração de banco.
- [ ] Não houve rotação de chave de dados sem migração, verificação e plano de rollback.
- [ ] Procedimento de incidente define revogação de acesso e resposta à suspeita de exposição.

Qualquer item não concluído bloqueia o go-live de produção. Essa regra deve ser revista apenas por decisão explícita de segurança/produto documentada; não é uma preferência opcional de cada deploy.

## Referências

- [AWS Secrets Manager: boas práticas](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [AWS Secrets Manager: criptografia e KMS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)
- [Docker Compose: secrets](https://docs.docker.com/reference/compose-file/secrets/)
- [Docker Compose: boas práticas de variáveis de ambiente](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
