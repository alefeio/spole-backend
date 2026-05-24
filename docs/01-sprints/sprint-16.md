# Sprint 16 — Organizer Event Operations Read Model

## 1. Objetivo da sprint
Entregar um **read model operacional** para o organizador (e admin) acompanhar bookings, payments e indicadores básicos de ocupação/financeiro **de um evento próprio**, sem usar `/admin/*`.

## 2. Problema que esta sprint resolve
Após as Sprints 13 e 15, o organizador já lista e edita eventos e vê participantes gratuitos (`GET /events/:eventId/participants`), mas **não há endpoints de domínio** para:

- listar bookings do evento
- listar payments do evento
- obter resumo de ocupação e receita básica

Hoje o front dependeria de `/admin/bookings?eventId=...` e `/admin/payments?...`, indevido para organizador comum.

## 3. Escopo

### Inclui
- **`GET /events/:eventId/bookings`** — JWT; organizador do evento ou admin; paginação; filtro `status`; ordenação
- **`GET /events/:eventId/payments`** — JWT; organizador ou admin; paginação; filtro `status`; ordenação; apenas payments vinculados a bookings do evento
- **`GET /events/:eventId/summary`** — JWT; organizador ou admin; métricas agregadas de ocupação e financeiro básico
- Helper compartilhado de autorização (ownership do evento)
- Testes de integração
- Documentação (`events.md`, `bookings.md`, `payments.md`, `README.md`)

### Não inclui
- Gateway real, refunds, split, check-in, presença
- Relatórios avançados, dashboard admin, webhooks novos
- Alterações no frontend
- Mudança de regras financeiras existentes
- Listagem de dados do comprador além de `userId` (sem e-mail/telefone nesta sprint)
- Payments de reserva de arena (`reservation_id` / `reservation_occurrence_id`)

## 4. Endpoints

### `GET /events/:eventId/bookings`
**Auth:** JWT — roles `user`, `arena_owner`, `admin`  
**Acesso:** organizador do evento ou admin; outro usuário → **403**; evento inexistente → **404**

**Query:** `page`, `limit`, `status` (`RESERVED` | `EXPIRED` | `CANCELLED` | `COMPLETED`), `sort` (`reservedAt` | `createdAt`), `order` (default `reservedAt` desc)

**Item:** `id`, `userId`, `status`, `reservedAt`, `expiresAt`, `purchaseCompletedAt`

Antes da listagem/contagem: promover bookings expirados (`expireStaleBookings` por `eventId`).

### `GET /events/:eventId/payments`
**Auth:** idem

**Query:** `page`, `limit`, `status` (`PENDING` | `PAID` | `FAILED` | `CANCELLED`), `sort` (`createdAt` | `paidAt`), `order` (default `createdAt` desc)

**Item:** `id`, `bookingId`, `status`, `grossAmount`, `feeAmount`, `netAmount`, `method`, `provider`, `providerReference`, `paidAt`

Escopo: `payments` com `booking_id` cujo booking pertence ao `eventId`.

### `GET /events/:eventId/summary`
**Auth:** idem

**Resposta (exemplo):**
```json
{
  "eventId": "uuid",
  "capacity": 20,
  "confirmedParticipants": 12,
  "activeBookings": 1,
  "completedBookings": 8,
  "cancelledBookings": 2,
  "expiredBookings": 3,
  "paidPaymentsCount": 8,
  "pendingPaymentsCount": 1,
  "grossRevenue": 320,
  "netRevenue": 288,
  "remainingSpots": 7
}
```

**Regras de cálculo:**
- `confirmedParticipants`: `event_participants` com `status = CONFIRMED`
- Bookings por status no evento (após lazy expire)
- Payments: contagem e soma apenas via join `payments → bookings → event_id`; receita só de `PAID`
- `remainingSpots`: `capacity - countUsedSpots` (participantes confirmados + bookings `RESERVED`, mesma regra de vaga do domínio)

## 5. Autorização
- Reutilizar padrão de `listEventParticipants`: `loadEvent` → 404; se `auth.role !== admin` e `auth.id !== organizer_id` → 403
- Sem token → 401 (`requireAuth`)

## 6. Módulos afetados
- `src/modules/events/` — summary, helper de acesso, rota summary
- `src/modules/bookings/` — listagem por evento, rota GET
- `src/modules/payments/` — listagem por evento, rota GET
- `test/sprint16.organizer-event-operations.integration.test.ts`
- docs + README

## 7. Critérios de aceite
- [x] Organizador acessa bookings/payments/summary do próprio evento
- [x] Organizador não acessa evento alheio (403)
- [x] Admin acessa qualquer evento
- [x] Sem JWT → 401
- [x] Paginação e filtros de status funcionam
- [x] Summary com números coerentes
- [x] Payload sem dados sensíveis desnecessários (sem e-mail/telefone do comprador)
- [x] `/admin/*` e fluxos existentes intactos
- [x] Testes passam; documentação atualizada

## 8. Fora de escopo / sprint futura
- Export CSV, gráficos, ranking, antifraude
- Nome/e-mail do participante na listagem (opt-in futuro com LGPD)
- Summary em tempo real com cache
