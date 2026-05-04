# Feature Spec — Bookings

## Sprint 06 — recorte na API atual

- Criação de booking em evento **pago** persiste **somente** a linha em `bookings` (sem `EventParticipant` no momento do booking); o participante confirmado fica para a sprint de **payments**.
- **Redis**: chave `spole:booking:{id}` com TTL configurável (`BOOKING_TTL_SECONDS`, padrão **1800** = 30 min); **Postgres** guarda `expires_at`.
- **Expiração**: promoção lazy de `RESERVED` → `EXPIRED` quando `expires_at <= now()` em fluxos que contam vagas ou listam bookings; chave Redis removida ao expirar ou cancelar.

## Sprint 07 — recorte na API atual

- Após pagamento aprovado (webhook), o booking vai para **`COMPLETED`**, com `purchase_completed_at` preenchido; a chave Redis do booking é removida e o booking deixa de contar como reserva ativa (`RESERVED`).
- É criado um **`EventParticipant`** com status **`CONFIRMED`**; não há novo booking para o mesmo evento se o usuário já for participante confirmado.
- Estados de booking na API: `RESERVED`, `EXPIRED`, `CANCELLED`, `COMPLETED`.

## 1. Resumo
Gestão da reserva temporária de vagas ou ingressos em eventos pagos, garantindo bloqueio por tempo limitado, prevenção de dupla compra e confirmação definitiva após pagamento aprovado.

## 2. Objetivo
Garantir consistência no fluxo de compra de eventos pagos, evitando que duas pessoas consigam comprar a mesma vaga ao mesmo tempo e liberando automaticamente a vaga caso o pagamento não seja concluído dentro do prazo.

## 3. Atores envolvidos
- Participante
- Organizador
- Administrador
- Sistema de pagamento
- Redis

## 4. Regras de negócio
1. Toda compra de evento pago deve passar por uma reserva temporária antes da confirmação final.
2. A reserva temporária deve ter TTL oficial de 30 minutos.
3. Enquanto a reserva estiver ativa, a vaga fica indisponível para outros usuários.
4. Se o pagamento não for concluído dentro do TTL, a reserva expira automaticamente.
5. Quando o pagamento for confirmado, a reserva deve ser concluída e a vaga deve ficar definitivamente indisponível.
6. Uma reserva temporária só pode existir se ainda houver capacidade disponível no evento.
7. O sistema deve impedir dupla compra sob concorrência.
8. Eventos gratuitos não usam o fluxo de booking temporário.
9. O booking deve estar associado a um usuário, a um evento e, quando aplicável, a um participante do evento.
10. O PostgreSQL continua sendo a fonte de verdade final, mas o controle temporário de expiração deve usar Redis.
11. O sistema deve registrar o estado da reserva temporária para auditoria mínima e troubleshooting.
12. Apenas bookings em estado apropriado podem virar compra concluída.

## 5. Fluxo principal
1. Participante inicia a compra de uma vaga em evento pago.
2. Sistema valida se o evento está publicado e se ainda possui capacidade disponível.
3. Sistema cria um booking temporário.
4. Sistema grava a reserva temporária em Redis com TTL de 30 minutos.
5. A vaga fica bloqueada para outros usuários.
6. Participante segue para pagamento.
7. Se o pagamento for aprovado dentro do TTL:
   - booking vira `COMPLETED`
   - inscrição do participante vira `CONFIRMED`
   - vaga é considerada vendida
8. Se o TTL expirar sem pagamento:
   - booking vira `EXPIRED`
   - vaga volta à disponibilidade

## 6. Fluxos alternativos

### 6.1 Usuário tenta comprar novamente com booking ainda ativo
O sistema pode impedir nova reserva e orientar o usuário a concluir a compra pendente ou aguardar a expiração.

### 6.2 Booking cancelado manualmente
Se houver cancelamento explícito antes do pagamento, o booking pode ir para `CANCELLED` e a vaga volta à disponibilidade antes do TTL expirar.

### 6.3 Confirmação de pagamento no limite do TTL
O sistema deve tratar idempotência e priorizar o status final confirmado quando houver prova válida de pagamento recebido dentro do fluxo esperado.

## 7. Fluxos de exceção

### 7.1 Evento sem vagas disponíveis
- condição: capacidade esgotada
- resultado esperado: erro 409

### 7.2 Evento não permite compra
- condição: evento não publicado, cancelado, finalizado ou gratuito
- resultado esperado: erro 422

