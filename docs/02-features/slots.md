# Feature Spec — Slots

## 1. Resumo
Gestão de espaços internos da arena e de seus horários disponíveis, permitindo que a arena cadastre locais utilizáveis e publique slots reserváveis por organizadores.

## 2. Objetivo
Permitir que o sistema tenha disponibilidade estruturada de horários por arena, criando a base para reserva de espaços e posterior criação de eventos vinculados.

## 3. Atores envolvidos
- Arena
- Administrador
- Organizador (como leitor da disponibilidade)

## 4. Regras de negócio
1. Cada slot pertence a um espaço interno de uma arena.
2. A arena é responsável por cadastrar e manter seus slots.
3. Um espaço pode possuir vários slots em datas e horários diferentes.
4. Slots não podem se sobrepor dentro do mesmo espaço.
5. Um slot pode ter preço próprio.
6. Um slot pode permitir ou não recorrência.
7. Um slot disponível pode ser reservado por organizadores em sprint posterior.
8. Apenas o dono da arena ou admin pode criar, editar, bloquear ou cancelar slots.
9. O status do slot deve refletir sua disponibilidade operacional.
10. O organizador só pode visualizar e selecionar slots com status compatível com reserva.

## 5. Fluxo principal
1. Dono da arena cria um espaço interno.
2. Dono da arena cadastra um ou mais slots para esse espaço.
3. Sistema valida conflito de horário.
4. Slots válidos são persistidos.
5. Organizadores podem consultar disponibilidade.
6. Arena pode editar ou bloquear slots futuros.

## 6. Fluxos alternativos

### 6.1 Criação em lote
A arena pode cadastrar vários slots com mesma lógica de preço e duração em datas diferentes. No MVP, isso pode ser adiado e começar com criação unitária.

### 6.2 Slot bloqueado manualmente
A arena pode bloquear um horário sem excluí-lo, impedindo reservas futuras.

## 7. Fluxos de exceção

### 7.1 Conflito de horário
- condição: novo slot sobrepõe um slot já existente no mesmo espaço
- resultado esperado: erro 409

### 7.2 Espaço inexistente
- condição: arenaSpaceId inválido
- resultado esperado: erro 404

### 7.3 Usuário sem permissão
- condição: usuário não é dono da arena nem admin
- resultado esperado: erro 403

### 7.4 Datas inválidas
- condição: startAt maior ou igual a endAt
- resultado esperado: erro 422

## 8. Entidades envolvidas
- Arena
- ArenaSpace
- ArenaSlot
- ArenaPolicy

## 9. Campos relevantes

### ArenaSpace
- id
- arenaId
- name
- type
- description
- capacitySuggestion
- status

### ArenaSlot
- id
- arenaSpaceId
- startAt
- endAt
- price
- status
- allowsRecurring
- notes
- createdAt
- updatedAt

## 10. Estado e transições

### ArenaSpace status
- ACTIVE
- INACTIVE
- BLOCKED

### ArenaSlot status
- AVAILABLE
- HOLD
- RESERVED
- BLOCKED
- EXPIRED
- CANCELLED

### Transições válidas do slot
- AVAILABLE -> HOLD
- AVAILABLE -> RESERVED
- AVAILABLE -> BLOCKED
- HOLD -> RESERVED
- HOLD -> EXPIRED
- RESERVED -> CANCELLED
- BLOCKED -> AVAILABLE

## 11. Entradas
- arenaId
- nome do espaço
- tipo do espaço
- descrição do espaço
- capacidade sugerida
- data e hora inicial do slot
- data e hora final do slot
- preço
- permite recorrência
- observações

## 12. Saídas
- espaço criado
- slot criado
- slot atualizado
- lista de slots por arena
- lista de slots por espaço
- disponibilidade pública ou autenticada para organizadores

## 13. Validações
- arenaId válido
- arenaSpaceId válido
- nome do espaço obrigatório
- tipo do espaço obrigatório
- startAt < endAt
- price >= 0
- não permitir sobreposição de slots no mesmo espaço
- allowsRecurring compatível com política da arena quando aplicável

## 14. Regras de concorrência
1. A criação de slot deve verificar conflito com segurança para evitar sobreposição.
2. A atualização de slot não pode permitir colisão com outros slots ativos do mesmo espaço.
3. Em sprint futura, a transição para `HOLD` ou `RESERVED` será crítica para evitar dupla reserva.

## 15. Regras de persistência
- salvar espaço da arena
- salvar slot vinculado ao espaço
- atualizar slot
- bloquear slot
- cancelar slot
- listar disponibilidade por filtros básicos

## 16. Regras de cache
- listagens públicas de disponibilidade podem ser cacheadas futuramente
- qualquer alteração em slot deve invalidar cache relacionado à arena, espaço ou período afetado

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 espaço ou arena não encontrado
- 409 conflito de horário
- 422 regra de domínio inválida

## 18. Critérios de aceite
- [ ] Dono da arena consegue criar espaço interno
- [ ] Dono da arena consegue criar slot para um espaço
- [ ] Sistema impede sobreposição de slots no mesmo espaço
- [ ] Arena consegue editar slot futuro
- [ ] Arena consegue bloquear slot
- [ ] Organizadores conseguem consultar slots disponíveis
- [ ] Usuário sem permissão não consegue alterar espaços ou slots de outra arena

## 19. Fora do escopo
- reserva efetiva do slot por organizador
- pagamento de reserva do slot
- recorrência operacional completa
- geração automática avançada em lote
- calendário visual complexo
- sincronização externa com agenda da arena