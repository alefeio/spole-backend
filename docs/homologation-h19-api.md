# Homologação H-19 — API (backend)

Guia para preparar a API e validar o fluxo **Pix real (Asaas)** usado pelo frontend na homologação H-19.

> O seed **não** cria cobranças Asaas. Pagamentos reais são criados apenas pelo fluxo normal (`POST .../payments` + webhook).

## Pré-requisitos

1. Postgres e Redis acessíveis (ex.: `docker compose up -d`).
2. Seed aplicado: `npm run db:seed:dev`.
3. API rodando com código atual (ex.: `docker compose up -d --build api` ou `npm run dev`).
4. Conta **sandbox** Asaas com API key e webhook configurados.

## Variáveis de ambiente (API)

| Variável | Homologação Pix real | Dev mock (sem Asaas) |
| --- | --- | --- |
| `PAYMENTS_PROVIDER` | `asaas` | `mock` (default) |
| `PAYMENTS_ENV` | `sandbox` | `sandbox` |
| `ASAAS_API_KEY` | chave sandbox | vazio |
| `ASAAS_WEBHOOK_ACCESS_TOKEN` | token do painel Asaas | vazio |
| `ASAAS_DEFAULT_CUSTOMER_ID` | id de cliente sandbox | vazio |
| `PAYMENTS_WEBHOOK_SECRET` | obrigatório | `dev-webhook-secret` (mock legado) |

Copie de `.env.example` e **nunca** commite credenciais reais.

## Webhooks Asaas

Configure no painel Asaas (sandbox) duas URLs públicas (via ngrok ou Cloudflare Tunnel):

| Rota | Domínio |
| --- | --- |
| Booking (evento pago) | `POST https://<seu-tunel>/payments/webhook` |
| Reserva / ocorrência | `POST https://<seu-tunel>/reservation-payments/webhook` |

Header esperado pelo adapter Asaas: `asaas-access-token: <ASAAS_WEBHOOK_ACCESS_TOKEN>`.

### Modo mock (sem Asaas)

Simule confirmação manual:

```bash
curl -X POST http://localhost:3000/payments/webhook \
  -H "Content-Type: application/json" \
  -H "X-Spole-Payment-Webhook-Secret: <PAYMENTS_WEBHOOK_SECRET>" \
  -d '{"providerReference":"<id retornado no POST payment>","status":"PAID"}'
```

Status suportados no mock: `PAID`, `FAILED`, `CANCELLED`.

## Túnel e CORS

1. Exponha a API: `ngrok http 3000` (ou Cloudflare Tunnel).
2. Em **desenvolvimento**, a API aceita origens:
   - `http://localhost:*` / `127.0.0.1`
   - `https://*.ngrok-free.app`
   - `https://*.trycloudflare.com`
3. O frontend deve apontar `NEXT_PUBLIC_API_URL` (ou equivalente) para a URL pública da API.

Se o frontend também estiver em túnel, a origem do browser será o domínio do túnel do **front** — já coberto pelos padrões acima quando for ngrok/trycloudflare.

## Roteiro H-19 (dados do seed)

### 1. Evento pago — Pix real

| Campo | Valor |
| --- | --- |
| Organizador | `org1@spole.dev` |
| Participante | `user1@spole.dev` |
| Evento | **Torneio Spolê Pago** |
| Preço | R$ 40 / vaga |
| Capacidade | 20 (user2 já confirmado via mock — user1 livre) |

Fluxo: login `user1` → booking no evento → `POST /bookings/:id/payments` → exibir QR/copia-e-cola → polling `GET /payments/:id` → webhook Asaas `PAID`.

### 2. Reserva de arena paga — Pix real

| Campo | Valor |
| --- | --- |
| Organizador | `org1@spole.dev` |
| Arena | **Arena Spolê Central** |
| Slot | amanhã ~20:00 (`h19CentralPaid` no seed) |
| Política | 100% do valor (pagamento obrigatório) |

Fluxo: login `org1` → `POST /reservations` no slot disponível → `POST /reservations/:id/payments` → Pix → webhook em `/reservation-payments/webhook`.

### 3. Arena sem pagamento

| Campo | Valor |
| --- | --- |
| Arena | **Arena Spolê Norte** (`min_reservation_payment_percent = 0`) |
| Organizador | `org2@spole.dev` |

Reserva confirma sem `Payment` (já há exemplo seed `norteConfirmed`).

### 4. Operação do organizador

Login `org1@spole.dev` → evento **Torneio Spolê Pago**:

- `GET /events/:eventId/summary`
- `GET /events/:eventId/bookings`
- `GET /events/:eventId/payments`

### 5. Catálogo público

`GET /arenas?city=Belém&q=beach` → **Arena Beach Spolê**  
`GET /arenas?city=Ananindeua` → **Arena Vôlei Pará**  
Arena **INACTIVE** não aparece no catálogo público.

## Testar FAILED / CANCELLED

No **sandbox Asaas**, use os eventos de teste do painel ou simule via webhook **mock** com o `providerReference` da cobrança criada pelo frontend:

```json
{ "providerReference": "<id>", "status": "FAILED" }
```

Pagamento expirado no domínio de **booking**: reduza `BOOKING_TTL_SECONDS` e aguarde expiração antes do webhook `PAID` (ver teste sprint07).

## O que é mock vs real

| Origem | `providerReference` | Uso |
| --- | --- | --- |
| Seed | `seed-dev-mock-*` | Listagens, summary, regressão — **não** usar na H-19 |
| Frontend + `PAYMENTS_PROVIDER=asaas` | id Asaas | **Fluxo H-19** |
| Frontend + `mock` | UUID local | Dev/CI sem gateway |
