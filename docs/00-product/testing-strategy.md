# Spolê — Testing Strategy

## 1. Objetivo
Definir a estratégia oficial de testes automatizados do projeto Spolê, garantindo qualidade técnica, redução de regressões e previsibilidade na evolução do sistema sprint a sprint.

## 2. Princípio geral
Todo recurso novo implementado deve sair acompanhado de testes automatizados compatíveis com seu impacto técnico e de negócio.

Isso significa que:
- endpoints novos devem possuir testes automatizados
- regras de negócio críticas devem possuir testes automatizados
- correções de bug devem, sempre que possível, incluir testes de regressão
- a sprint não é considerada concluída sem evidência mínima de teste

## 3. Papel desta estratégia no projeto
Esta spec é transversal a todo o projeto e deve ser aplicada junto com:
- `docs/00-product/master-spec.md`
- `docs/00-product/api-standards.md`
- todas as specs de sprint
- todas as specs de feature relevantes

## 4. Objetivos da estratégia de testes
1. Garantir que regras de negócio críticas continuem corretas ao longo do tempo.
2. Reduzir risco de regressão entre sprints.
3. Tornar o Cursor mais disciplinado na entrega de implementações.
4. Facilitar refatorações futuras.
5. Melhorar a confiança no deploy.
6. Detectar quebras de integração cedo.

## 5. Tipos de teste adotados

### 5.1 Testes unitários
Devem validar regras de negócio isoladas, utilitários, validadores e serviços com comportamento determinístico.

#### Exemplos
- validação de capacidade de evento
- transição de status permitida
- cálculo de taxa
- expiração de reserva
- geração de código privado
- validações de política da arena

### 5.2 Testes de integração
Devem validar o comportamento real da aplicação em integração com:
- rotas
- controllers
- services
- banco
- redis, quando aplicável

#### Exemplos
- cadastro de usuário
- login
- criação de evento
- listagem de eventos
- criação de slot
- criação de reserva
- criação de booking

### 5.3 Testes de regressão
Devem ser criados quando um bug relevante for corrigido, para impedir que ele volte a ocorrer.

#### Exemplos
- usuário conseguia editar evento de outro organizador
- slot aceitava sobreposição
- booking confirmava compra duplicada
- evento privado aparecia na busca pública

### 5.4 Testes de concorrência
Devem ser usados em fluxos críticos de disputa por recurso.

#### Fluxos mais importantes
- booking de vaga
- reserva de slot
- confirmação de pagamento
- expiração de booking
- liberação de vaga após TTL

### 5.5 Smoke tests
Devem validar se os principais fluxos do sistema ainda estão vivos após mudanças relevantes.

#### Exemplos
- aplicação sobe
- healthcheck responde
- autenticação funciona
- endpoint principal responde corretamente

## 6. Política mínima por tipo de sprint

### 6.1 Sprints de infraestrutura
Devem incluir testes compatíveis com a infraestrutura criada.

#### Mínimo esperado
- teste do healthcheck
- teste de bootstrap da aplicação, quando viável
- validação de ambiente e conexões essenciais

### 6.2 Sprints de CRUD simples
Devem incluir:
- testes de integração dos endpoints principais
- testes unitários das validações e regras mais importantes

### 6.3 Sprints de domínio crítico
Devem incluir:
- testes de integração
- testes unitários de regras centrais
- testes de concorrência, quando houver disputa por recurso
- testes de regressão, quando houver bug corrigido

### 6.4 Sprints de pagamento, booking ou reserva
Devem obrigatoriamente incluir:
- testes de integração
- testes de concorrência ou comportamento idempotente
- testes de expiração e mudança de status
- testes de regressão quando aplicável

## 7. Regra de obrigatoriedade
Uma implementação nova não deve ser considerada pronta se:
- criou endpoint novo sem teste
- adicionou regra crítica sem teste
- corrigiu bug importante sem teste de regressão, quando viável
- alterou comportamento central sem atualizar ou criar testes compatíveis

## 8. Escopo mínimo de testes por módulo

### Auth
- cadastro com sucesso
- bloqueio de e-mail duplicado
- login com sucesso
- falha com credencial inválida
- acesso a rota protegida com token válido
- bloqueio com token inválido

### Users
- leitura do próprio perfil
- atualização de dados permitidos
- bloqueio de alteração de role por usuário comum

### Events
- criação de evento gratuito
- criação de evento pago com preço válido
- falha em evento pago sem preço
- listagem de eventos públicos
- evento privado fora da listagem pública
- edição pelo dono
- bloqueio de edição por terceiro

### Arenas
- criação de arena
- edição pelo owner
- bloqueio de edição por usuário sem permissão

### Slots
- criação de espaço
- criação de slot
- bloqueio de sobreposição
- consulta de disponibilidade

### Reservations
- criação de reserva em slot disponível
- falha para slot indisponível
- recorrência apenas quando permitida
- bloqueio de operação por usuário sem permissão

### Bookings
- criação de booking com vaga disponível
- bloqueio da vaga durante o TTL
- expiração automática
- confirmação após pagamento
- não permitir dupla compra

### Payments
- criação de pagamento pendente
- confirmação por webhook válido
- idempotência de confirmação
- falha não confirma compra
- pagamento não duplica efeito no domínio

### Search
- busca por termo
- filtros por categoria e cidade
- evento privado fora da busca pública
- paginação consistente

## 9. Critérios de qualidade dos testes
Os testes devem:
- ser legíveis
- ser previsíveis
- ser independentes entre si
- ter nomes claros
- evitar dependência desnecessária de ordem de execução
- focar em comportamento, não em detalhes irrelevantes de implementação

## 10. O que evitar
- testes frágeis demais
- testes excessivamente acoplados a detalhes internos
- testes redundantes sem valor real
- falsa cobertura com asserts irrelevantes
- confiar apenas em teste manual para fluxos críticos

## 11. Ambientes e execução
A suíte de testes deve ser executável localmente.

Quando possível, deve haver:
- ambiente de teste separado
- banco de teste isolado
- redis de teste isolado ou mock controlado
- seed mínima ou factories para preparar dados

## 12. Estratégia de dados de teste
Preferir:
- factories
- builders
- fixtures simples
- dados mínimos necessários

Evitar:
- dependência em massa de dados manuais
- dependência em banco compartilhado entre testes
- cenários grandes demais quando um pequeno resolve

## 13. Regra para o Cursor
Sempre que implementar uma sprint, o Cursor deve:
1. criar testes automatizados compatíveis com o escopo
2. informar claramente quais testes foram criados
3. explicar como executar os testes
4. dizer o que ficou sem teste e por quê, se houver
5. não considerar a tarefa concluída sem revisar os critérios de teste da sprint

## 14. Definição de pronto relacionada a testes
Uma tarefa só pode ser considerada pronta quando:
- os testes relevantes foram criados
- os testes passam localmente
- os cenários críticos da sprint estão cobertos
- os bugs corrigidos receberam regressão quando aplicável

## 15. Relação com as specs de sprint
Toda sprint deve reforçar esta estratégia em:
- critérios técnicos
- observações para o Cursor
- critérios de aceite, quando necessário

## 16. Relação com pipeline futuro
Quando o projeto evoluir, esta estratégia deve ser integrada ao pipeline para:
- rodar testes automaticamente
- impedir merge ou deploy com falhas críticas
- manter feedback rápido para o time

## 17. Regra final
No Spolê, testes automatizados não são um extra opcional. Eles fazem parte do entregável técnico de cada sprint.