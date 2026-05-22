# Sprint 13 — Organizer Events Read Model

## 1. Objetivo da sprint
Entregar um **read model seguro** para o organizador autenticado listar e inspecionar **apenas os próprios eventos** no painel/CRUD do frontend, sem expor `organizerId` via query em rotas públicas nem reutilizar `/admin/events`.

Complementar o detalhe de `GET /events/:id` para que o organizador (e admin, quando aplicável) receba payload suficiente para **edição** (`categoryId`, endereço completo, `privateCode`, `reservationId`, metadados de origem).

## 2. Problema que esta sprint resolve
O frontend do organizador já usa CRUD real (`POST/PATCH/DELETE /events`, `GET /events/:id`, participantes), mas **não existe listagem segura** dos eventos do usuário logado.

Hoje:
- `GET /events` é catálogo **público** (`PUBLIC` + `PUBLISHED` + categoria ativa), com cache.
- `GET /admin/events?organizerId=...` é **admin-only** e não deve ser usado por organizador comum.
- Não há `GET /users/me/events` nem `GET /events/me`.

Isso impede a tela de gestão (“meus eventos”) sem workarounds inseguros.

## 3. Escopo da sprint

### Inclui
- **`GET /users/me/events`** (rota recomendada; ver análise técnica)
  - JWT obrigatório
  - roles: `user`, `arena_owner`, `admin`
  - filtro server-side fixo: `organizer_id = auth.id` (nunca aceitar `organizerId` do cliente)
  - inclui eventos `DRAFT`, `PUBLISHED`, `CANCELLED`
  - inclui `PUBLIC` e `PRIVATE`
  - inclui `FREE_LOCATION` e `ARENA_RESERVATION`
  - paginação obrigatória e filtros: `page`, `limit`, `q`, `status`, `visibility`, `type`, `sourceType`, `categoryId`, `dateFrom`, `dateTo`, `sort`, `order`
  - **não** retornar `privateCode` na listagem
- **Melhoria de `GET /events/:id`**
  - Diferenciar payload por contexto: visitante público / visitante com código privado / não-dono autenticado / organizador / admin
  - Payload de edição para organizador e admin com campos completos (ver seção 8)
  - Indicar campos derivados somente leitura para `ARENA_RESERVATION`
- Testes de integração cobrindo listagem, detalhe, paginação, filtros e não-vazamento de `privateCode`
- Atualização de `docs/02-features/events.md` (contratos novos/alterados)

### Não inclui
- `GET /events/:eventId/bookings`, payments, resumo financeiro, ocupação paga
- `GET /users/me/events/:eventId` (salvo decisão contrária na implementação — padrão: não criar)
- Admin UI, alterações no frontend
- Recorrência, gateway real, webhooks novos
- Check-in, relatórios, auditoria visual
- CRUD de categorias, arenas, slots
- Endpoints de search separados
- Mudanças no fluxo de pagamento
- Uso de `GET /admin/events` por organizador comum

## 4. Endpoint principal

### `GET /users/me/events`
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `user`, `arena_owner`, `admin`  
**Rate limit:** perfil `authenticated` (mesmo padrão de `/users/me/bookings`)

**Query params:**
| Param | Tipo | Notas |
|-------|------|--------|
| `page` | int ≥ 1 | default 1 |
| `limit` | int 1–100 | default 10 |
| `q` | string | ILIKE em `title` e `description` (mesmo padrão de `GET /events`) |
| `status` | enum | `DRAFT`, `PUBLISHED`, `CANCELLED` |
| `visibility` | enum | `PUBLIC`, `PRIVATE` |
| `type` | enum | `FREE`, `PAID` |
| `sourceType` | enum | `FREE_LOCATION`, `ARENA_RESERVATION` |
| `categoryId` | uuid | |
| `dateFrom` | ISO datetime | filtra `start_at >=` |
| `dateTo` | ISO datetime | filtra `start_at <=` |
| `sort` | enum | `startAt`, `createdAt`, `updatedAt` (default recomendado: `updatedAt`) |
| `order` | `asc` \| `desc` | default `desc` para gestão |

**Item da listagem (sem `privateCode`):**
- `id`, `title`, `status`, `visibility`, `type`, `sourceType`, `categoryId`
- `startAt`, `endAt`, `city`, `state`, `capacity`, `pricePerPerson`
- `createdAt`, `updatedAt` (recomendado para UI de gestão)

**Resposta:** envelope padrão `{ success, data, meta }` com `meta.page`, `meta.limit`, `meta.total`, `meta.sort`, `meta.order`.

### `privateCode` na listagem
**Não retornar** na listagem. Motivos: reduzir superfície de vazamento (logs, analytics, screenshots), listagem é agregação; o código é segredo de acesso.

**Frontend — obter `privateCode` quando necessário:**
1. Após `POST /events` em evento `PRIVATE`, o create já pode devolver `privateCode` (comportamento atual).
2. Na edição / “copiar link”, chamar **`GET /events/:id` autenticado como organizador** (ou após `PATCH` que altere visibilidade).
3. Opcional na listagem: apenas `visibility: "PRIVATE"` (sem o código).

