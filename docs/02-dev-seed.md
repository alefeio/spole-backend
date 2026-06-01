# Seed de desenvolvimento/homologação

Massa previsível para testar a API e o frontend (incluindo homologação **H-19** — Pix real Asaas).

> **Não execute em produção.** O script recusa `NODE_ENV=production`.

## Como executar

```bash
npm run db:seed:dev
```

Conferir dados no banco:

```bash
npm run db:seed:dev:list
```

### Pré-requisitos

- `.env` com Postgres (veja `.env.example`)
- Redis opcional (invalida cache público se disponível)
- Se o `.env` só tiver Postgres, o script preenche defaults internos para `JWT_SECRET`, `PAYMENTS_WEBHOOK_SECRET` e `REDIS_HOST` (sem sobrescrever valores já definidos)

### Idempotência

Cada execução:

1. aplica migrações pendentes;
2. `TRUNCATE ... CASCADE` nas tabelas de domínio;
3. recria toda a massa em uma transação.

Rodar duas vezes **não duplica** registros — o resultado é o mesmo conjunto de dados.

### Pagamentos e Asaas

- O seed **não chama** a API do Asaas.
- Pagamentos no seed usam `provider_reference` com prefixo `seed-dev-mock-*` e status fixos para listagens/regressão.
- **Pix real (H-19):** use `PAYMENTS_PROVIDER=asaas` na API e crie pagamentos pelo frontend após o seed.

## Senha padrão

`SpoleDev123!` — todas as contas abaixo.

## Contas de desenvolvimento

| Papel | E-mail | Role | Status |
| --- | --- | --- | --- |
| Admin | `admin@spole.dev` | `admin` | ACTIVE |
| Dono de arena 1 | `arena1@spole.dev` | `arena_owner` | ACTIVE |
| Dono de arena 2 | `arena2@spole.dev` | `arena_owner` | ACTIVE |
| Organizador 1 | `org1@spole.dev` | `user` | ACTIVE |
| Organizador 2 | `org2@spole.dev` | `user` | ACTIVE |
| Organizador 3 | `org3@spole.dev` | `user` | ACTIVE |
| Participante 1 | `user1@spole.dev` | `user` | ACTIVE |
| Participante 2 | `user2@spole.dev` | `user` | ACTIVE |
| Participantes 3–6 | `user3`…`user6@spole.dev` | `user` | ACTIVE |
| Suspenso | `suspended@spole.dev` | `user` | SUSPENDED |
| Inativo | `inactive@spole.dev` | `user` | INACTIVE |

## Arenas (GET /arenas e GET /users/me/arenas)

| Nome | Owner | Status | Cidade / bairro | Pagamento mínimo |
| --- | --- | --- | --- | --- |
| Arena Spolê Central | arena1 | ACTIVE | Belém / Umarizal | 100% |
| Arena Spolê Norte | arena1 | ACTIVE | Belém / Batista Campos | 0% (auto-confirma) |
| Arena Beach Spolê | arena1 | ACTIVE | Belém / Mosqueiro | 100% |
| Arena Vôlei Pará | arena2 | ACTIVE | Ananindeua / Centro | 100% |
| Arena Funcional Ribeirinha | arena2 | ACTIVE | Belém / Icoaraci | 50% |
| Arena Spolê Inativa Homologação | arena1 | INACTIVE | Belém | — |

- `GET /arenas` → apenas **ACTIVE** (5 arenas).
- `GET /users/me/arenas` com `arena1@spole.dev` → Central, Norte, Beach, Inativa.
- `GET /users/me/arenas` com `user1@spole.dev` → **403**.

Cada arena ativa tem espaços e **slots futuros** (7–14 dias, manhã/tarde/noite).

### Slot H-19 (reserva paga)

- Arena: **Arena Spolê Central**
- Espaço: Campo Society 1
- Slot: **amanhã 20:00** (disponível, `h19CentralPaid`)
- Organizador sugerido: `org1@spole.dev`

## Eventos (GET /users/me/events)

### org1@spole.dev

| Título | Status | Visibilidade | Tipo | Uso |
| --- | --- | --- | --- | --- |
| Futebol Aberto Spolê | PUBLISHED | PUBLIC | FREE | Catálogo / join gratuito |
| **Torneio Spolê Pago** | PUBLISHED | PUBLIC | PAID R$ 40 | **H-19 Pix real** (user1 cria booking) |
| Treino Privado Spolê | PUBLISHED | PRIVATE | FREE | `privateCode`: `TREINO-PRIV-SPOLE` |
| Evento Rascunho Spolê | DRAFT | PUBLIC | PAID | Só painel do organizador |
| Evento Cancelado Spolê | CANCELLED | PUBLIC | FREE | Listagem org, não público |
| Partida na Arena Spolê Central | PUBLISHED | PUBLIC | FREE + ARENA_RESERVATION | `locationReadOnly` no detalhe |

### org2@spole.dev

| Título | Status | Tipo |
| --- | --- | --- |
| Torneio Beach Org2 | PUBLISHED | PAID |
| Funcional Aberto Org2 | PUBLISHED | FREE |

`org1` **não** acessa `GET /events/:eventId/summary` de eventos do `org2` (403).

## Reservas (seed)

| Cenário | Status | Notas |
| --- | --- | --- |
| org1 + slot HOLD | PENDING | Pagamento mock opcional `seed-dev-mock-reservationPending` |
| org2 + Arena Norte 0% | CONFIRMED | Sem payment |
| org1 recorrente Central | CONFIRMED | Ocorrências PENDING/CONFIRMED/RELEASED/CANCELLED |
| Cancelada | CANCELLED | — |

## Bookings e payments mock

- **Torneio Spolê Pago:** `user2` já `COMPLETED` + payment mock `PAID` — **`user1` livre** para H-19.
- Outros eventos: lotado, expirado, FAILED mock — ver `npm run db:seed:dev:list`.

## Categorias ativas

Futebol, Vôlei, Beach Tennis, Corrida, Ciclismo, Funcional, Personal Trainer (+ Basquete **INACTIVE** para admin).

## Configurar pagamentos

### Mock (default — CI e dev rápido)

```env
PAYMENTS_PROVIDER=mock
PAYMENTS_WEBHOOK_SECRET=dev-webhook-secret-change-me
```

Webhook manual: headers `X-Spole-Payment-Webhook-Secret` ou `X-Spole-Reservation-Payment-Webhook-Secret`.

### Asaas sandbox (H-19 real)

```env
PAYMENTS_PROVIDER=asaas
PAYMENTS_ENV=sandbox
ASAAS_API_KEY=<sandbox>
ASAAS_WEBHOOK_ACCESS_TOKEN=<token webhook>
ASAAS_DEFAULT_CUSTOMER_ID=<customer sandbox>
```

Detalhes de túnel, webhooks e roteiro: **[homologation-h19-api.md](./homologation-h19-api.md)**.

## Fluxos cobertos pelo seed

- Auth (incl. SUSPENDED / INACTIVE)
- `GET /arenas` (busca, cidade, bairro, paginação)
- `GET /users/me/arenas` (ownership)
- `GET /users/me/events` (organizador)
- `GET /events/:id` (privateCode, locationReadOnly)
- `GET /events/:eventId/summary|bookings|payments`
- Reservas, recorrência, ocorrências
- Bookings RESERVED/COMPLETED/EXPIRED
- Payments mock PENDING/PAID/FAILED/CANCELLED
- Notificações e audit logs (admin)

## Estratégia de reset

Ver transação + `TRUNCATE` em `scripts/seed-dev.ts`. Falha → rollback automático.
