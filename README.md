# Spolê — API

API REST do Spolê, seguindo abordagem **API-first** e **arquitetura modular por domínio** (monólito modular).

## Objetivo deste repositório

Esta base foi preparada para evolução disciplinada sprint a sprint, sem antecipar integrações ou regras de negócio fora do escopo de cada sprint.

## Como executar localmente

### Pré-requisitos

- Node.js (LTS recomendado)
- Docker (para PostgreSQL/Redis via compose)

### Instalação

```bash
npm install
```

### Subir o ambiente com um único comando (Docker)

```bash
docker compose up --build
```

API em `http://localhost:3000`.

### Rodar em modo desenvolvimento (sem Docker)

Esta opção exige PostgreSQL e Redis acessíveis conforme variáveis de ambiente (veja `.env.example`).

```bash
npm run dev
```

### Healthcheck

- `GET /health`

Resposta (padrão de sucesso):

```json
{
  "success": true,
  "data": { "status": "ok" }
}
```

## Autenticação (Sprint 02)

Endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `GET /users/me` (requer `Authorization: Bearer <token>`)

Variáveis JWT necessárias (veja `.env.example`):

- `JWT_SECRET`
- `JWT_ISSUER` (opcional)
- `JWT_AUDIENCE` (opcional)
- `JWT_EXPIRES_IN` (opcional)

**Pagamentos (Sprint 07):** `PAYMENTS_WEBHOOK_SECRET` é obrigatório. O endpoint `POST /payments/webhook` **não** usa JWT; valida o header `X-Spole-Payment-Webhook-Secret`.

**Pagamentos reais (Sprint 17):** abstração `PaymentProvider` com modos `PAYMENTS_PROVIDER=mock` (default em dev/testes/CI) e `PAYMENTS_PROVIDER=asaas` (cobrança Pix real). Envs: `PAYMENTS_PROVIDER`, `PAYMENTS_ENV` (`sandbox|production`), `ASAAS_API_KEY`, `ASAAS_WEBHOOK_ACCESS_TOKEN`, `ASAAS_DEFAULT_CUSTOMER_ID`. Os três POSTs de criação de pagamento (`/bookings/:id/payments`, `/reservations/:id/payments`, `/reservation-occurrences/:id/payments`) retornam, de forma aditiva, `providerReference` (id da cobrança no gateway no modo real), `contextExpiresAt` e o bloco `checkout` (`pixCopyPaste`, `pixQrCode`, `paymentExpiresAt`). `GET /payments/:id` expõe o `checkout` enquanto o pagamento está `PENDING` (polling). Os webhooks (`POST /payments/webhook` e `POST /reservation-payments/webhook`) suportam `PAID`/`FAILED`/`CANCELLED`, validam assinatura/token do provedor (mock: header de segredo; Asaas: `asaas-access-token`), validam o valor confirmado e são idempotentes. Contrato detalhado para o frontend em `docs/02-features/payments.md`.

**Cache público (Sprint 08):** `PUBLIC_READ_CACHE_TTL_SECONDS` (opcional, default 60) controla o TTL em Redis das respostas de `GET /events` e `GET /categories`. Se o Redis falhar, a API responde a partir do Postgres. A invalidação usa uma versão global de catálogo (`INCR` em Redis), sem `KEYS`.

**Notificações (Sprint 09):** internas e persistidas; `GET /users/me/notifications` (paginado) e `PATCH /notifications/:id/read`. Gatilhos atuais: pagamento aprovado e cancelamento de booking pelo próprio usuário.

**Listagens autenticadas paginadas:** `GET /users/me/notifications`, `GET /users/me/bookings` e `GET /users/me/payments` aceitam `page` e `limit` (default 1 e 10) e retornam `meta` com `total`.

**Listagem sem paginação obrigatória (Sprint 09):** `GET /users/me/participants` permanece como array em `data`, sem `meta` — decisão documentada.

**Reservas de arena (Sprint 10):** nova reserva nasce `PENDING` com slot em `HOLD` e `expires_at` (Postgres, `RESERVATION_TTL_SECONDS`). Pagamento inicial: `POST /reservations/:reservationId/payments`; confirmação: `POST /reservation-payments/webhook` com header `X-Spole-Reservation-Payment-Webhook-Secret`. Ocorrência recorrente: `POST /reservation-occurrences/:occurrenceId/payments`. Se `min_reservation_payment_percent = 0`, a reserva confirma sem criar `Payment`. O webhook de booking (`POST /payments/webhook`) não processa pagamentos de reserva.

**Admin (Sprint 11):** rotas sob `/admin/*` exigem role `admin`. Listagens paginadas de usuários, arenas, eventos, reservas, bookings, payments e `audit-logs`. Mutações: status de usuário (`ACTIVE`/`SUSPENDED`/`INACTIVE`), arena (`ACTIVE`/`INACTIVE`), cancelamento de evento (`CANCELLED` via lógica existente). `SUSPENDED` e `INACTIVE` bloqueiam login e rotas autenticadas.

