# Feature Spec — Payments

## 1. Resumo
Gestão do pagamento de reservas e compras no Spolê, incluindo criação de intenção de pagamento, acompanhamento de status, confirmação por integração externa e atualização dos estados do domínio após aprovação.

## 2. Objetivo
Permitir que o sistema registre, acompanhe e confirme pagamentos de forma segura, conectando a transação financeira às regras de negócio de reserva de vaga, compra de ingresso e, futuramente, reserva de horários em arena.

## 3. Atores envolvidos
- Participante
- Organizador
- Administrador
- Gateway de pagamento
- Sistema

## 4. Regras de negócio
1. Todo pagamento deve estar vinculado a um contexto de negócio válido.
2. No MVP, o principal contexto de pagamento é a compra de vaga ou ingresso em evento pago.
3. Futuramente, pagamentos também poderão ser usados para reserva de slots de arena, mas essa evolução deve respeitar a sprint correspondente.
4. Um pagamento pode nascer como `PENDING`.
5. Um pagamento só pode gerar confirmação definitiva de compra quando for marcado como `PAID`.
6. O status financeiro deve ser independente, mas sincronizado com o status do domínio.
7. Quando o pagamento de um booking for aprovado:
   - o booking deve ser concluído
   - o participante deve ser confirmado
   - a vaga deve ficar indisponível
8. Se o pagamento falhar, for cancelado ou expirar, o fluxo deve refletir isso no domínio.
9. A plataforma deve registrar valor bruto, taxa e valor líquido.
10. O sistema deve suportar confirmação por webhook.
11. O processamento da confirmação deve ser idempotente.
12. O sistema deve permitir rastrear o identificador da transação no provedor externo.
13. Reembolsos não precisam estar completos no MVP, mas a estrutura deve prever esse estado.

## 5. Fluxo principal
1. Usuário inicia uma compra.
2. Sistema cria ou recebe um booking válido.
3. Sistema cria um registro de pagamento em estado `PENDING`.
4. Sistema chama o gateway de pagamento.
5. Gateway retorna dados da transação.
6. Usuário conclui a ação de pagamento fora ou dentro do checkout integrado.
7. Gateway notifica a API por webhook ou confirmação equivalente.
8. Sistema valida a notificação.
9. Sistema marca o pagamento como `PAID`.
10. Sistema atualiza os estados relacionados do domínio.

## 6. Fluxos alternativos

### 6.1 Pagamento falha
O gateway informa falha ou rejeição, e o pagamento vai para `FAILED`.

### 6.2 Pagamento cancelado
O usuário ou o gateway cancela a transação, e o pagamento vai para `CANCELLED`.

### 6.3 Pagamento estornado
Em fluxo futuro, o pagamento pode ir para `REFUNDED`.

### 6.4 Reprocessamento de webhook
Se o mesmo webhook chegar duas ou mais vezes, o sistema não pode duplicar efeitos no domínio.

## 7. Fluxos de exceção

### 7.1 Booking inexistente
- condição: pagamento tenta ser criado para booking inválido
- resultado esperado: erro 404

### 7.2 Booking expirado
- condição: pagamento tenta concluir booking já expirado
- resultado esperado: erro 409 ou 422

### 7.3 Valor inconsistente
- condição: valor pago não bate com o valor esperado da compra
- resultado esperado: erro operacional e bloqueio da confirmação automática

### 7.4 Webhook inválido
- condição: assinatura inválida ou payload inconsistente
- resultado esperado: rejeição do webhook

### 7.5 Pagamento já processado
- condição: webhook repetido ou confirmação duplicada
- resultado esperado: operação idempotente sem duplicar confirmação

## 8. Entidades envolvidas
- Payment
- Booking
- EventParticipant
- Event
- Reservation (futuro)
- GatewayTransaction ou metadado equivalente, se adotado

## 9. Campos relevantes

### Payment
- id
- userId
- reservationId
- eventParticipantId
- bookingId
- type
- method
- provider
- providerReference
- grossAmount
- feeAmount
- netAmount
- status
- paidAt
- refundedAt
- createdAt
- updatedAt