## 5. Melhoria de `GET /events/:id`

Manter rota única; **não** criar `GET /users/me/events/:eventId` se o detalhe público/privado/organizador continuar resolvível com segurança em `GET /events/:id`.

### Matriz de acesso (manter padrão atual)
| Contexto | Acesso | `privateCode` no body |
|----------|--------|------------------------|
| Sem token, evento público publicado/cancelado | 200, payload reduzido | não |
| Sem token, privado | 403 | — |
| Token, não dono, público | 200, payload reduzido | não |
| Token, não dono, privado sem código | 403 | — |
| Query `privateCode` válido, privado | 200, payload reduzido | não |
| Organizador dono | 200, payload edição | sim |
| Admin | 200, payload edição | sim |

Erros: manter **`403`** (`FORBIDDEN`) para acesso negado a evento existente mas não permitido; **`404`** (`EVENT_NOT_FOUND`) para id inexistente — alinhado aos testes em `events.categories.integration.test.ts`.

### Payload “edição” (organizador e admin)
Campos obrigatórios no detalhe completo:
- `id`, `categoryId`, `title`, `description`, `type`, `visibility`, `status`, `sourceType`
- `reservationId` (quando `ARENA_RESERVATION`)
- `startAt`, `endAt`, `addressName`, `street`, `number`, `district`, `city`, `state`
- `capacity`, `pricePerPerson`, `privateCode` (somente organizador/admin)

Metadado recomendado para o front:
- `locationReadOnly: true` quando `sourceType === "ARENA_RESERVATION"` (horário/endereço derivados da reserva; PATCH de local/horário pode ser ignorado ou rejeitado em sprint futura)

### Payload “visitante” (inalterado em espírito)
Sem `privateCode`, sem `categoryId` se não necessário ao catálogo; sem `reservationId` para não-donos.

## 6. Regras de autorização
1. `GET /users/me/events` só retorna eventos com `organizer_id = auth.id`.
2. Parâmetro `organizerId` **proibido** nesta rota (ignorar ou 400 se enviado — preferir ignorar para não quebrar clientes).
3. Admin **não** usa esta rota para visão global; continua com `GET /admin/events`.
4. `privateCode` só em detalhe para organizador ou admin.
5. Listagem do organizador **sem cache público** (dados privados e rascunhos).

## 7. Módulos afetados
- `src/modules/users/routes.ts` — registrar rota
- `src/modules/events/service.ts` — `listMyOrganizerEvents`, evoluir `mapEventDetail` / `getEventDetail`
- `src/modules/events/schemas.ts` — `listMyOrganizerEventsQuerySchema`
- `src/shared/security/rate-limit-profiles.ts` — chave opcional para nova rota
- `test/sprint13.organizer-events.integration.test.ts` (novo)
- `docs/02-features/events.md`

## 8. Dependências
- Sprint 02 (eventos CRUD)
- Sprint 05 (eventos em arena / `ARENA_RESERVATION`)
- Sprint 08 (padrão `q` e paginação em eventos)
- Sprint 11 (admin separado — não misturar)
- Sprint 12 (rate limit / request id — aplicar perfil authenticated)

## 9. Testes mínimos esperados
Ver `docs/00-product/testing-strategy.md` e seção de critérios de aceite abaixo.

## 10. Critérios de aceite
- [x] `GET /users/me/events` exige JWT; sem token → 401
- [x] Organizador lista apenas eventos próprios (inclui DRAFT, PRIVATE, CANCELLED, ARENA)
- [x] Dois organizadores não veem eventos um do outro
- [x] Paginação e filtros (`status`, `visibility`, `type`, `sourceType`, `categoryId`, `dateFrom`, `dateTo`, `q`, `sort`, `order`) funcionam
- [x] Listagem **não** contém `privateCode`
- [x] Organizador em `GET /events/:id` recebe payload completo para edição (incl. `categoryId`, endereço, `privateCode`, `reservationId` quando arena)
- [x] Visitante e não-dono não recebem `privateCode`
- [x] Evento `FREE_LOCATION` no detalhe do dono traz endereço editável completo
- [x] Evento `ARENA_RESERVATION` no detalhe do dono traz `reservationId`, horários e endereço coerentes com reserva/slot
- [x] `locationReadOnly` (ou equivalente) sinaliza arena ao front
- [x] Testes automatizados passam localmente
- [x] Documentação de feature atualizada

## 11. Fora do escopo / sprint futura
- `GET /events/:eventId/bookings` e financeiro do evento
- Resumo de ocupação/vagas pagas e status de pagamento por participante
- Status `FINISHED` no banco (ainda não implementado no enum atual)

## 12. Observações para implementação
- Reutilizar `escapeIlikePattern` e padrão de query de `listPublicEventsFromDb`, sem join obrigatório com categoria ativa (organizador pode ter rascunho em categoria inativa).
- Não reutilizar cache de catálogo público (`public-catalog-cache`).
- Evitar duplicar rota `GET /events/me` para não fragmentar convenção já usada em `/users/me/*`.
