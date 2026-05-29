# Sprint 17 — Real Payments Core

## 1. Objetivo da sprint
Substituir o **fluxo mock** de pagamentos (UUID local + webhook manual com `status: PAID`) por um **núcleo real** com provedor PIX, mantendo os três contextos já existentes:

- booking de evento pago
- reservation de arena
- reservation occurrence (recorrência)

Sem quebrar regras de domínio, idempotência de cliente (Sprint 12) nem read models (Sprint 16).

## 2. Problema que esta sprint resolve
Hoje o frontend consegue criar `Payment` `PENDING`, mas:

- `providerReference` é `randomUUID()` gerado na API, não ID do gateway
- não há QR/copia-e-cola Pix real
- webhooks aceitam apenas payload simplificado `{ providerReference, status: PAID }` com segredo estático
- `provider` válido é só `mock-provider`
- status `FAILED` / `CANCELLED` não chegam via webhook real

O produto não fecha ponta a ponta até existir cobrança real + confirmação assíncrona confiável.

## 3. Decisão de provedor (recomendação para aprovação)

**Um único gateway real na sprint:** provedor PIX brasileiro com sandbox (recomendação técnica: **Asaas** — Pix, cobrança, webhook, ambiente sandbox documentado).

- `PAYMENTS_PROVIDER=mock` — comportamento atual (testes locais/CI)
- `PAYMENTS_PROVIDER=asaas` — cobrança real

Não implementar múltiplos gateways simultâneos nesta sprint.

## 4. Escopo

### Inclui

#### 4.1 Camada de provedor
- Interface `PaymentProvider` (criar cobrança, parsear webhook, validar assinatura)
- Implementação `MockPaymentProvider` (paridade com hoje)
- Implementação `AsaasPaymentProvider` (sandbox + produção via env)

#### 4.2 Criação de pagamento (rotas mantidas)
- `POST /bookings/:bookingId/payments`
- `POST /reservations/:reservationId/payments`
- `POST /reservation-occurrences/:occurrenceId/payments`

**Resposta enriquecida (aditiva):**
- campos atuais preservados (`id`, `status`, `method`, `provider`, `providerReference`, valores)
- novo bloco `checkout` (quando `PENDING` + PIX):
  - `pixCopyPaste` (string)
  - `pixQrCode` (base64 ou URL, conforme provedor)
  - `paymentExpiresAt` (expiração da cobrança no gateway, se houver)
- `contextExpiresAt` — `booking.expiresAt` ou `reservation.expiresAt` / `occurrence.dueAt` (prazo do domínio)

`providerReference` passa a ser o **ID da cobrança no gateway** (único global).

#### 4.3 Webhooks reais
- `POST /payments/webhook` — booking (manter rota; evoluir validação)
- `POST /reservation-payments/webhook` — reservation + occurrence (manter rota)

Evoluções:
- validar assinatura/token do provedor (substituir ou complementar segredo estático em produção)
- mapear status do provedor → `PAID` | `FAILED` | `CANCELLED`
- idempotência: reprocessar mesmo evento sem duplicar efeito de domínio
- `PAID` mantém efeitos atuais (booking `COMPLETED` + participant; reservation/occurrence confirmados)

#### 4.4 Consulta para polling
- `GET /payments/:id` — incluir `checkout` enquanto `PENDING`; útil se webhook atrasar

#### 4.5 Ambientes e configuração
- sandbox vs produção via env (`PAYMENTS_ENV=sandbox|production` ou URL base do provedor)
- chaves e segredos só em variáveis de ambiente (`.env.example` atualizado)
- Docker compose com defaults de dev; produção sem secrets no repositório

#### 4.6 Compatibilidade
- Domínio booking/reservation/occurrence inalterado nas transições finais
- Idempotency-Key nos POST de criação (Sprint 12) preservada
- Organizer event operations (Sprint 16) intacto
- Testes de regressão das sprints 07, 10, 12, 16

### Não inclui
- split, refunds, repasse automático
- antifraude, conciliação avançada, BI
- múltiplos gateways reais
- alterações no frontend
- check-in, novos read models

## 5. Variáveis de ambiente (implementado)