### 7.3 Booking já expirado
- condição: usuário tenta pagar booking com TTL expirado
- resultado esperado: erro 409 ou 422

### 7.4 Booking não pertence ao usuário
- condição: usuário tenta consultar ou concluir booking de outro usuário
- resultado esperado: erro 403

### 7.5 Redis indisponível
- condição: falha ao criar reserva temporária
- resultado esperado: erro operacional, sem confirmar vaga indevidamente

## 8. Entidades envolvidas
- Event
- EventParticipant
- Booking
- Payment
- Redis

## 9. Campos relevantes

### Event
- id
- organizerId
- status
- type
- capacity
- pricePerPerson
- startAt
- endAt

### EventParticipant
- id
- eventId
- userId
- status
- amountDue
- amountPaid
- subscribedAt
- cancelledAt
- checkedInAt

### Booking
- id
- eventId
- userId
- eventParticipantId
- status
- reservedAt
- expiresAt
- purchaseCompletedAt
- redisKey

## 10. Estado e transições

### Booking status
- RESERVED
- EXPIRED
- COMPLETED
- CANCELLED

### Transições válidas
- RESERVED -> COMPLETED
- RESERVED -> EXPIRED
- RESERVED -> CANCELLED

### EventParticipant status relacionado
- PENDING_PAYMENT
- RESERVED
- CONFIRMED
- CANCELLED
- REFUNDED
- NO_SHOW

### Transições principais do participante
- PENDING_PAYMENT -> RESERVED
- RESERVED -> CONFIRMED
- RESERVED -> CANCELLED
- RESERVED -> REFUNDED

## 11. Entradas
- eventId
- userId autenticado

## 12. Saídas
- booking criado
- tempo de expiração
- status do booking
- status da inscrição vinculada
- indicação de que a vaga está reservada temporariamente

## 13. Validações
- usuário autenticado
- evento existente
- evento do tipo `PAID`
- evento com status compatível com compra
- capacidade disponível
- usuário não pode ter compra confirmada duplicada no mesmo evento
- booking deve pertencer ao usuário autenticado
- booking deve estar em estado compatível para conclusão

## 14. Regras de concorrência
1. O momento de criação do booking é crítico e deve evitar overbooking.
2. A verificação de disponibilidade e a criação da reserva temporária devem ser tratadas de forma segura.
3. Redis deve ser usado para marcar a reserva temporária com TTL.
4. O sistema deve evitar que dois usuários reservem a mesma última vaga simultaneamente.
5. A conclusão do pagamento deve ser idempotente.
6. Se o webhook de pagamento chegar mais de uma vez, a compra não pode ser duplicada.
7. A contagem de vagas disponíveis deve considerar bookings ativos e inscrições confirmadas, conforme a estratégia implementada.

## 15. Regras de persistência
- criar registro de booking
- criar ou atualizar `EventParticipant` em estado inicial compatível
- persistir `expiresAt`
- atualizar booking para `COMPLETED`, `EXPIRED` ou `CANCELLED`
- atualizar participante para `CONFIRMED` quando houver pagamento aprovado
- liberar a vaga em caso de expiração ou cancelamento
- registrar ligação entre booking e payment quando aplicável

## 16. Regras de cache
- bookings não devem depender apenas de cache para consistência
- Redis aqui tem papel de controle transacional temporário, não somente cache
- qualquer expiração deve refletir corretamente no estado persistido quando houver sincronização do fluxo

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 evento ou booking não encontrado
- 409 conflito de disponibilidade
- 422 evento incompatível com compra
- 500 falha operacional de reserva temporária

## 18. Critérios de aceite
- [ ] Participante consegue iniciar booking em evento pago com vaga disponível
- [ ] Sistema cria reserva temporária com TTL de 30 minutos
- [ ] Booking ativo bloqueia a vaga para outros usuários
- [ ] Sistema impede dupla compra da mesma vaga sob concorrência
- [ ] Booking expira automaticamente quando o pagamento não é concluído no prazo
- [ ] Após expiração, a vaga volta à disponibilidade
- [ ] Após pagamento aprovado, booking vira `COMPLETED`
- [ ] Após pagamento aprovado, participante vira `CONFIRMED`
- [ ] Pagamento confirmado não pode gerar compra duplicada no mesmo booking

## 19. Fora do escopo
- checkout completo do gateway de pagamento
- split financeiro avançado
- antifraude avançado
- fila de espera
- seleção de assento numerado
- remarcação complexa de booking