**Segurança operacional (Sprint 12):** toda resposta inclui `X-Request-Id` (reutiliza o header do cliente se válido; senão gera UUID). Logs incluem o mesmo identificador. Rate limiting com Redis nos endpoints prioritários (auth, `GET /events`, criação de booking/payments e webhooks com limite permissivo). Se o Redis falhar no rate limit, a API segue (**fail-open** com log). Endpoints críticos de criação aceitam `Idempotency-Key` **opcional**; replay devolve a mesma resposta persistida; chave reutilizada com payload diferente → `409 IDEMPOTENCY_KEY_REUSED`. Variáveis: `RATE_LIMIT_*`, `IDEMPOTENCY_TTL_SECONDS` (veja `.env.example`).

**Seed de desenvolvimento/homologação:** `npm run db:seed:dev` aplica migrações, limpa as tabelas de domínio e cria uma massa previsível com usuários, arenas, slots, reservas, eventos, bookings, payments, notificações e audit logs. Veja `docs/02-dev-seed.md`.

### Arenas — mapa de endpoints

| Rota | Auth | Uso |
| --- | --- | --- |
| `GET /arenas` | Não | Catálogo público paginado (`/arenas` no frontend); busca por `q`, `city`, `state`, `district`; só arenas `ACTIVE` |
| `GET /arenas/:id` | Não | Detalhe completo (`/arenas/[arenaId]`) |
| `POST /arenas` | `arena_owner` / `admin` | Criação |
| `PATCH /arenas/:id` | Dono ou admin | Edição |
| `GET /users/me/arenas` | `arena_owner` | Painel do dono (`/owner/arenas`) |
| `GET /admin/arenas` | `admin` | Operação interna |

O frontend **não** deve usar IDs fixos como fluxo principal de descoberta: use `GET /arenas` para listar e navegue para `GET /arenas/:id` ao selecionar uma arena.

### Eventos — mapa rápido (referência)

| Rota | Auth | Uso |
| --- | --- | --- |
| `GET /events` | Não | Catálogo público (só publicados, não encerrados) |
| `GET /events/:id` | Opcional | Detalhe |
| `GET /users/me/events` | Organizador | Painel `/account/events` |
| `GET /events/:eventId/participants` | Organizador / admin | Participantes gratuitos confirmados |
| `GET /events/:eventId/bookings` | Organizador / admin | Reservas e compras do evento (painel operacional) |
| `GET /events/:eventId/payments` | Organizador / admin | Pagamentos de bookings do evento |
| `GET /events/:eventId/summary` | Organizador / admin | Ocupação e receita básica do evento |

Migrações SQL ficam em `db/migrations/` e são aplicadas automaticamente no bootstrap quando a API sobe.

## Testes

### Testes leves

```bash
npm test
```

> Observação: `npm test` inclui testes de integração **quando Postgres (e, para sprints que usam cache, Redis) estiver acessível** conforme `POSTGRES_*` / `REDIS_*` no ambiente. O Vitest usa `testTimeout` elevado para estabilizar migrações e fluxos lentos. Em CI (`.github/workflows/ci.yml`), serviços `postgres` e `redis` são iniciados automaticamente.

### Testes de integração de infraestrutura (PostgreSQL/Redis)

1. Suba as dependências:

```bash
docker compose up -d postgres redis
```

2. Garanta que as variáveis de ambiente estão definidas (use `.env.example` como base).
   - Crie um arquivo `.env` na raiz do projeto (ele **não** deve ser versionado).
   - Quando você sobe `postgres` e `redis` via `docker compose` e roda os testes **no host** (Windows), normalmente os hosts serão `localhost` (por causa do `ports:`), não `postgres`/`redis`.

3. Rode:

```bash
npm run test:infra
```

Esta API segue a estratégia oficial em `docs/00-product/testing-strategy.md`.

## Versionamento

- O projeto seguirá **SemVer**.
- Enquanto o MVP estiver em evolução, versões podem permanecer em `0.x`.
- Releases (quando existirem) devem ser marcadas com tags `vX.Y.Z`.

## Padrões de API

Os padrões oficiais estão em:

- `docs/00-product/api-standards.md`
- `docs/00-product/architecture-overview.md`
- `docs/00-product/master-spec.md`

## Estrutura do código (alto nível)

- `src/main.ts`: bootstrap do servidor
- `src/app.ts`: criação da aplicação (middlewares, rotas base, 404, erro centralizado)
- `src/http/`: utilitários HTTP (envelope de resposta, rotas de infra, erros)
- `src/modules/`: módulos por domínio (`auth`, `users`, etc.)
- `db/migrations/`: migrações SQL versionadas

## CI

- Workflow GitHub Actions: `npm run build`, `npm run lint`, `npm test` com Postgres e Redis de serviço.

## Nota sobre escopo

Fora do escopo imediato (conforme sprints):

- recuperação de senha / social login / MFA
- Elasticsearch / Search Service / Kafka para busca pública