### Booking
- id
- eventId
- userId
- status
- reservedAt
- expiresAt
- purchaseCompletedAt

### EventParticipant
- id
- eventId
- userId
- status
- amountDue
- amountPaid

## 10. Estado e transições

### Payment status
- PENDING
- PAID
- FAILED
- REFUNDED
- CANCELLED

### Transições válidas
- PENDING -> PAID
- PENDING -> FAILED
- PENDING -> CANCELLED
- PAID -> REFUNDED

### Relações com o domínio
- `Payment.PAID` pode levar `Booking` a `COMPLETED`
- `Payment.PAID` pode levar `EventParticipant` a `CONFIRMED`
- `Payment.FAILED` não confirma compra
- `Payment.CANCELLED` não confirma compra
- `Payment.REFUNDED` exige regra futura de reversão, quando aplicável

## 11. Entradas
- bookingId ou contexto equivalente
- método de pagamento
- usuário autenticado
- dados retornados pelo gateway
- payload do webhook

## 12. Saídas
- pagamento criado
- status do pagamento
- dados de transação
- confirmação da compra, quando aplicável
- erro padronizado em falhas

## 13. Validações
- booking existente
- booking pertence ao usuário autenticado, quando a ação for iniciada pelo cliente
- booking em estado válido para pagamento
- evento compatível com pagamento
- valor esperado válido
- provider e method suportados
- webhook autenticado
- providerReference único quando necessário

## 14. Regras de concorrência
1. A confirmação do pagamento deve ser idempotente.
2. O sistema não pode confirmar a mesma compra duas vezes.
3. Webhooks repetidos não podem duplicar atualização de booking ou participante.
4. Pagamento de booking expirado deve ser tratado com cuidado operacional.
5. A atualização de status financeiro e status de domínio deve ocorrer de forma segura.

## 15. Regras de persistência
- criar `Payment` em estado `PENDING`
- atualizar `providerReference`
- atualizar `status`
- registrar `paidAt` quando aprovado
- registrar `refundedAt` quando houver estorno
- atualizar entidades relacionadas do domínio quando aplicável
- manter histórico mínimo auditável

## 16. Regras de cache
- pagamentos não devem depender de cache para consistência
- estados financeiros devem ser sempre baseados em persistência confiável
- se algum cache de leitura for usado, ele deve ser invalidado após confirmação ou falha relevante

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 recurso não encontrado
- 409 conflito de estado
- 422 regra de domínio inválida
- 500 falha de integração ou processamento

## Recorte da API (Sprints 07–10)

- O webhook de confirmação de **booking** (`POST /payments/webhook`, header `X-Spole-Payment-Webhook-Secret`) trata apenas **`status: PAID`** para concluir compra de vaga.
- O webhook de **reserva de arena** (`POST /reservation-payments/webhook`, header `X-Spole-Reservation-Payment-Webhook-Secret`) é separado e idempotente.
- `Payment` é polimórfico: exatamente um entre `bookingId`, `reservationId` ou `reservationOccurrenceId`.
- `GET /users/me/payments` é paginado (Sprint 09).

## 18. Critérios de aceite
- [ ] Sistema consegue criar um pagamento `PENDING` para um booking válido
- [ ] Sistema registra identificador da transação do gateway
- [ ] Webhook válido consegue atualizar pagamento para `PAID`
- [ ] Pagamento `PAID` conclui o booking relacionado
- [ ] Pagamento `PAID` confirma o participante relacionado
- [ ] Pagamento com falha não confirma compra
- [ ] Webhook repetido não duplica efeitos
- [ ] Valor bruto, taxa e valor líquido ficam registrados

## 19. Fora do escopo
- split financeiro avançado
- repasse automático para organizador
- repasse para arena
- conciliação financeira avançada
- chargeback completo
- antifraude avançado
- múltiplos gateways simultâneos
- parcelamento complexo