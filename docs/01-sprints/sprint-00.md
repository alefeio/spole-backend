# Sprint 00 — Definição e fundação do projeto

## 1. Objetivo da sprint
Preparar o projeto Spolê para implementação disciplinada, definindo stack, arquitetura, convenções, estrutura inicial e critérios que servirão de base para as próximas sprints.

## 2. Problema que esta sprint resolve
Sem fundação técnica e documental, o desenvolvimento tende a ficar desorganizado, o Cursor tende a antecipar escopos e o projeto corre risco de retrabalho estrutural.

## 3. Escopo da sprint

### Inclui
- criação do repositório da API
- definição da estrutura de diretórios
- criação da documentação base em `/docs`
- definição das convenções técnicas
- definição dos domínios iniciais da API
- criação do README inicial
- definição dos ambientes
- definição da estratégia de versionamento

### Não inclui
- autenticação funcional
- endpoints de negócio
- banco já conectado
- Redis já conectado
- lógica de eventos

## 4. Módulos afetados
- `docs/`
- `src/` estrutura inicial
- `README.md`
- arquivos de configuração do projeto

## 5. Dependências
- decisão da stack
- decisão do framework Node.js
- decisão do padrão arquitetural interno

## 6. Regras de negócio desta sprint
1. A sprint não implementa negócio; ela prepara o terreno.
2. Toda estrutura criada deve respeitar arquitetura modular por domínio.
3. A documentação criada nesta sprint passa a ser fonte de verdade para o Cursor.

## 7. Entidades e tabelas envolvidas
Nenhuma implementação obrigatória nesta sprint.

## 8. Endpoints esperados
Nenhum endpoint de negócio obrigatório.

## 9. Fluxo funcional
1. Definir estrutura da API.
2. Definir padrões.
3. Documentar regras-base.
4. Preparar o projeto para a Sprint 01.

## 10. Critérios de aceite
- [ ] Repositório da API criado
- [ ] Estrutura inicial de pastas criada
- [ ] Pasta `/docs` criada com specs iniciais
- [ ] README inicial criado
- [ ] Convenções técnicas definidas
- [ ] Arquitetura base documentada

## 11. Critérios técnicos
- [ ] Estrutura modular previsível
- [ ] Sem antecipação de módulos fora do escopo
- [ ] Documentação legível e organizada
- [ ] testes automatizados compatíveis com o escopo
- [ ] testes executáveis localmente

## 12. Riscos e cuidados
- criar estrutura acoplada demais
- documentar pouco
- deixar o Cursor sem fonte de verdade

## 13. Observações para o Cursor
1. Não implementar autenticação nem eventos nesta sprint.
2. O foco é preparar o projeto.
3. Todo arquivo criado deve servir de base para as próximas sprints.
4. Todo endpoint novo deve sair com testes
5. Toda correção relevante deve incluir regressão, quando aplicável