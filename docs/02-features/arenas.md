# Feature Spec — Arenas

## 1. Resumo
Gestão de arenas e seus dados principais, permitindo que donos ou gestores de espaços esportivos cadastrem suas arenas, configurem informações básicas e preparem a estrutura para cadastro de espaços e horários.

## 2. Objetivo
Permitir que a plataforma tenha um domínio próprio para arenas, separado dos eventos, de forma que organizadores possam futuramente reservar horários disponíveis nesses espaços.

## 3. Atores envolvidos
- Arena
- Administrador

## 4. Regras de negócio
1. A arena não cria eventos no fluxo de aluguel de espaço.
2. A arena apenas cadastra seu estabelecimento, seus espaços internos e seus horários disponíveis.
3. Cada arena deve ter um usuário responsável.
4. Uma arena pode possuir um ou mais espaços internos.
5. A arena pode definir políticas próprias de reserva.
6. Apenas o dono da arena ou um admin pode editar a arena.
7. O cadastro da arena deve conter dados mínimos de identificação e localização.
8. O status da arena pode ser controlado para impedir uso indevido ou cadastros inválidos.

## 5. Fluxo principal
1. Usuário autenticado com permissão adequada cria uma arena.
2. Sistema valida os dados.
3. Sistema associa a arena ao usuário responsável.
4. Arena passa a existir no sistema.
5. Usuário responsável pode editar dados da arena.
6. Admin pode consultar e gerenciar arenas.

## 6. Fluxos alternativos

### 6.1 Arena criada por admin
O admin pode criar uma arena para posterior vinculação ou ajuste operacional.

### 6.2 Arena com aprovação futura
Se desejado futuramente, a arena pode começar com status pendente até aprovação administrativa. No MVP, isso pode ser simplificado.

## 7. Fluxos de exceção

### 7.1 Usuário sem permissão para editar
- condição: usuário não é dono da arena nem admin
- resultado esperado: erro 403

### 7.2 Dados obrigatórios ausentes
- condição: nome, contato ou localização incompletos
- resultado esperado: erro 400 ou 422

### 7.3 Arena não encontrada
- condição: id inválido ou inexistente
- resultado esperado: erro 404

## 8. Entidades envolvidas
- Arena
- ArenaAddress
- ArenaPolicy
- User

## 9. Campos relevantes

### Arena
- id
- ownerId
- name
- slug
- description
- phone
- email
- document
- status
- createdAt
- updatedAt

### ArenaAddress
- id
- arenaId
- zipCode
- street
- number
- district
- city
- state
- latitude
- longitude

### ArenaPolicy
- id
- arenaId
- allowRecurring
- minAdvanceHours
- minReservationPaymentPercent
- cancellationPolicyText
- cancellationWindowHours
- lateCancellationPenaltyType
- lateCancellationPenaltyValue

## 10. Estado e transições

### Arena status
- ACTIVE
- INACTIVE
- SUSPENDED
- PENDING_APPROVAL

### Transições válidas
- PENDING_APPROVAL -> ACTIVE
- ACTIVE -> INACTIVE
- ACTIVE -> SUSPENDED
- INACTIVE -> ACTIVE

## 11. Entradas
- nome da arena
- descrição
- telefone
- e-mail
- documento
- endereço completo
- coordenadas opcionais
- políticas básicas de reserva

## 12. Saídas
- arena criada
- arena atualizada
- detalhes da arena
- lista de arenas

## 13. Validações
- ownerId válido
- nome obrigatório
- slug único, se usado
- telefone ou e-mail de contato obrigatório
- cidade e estado obrigatórios
- percentuais financeiros dentro de faixa válida
- minReservationPaymentPercent entre 0 e 100

## 14. Regras de concorrência
Não há disputa crítica nesta feature no nível de concorrência transacional. O ponto crítico virá no cadastro de slots e reservas, não no cadastro da arena em si.

## 15. Regras de persistência
- salvar dados da arena
- salvar endereço da arena
- salvar ou atualizar política da arena
- atualizar status da arena quando necessário

## 16. Regras de cache
- detalhes de arena podem ser cacheados futuramente
- listagens públicas ou administrativas podem ser cacheadas conforme necessidade
- qualquer atualização da arena deve invalidar o cache correspondente

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 arena não encontrada
- 409 slug já existente, se aplicável
- 422 regra de domínio inválida

## 18. Critérios de aceite
- [ ] Usuário autorizado consegue criar uma arena
- [ ] Arena fica vinculada a um owner
- [ ] Arena possui endereço persistido corretamente
- [ ] Arena pode ter política básica cadastrada
- [ ] Dono da arena consegue editar a própria arena
- [ ] Admin consegue consultar e gerenciar arenas
- [ ] Usuário sem permissão não consegue editar arena de outro dono

## 19. Fora do escopo
- cadastro de espaços internos
- cadastro de slots
- reserva de horários
- pagamento de reserva
- eventos vinculados à arena
- aprovação automatizada complexa
- onboarding avançado da arena