| Variável | Uso | Default |
| --- | --- | --- |
| `PAYMENTS_PROVIDER` | `mock` \| `asaas` | `mock` |
| `PAYMENTS_ENV` | `sandbox` \| `production` | `sandbox` |
| `ASAAS_API_KEY` | API key do ambiente ativo (obrigatória se `asaas`) | — |
| `ASAAS_WEBHOOK_ACCESS_TOKEN` | Token esperado no header `asaas-access-token` do webhook | — |
| `ASAAS_DEFAULT_CUSTOMER_ID` | Cliente Asaas usado como pagador das cobranças (necessário no modo `asaas`) | — |
| `PAYMENTS_WEBHOOK_SECRET` | Segredo do webhook mock/legado (header `X-Spole-*-Webhook-Secret`) | — |

## 6. Contrato para o frontend (resumo)

1. **Criar pagamento** — mesmo POST; body pode enviar `{ "method": "PIX" }` e omitir `provider` (default do env) ou `"provider": "asaas"`.
2. **Exibir Pix** — usar `checkout.pixCopyPaste` / `checkout.pixQrCode`.
3. **Contagem regressiva** — usar `contextExpiresAt` (booking/reserva) e, se existir, `checkout.paymentExpiresAt`.
4. **Status** — `PENDING` → aguardar; `PAID` → sucesso (polling em `GET /payments/:id` ou redirect pós-webhook); `FAILED` / `CANCELLED` → erro/cancelado.
5. **Não** chamar webhook manualmente no fluxo de produção; só sandbox/dev com ferramentas do provedor.

## 7. Critérios de aceite
- [x] Camada de provedor Pix abstrata (`PaymentProvider`) com adapters `mock` e `asaas` para os 3 contextos
- [x] Resposta de criação traz `checkout` (Pix) + `providerReference` + `contextExpiresAt`
- [x] Webhook válido confirma pagamento e aplica efeitos de domínio (`PAID`)
- [x] Webhook inválido rejeitado (403)
- [x] Webhook repetido é idempotente
- [x] Status `FAILED` e `CANCELLED` suportados via webhook
- [x] Validação de valor confirmado pelo provedor (quando informado)
- [x] Modo `mock` continua funcionando em CI (default)
- [x] Regressão: bookings, reservations, occurrences, organizer read model (sprints 07/10/12/16 verdes)
- [x] Documentação atualizada para o frontend
- [ ] Cobrança real validada no sandbox Asaas — **manual** (atrás de credenciais reais; fora do CI)

## 8. Implementação (resumo técnico)

### Persistência
- Migration `015_payment_checkout.sql`: colunas `checkout_pix_copy_paste`, `checkout_pix_qr_code`, `checkout_expires_at` e `context_expires_at` em `payments` (snapshot para polling sem nova chamada ao gateway).

### Camada de provedor
- `src/modules/payments/providers/types.ts` — `PaymentProvider`, `CreateChargeInput/Result`, `PixCheckout`, `WebhookEvent`, `WebhookParseResult`.
- `mock-provider.ts` — `providerReference` UUID local + checkout Pix simulado; webhook legado `{ providerReference, status }` validado pelo header `X-Spole-*-Webhook-Secret`.
- `asaas-provider.ts` — cria cobrança Pix (`/payments` + `/payments/{id}/pixQrCode`); webhook validado pelo header `asaas-access-token`; `providerReference` = id real da cobrança.
- `index.ts` — `getPaymentProvider(env)` resolve provedor por env (cacheado).

### Webhook (parser por provedor)
- Rotas mantidas por domínio: `POST /payments/webhook` e `POST /reservation-payments/webhook`.
- `provider.verifyAndParseWebhook(...)` retorna: `forbidden` (403) | `invalid` (400) | `unsupported_status` (422) | `ignore` (200, evento irrelevante) | `apply` (aplica ao domínio).
- Mapeamento Asaas: `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` → `PAID`; `PAYMENT_OVERDUE` → `FAILED`; `PAYMENT_DELETED` → `CANCELLED`; demais → ignorado.
- `FAILED`/`CANCELLED` marcam o `Payment` (sem rebaixar pagamentos já `PAID`); não alteram o domínio (booking/reserva seguem o TTL existente).
- Asaas autentica por access token no header (não exige HMAC sobre raw body), então o parsing JSON global é suficiente.

## 9. Fora de escopo / sprint futura
- Repasse split para organizador/arena
- Estorno/refund automatizado
- Cartão de crédito / boleto além de Pix
- Múltiplos gateways reais simultâneos
