# Feature Spec — Reservations

## 1. Resumo
Gestão das reservas de horários de arena feitas por organizadores, permitindo transformar slots disponíveis em reservas confirmadas que poderão originar eventos na plataforma.

## 2. Objetivo
Permitir que organizadores reservem horários disponibilizados por arenas, respeitando regras financeiras e operacionais, e garantindo que um mesmo slot não seja reservado por mais de um organizador ao mesmo tempo.

## 3. Atores envolvidos
- Organizador
- Arena
- Administrador
- Sistema

## 4. Regras de negócio
1. A arena não cria o evento no fluxo de aluguel; ela apenas disponibiliza slots.
2. O organizador escolhe um slot disponível e cria uma reserva para esse horário.
3. Uma reserva pode ser avulsa ou recorrente.
4. A reserva só pode ser criada sobre um slot com status compatível com reserva.
5. Um slot não pode possuir mais de uma reserva confirmada ao mesmo tempo.
6. A arena pode definir:
   - antecedência mínima de reserva
   - percentual mínimo de pagamento da reserva
   - se permite recorrência
   - política de cancelamento
7. A reserva só é considerada confirmada após pagamento mínimo exigido, quando esse fluxo estiver ativo na sprint correspondente.
8. Antes da confirmação financeira, a reserva pode existir em estado temporário ou pendente.
9. Uma reserva confirmada pode ser usada para criar um evento vinculado ao horário reservado.
10. No MVP, a plataforma não cobra comissão sobre o valor do aluguel da arena.
11. Reservas recorrentes devem liberar automaticamente a ocorrência futura não paga até 24 horas antes.
12. Apenas o organizador dono da reserva ou um admin pode consultar e operar a própria reserva, salvo visões operacionais da arena.
13. A arena deve poder visualizar as reservas relacionadas aos seus slots.

## 5. Fluxo principal
1. Organizador autenticado consulta slots disponíveis.
2. Organizador escolhe um slot.
3. Sistema valida regras da arena e do slot.
4. Sistema cria a reserva.
5. Reserva fica em estado inicial compatível com o fluxo da sprint.
6. Após confirmação financeira, a reserva vira `CONFIRMED`.
7. Organizador pode usar a reserva confirmada para criar um evento vinculado.

## 6. Fluxos alternativos

### 6.1 Reserva avulsa
A reserva vale apenas para um único slot.

### 6.2 Reserva recorrente
A reserva cria uma recorrência semanal, quando permitido pela arena.

### 6.3 Reserva cancelada antes da confirmação
A reserva é cancelada e o slot volta a ficar disponível.

### 6.4 Liberação automática por inadimplência futura
Uma ocorrência recorrente não paga até 24 horas antes é liberada automaticamente.

## 7. Fluxos de exceção

### 7.1 Slot indisponível
- condição: slot já reservado, bloqueado ou incompatível
- resultado esperado: erro 409

### 7.2 Recorrência não permitida
- condição: organizador solicita recorrência em slot ou arena que não permite
- resultado esperado: erro 422

### 7.3 Antecedência mínima não respeitada
- condição: reserva solicitada fora da janela mínima exigida pela arena
- resultado esperado: erro 422

### 7.4 Usuário sem permissão
- condição: usuário tenta acessar ou cancelar reserva de outro organizador sem ser admin
- resultado esperado: erro 403

### 7.5 Reserva não encontrada
- condição: id inexistente
- resultado esperado: erro 404

## 8. Entidades envolvidas
- Arena
- ArenaPolicy
- ArenaSlot
- Reservation
- ReservationRecurrence
- ReservationOccurrence
- Payment, quando o fluxo financeiro estiver na sprint correspondente
- Event, no uso posterior da reserva

## 9. Campos relevantes

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

### ArenaSlot
- id
- arenaSpaceId
- startAt
- endAt
- price
- status
- allowsRecurring
- notes

### Reservation
- id
- slotId
- organizerId
- type
- status
- reservationCode
- totalPrice
- requiredPaymentAmount
- paidAmount
- expiresAt
- confirmedAt
- cancelledAt
- cancellationReason
- createdAt
- updatedAt

### ReservationRecurrence
- id
- reservationId
- frequency
- dayOfWeek
- startDate
- endDate
- active

### ReservationOccurrence
- id
- recurrenceId
- slotId
- date
- status
- dueAt
- paidAt
- releasedAt

## 10. Estado e transições

### Reservation status
- PENDING
- HOLD
- CONFIRMED
- EXPIRED
- CANCELLED

### Transições válidas
- PENDING -> HOLD
- PENDING -> CONFIRMED
- HOLD -> CONFIRMED
- HOLD -> EXPIRED
- PENDING -> CANCELLED
- HOLD -> CANCELLED
- CONFIRMED -> CANCELLED

### ReservationOccurrence status
- PENDING_PAYMENT
- CONFIRMED
- RELEASED
- CANCELLED

### Transições válidas da ocorrência
- PENDING_PAYMENT -> CONFIRMED
- PENDING_PAYMENT -> RELEASED
- PENDING_PAYMENT -> CANCELLED

## 11. Entradas
- slotId
- type (`SINGLE` ou `RECURRING`)
- regra de recorrência, quando aplicável
- usuário autenticado como organizador
- dados auxiliares para pagamento mínimo, quando aplicável

## 12. Saídas
- reserva criada
- status atual da reserva
- código da reserva
- dados do slot vinculado
- dados de recorrência, quando existir
- confirmação ou cancelamento da reserva

## 13. Validações
- usuário autenticado
- slot existente
- slot com status compatível
- slot não sobreposto por outra reserva confirmada
- organizador válido
- recorrência permitida pela arena e pelo slot
- antecedência mínima respeitada
- valores monetários coerentes
- `requiredPaymentAmount` compatível com a política da arena
- tipo da reserva válido

## 14. Regras de concorrência
1. A criação da reserva deve impedir dupla ocupação do mesmo slot.
2. O sistema deve evitar condição de corrida entre dois organizadores tentando reservar o mesmo horário.
3. A transição do slot para estado de indisponibilidade deve ser segura.
4. Ocorrências recorrentes futuras devem ser controladas sem permitir conflito de agenda.
5. O fluxo financeiro não pode confirmar a mesma reserva mais de uma vez.

## 15. Regras de persistência
- criar `Reservation`
- atualizar status do `ArenaSlot` quando apropriado
- criar `ReservationRecurrence` quando aplicável
- criar `ReservationOccurrence` quando aplicável
- atualizar `paidAmount`
- atualizar `confirmedAt`
- atualizar `cancelledAt`
- liberar o slot quando reserva expirar ou for cancelada, conforme a regra do fluxo

## 16. Regras de cache
- disponibilidade de slots pode ser cacheada em leitura
- qualquer criação, confirmação, cancelamento ou liberação de reserva deve invalidar o cache relacionado aos slots afetados
- dados de reserva não devem depender apenas de cache para consistência

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 slot ou reserva não encontrado
- 409 conflito de disponibilidade
- 422 regra de domínio inválida
- 500 falha operacional

## 18. Critérios de aceite
- [ ] Organizador consegue criar reserva para slot disponível
- [ ] Sistema impede reserva de slot já indisponível
- [ ] Arena consegue visualizar reservas dos próprios slots
- [ ] Reserva recorrente só é permitida quando a arena permitir
- [ ] Sistema respeita antecedência mínima da arena
- [ ] Reserva confirmada pode ser usada futuramente para criação de evento
- [ ] Ocorrência recorrente não paga pode ser liberada automaticamente conforme a regra
- [ ] Usuário sem permissão não consegue operar reserva de outro organizador

## 19. Fora do escopo
- checkout financeiro completo do aluguel
- split financeiro da arena
- contrato jurídico da reserva
- aprovação manual complexa da arena
- sincronização com sistemas externos da arena
- calendário visual avançado