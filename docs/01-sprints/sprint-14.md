# Sprint 14 — Owner Arenas Read Model

## 1. Objetivo da sprint
Entregar um **read model seguro** para o dono de arena (`arena_owner`) listar **apenas as próprias arenas** no painel `/owner`, sem usar `GET /admin/arenas?ownerId=...` nem expor `ownerId` como filtro controlável pelo cliente.

## 2. Problema que esta sprint resolve
O frontend do dono de arena (Sprint 13A) já opera CRUD e sub-recursos (`POST /arenas`, `GET/PATCH /arenas/:id`, spaces, slots, reservas), mas **não existe listagem autenticada das arenas do usuário logado**.

Hoje:
- Não há `GET /users/me/arenas`, `GET /arenas/me` nem `GET /owner/arenas`.
- Não existe `GET /arenas` público de catálogo.
- `GET /admin/arenas?ownerId=...` é **admin-only** e não deve ser usado pelo `arena_owner` comum.
- Após criar uma arena, o front depende de estado local ou de conhecer o `id` — não há como montar o hub `/owner` de forma confiável.

## 3. Escopo da sprint

### Inclui
- **`GET /users/me/arenas`** (rota recomendada)
  - JWT obrigatório
  - role permitida: **`arena_owner`** (403 para `user` comum; admin usa `/admin/arenas`)
  - filtro server-side fixo: `owner_id = auth.id` (nunca aceitar `ownerId` do cliente)
  - inclui arenas `ACTIVE` e `INACTIVE` do dono
  - paginação obrigatória
  - filtros: `page`, `limit`, `status`, `city`, `q`, `sort`, `order`
  - **sem cache** de catálogo (dados do painel privado)
- Testes de integração (listagem, paginação, filtros, isolamento entre donos, 401/403)
- Atualização mínima de `docs/02-features/arenas.md`

### Não inclui
- `GET /arenas/me`, `GET /owner/arenas`
- `GET /users/me/arenas/:arenaId` (detalhe continua em `GET /arenas/:id`)
- Melhorias em `GET /arenas/:id` (já retorna payload completo)
- CRUD de spaces/slots/reservations
- Admin UI, alterações no frontend
- Busca dedicada, relatórios, onboarding avançado
- Uso de `/admin/arenas` pelo fluxo do dono comum
- Novos status de arena (`SUSPENDED`, `PENDING_APPROVAL`) — enum atual: `ACTIVE`, `INACTIVE`

## 4. Endpoint principal

### `GET /users/me/arenas`
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `arena_owner`  
**Rate limit:** opcional; seguir paridade com `/users/me/events` (sem limiter dedicado hoje)

**Query params:**
| Param | Tipo | Notas |
|-------|------|--------|
| `page` | int ≥ 1 | default 1 |
| `limit` | int 1–100 | default 10 |
| `status` | enum | `ACTIVE`, `INACTIVE` |
| `city` | string | ILIKE em `arena_addresses.city` |
| `q` | string | ILIKE em `a.name`, `a.slug` e `addr.city` |
| `sort` | enum | `name`, `createdAt`, `updatedAt` (default: `updatedAt`) |
| `order` | `asc` \| `desc` | default `desc` |

**Item da listagem:**
- `id`, `ownerId`, `name`, `slug`, `status`, `city`, `state`, `createdAt`, `updatedAt`

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "ownerId": "uuid",
      "name": "Arena Norte Sports",
      "slug": "arena-norte-sports",
      "status": "ACTIVE",
      "city": "Belém",
      "state": "PA",
      "createdAt": "2026-01-10T12:00:00.000Z",
      "updatedAt": "2026-01-20T15:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "sort": "updatedAt",
    "order": "desc"
  }
}
```

Detalhe completo (endereço, política) permanece em **`GET /arenas/:id`**.

## 5. Regras de autorização
1. `GET /users/me/arenas` retorna somente arenas com `owner_id = auth.id`.
2. Parâmetro `ownerId` na query deve ser **ignorado** (não altera escopo).
3. Usuário com role `user` recebe **403**.
4. Admin consulta visão global via **`GET /admin/arenas`**.
5. Dono A não vê arenas do dono B.

## 6. Módulos afetados
- `src/modules/users/routes.ts`
- `src/modules/arenas/service.ts`
- `src/modules/arenas/schemas.ts`
- `test/sprint14.owner-arenas.integration.test.ts` (novo)
- `docs/02-features/arenas.md`

## 7. Dependências
- Sprint 04 (CRUD de arenas, spaces, slots)
- Sprint 11 (admin separado)
- Sprint 13 (precedente `/users/me/events`)
- JWT + `requireRoles` + paginação estabilizados

## 8. Testes mínimos esperados
- 401 sem token
- 403 para role `user`
- Dono lista apenas arenas próprias (ACTIVE + INACTIVE)
- Dois donos isolados
- Paginação + filtros `status`, `city`, `q`, `sort`, `order`
- `ownerId` na query não expande escopo

## 9. Critérios de aceite
- [x] `GET /users/me/arenas` exige JWT; sem token → 401
- [x] Role `user` → 403
- [x] `arena_owner` lista apenas arenas próprias
- [x] Dois donos não veem arenas um do outro
- [x] Paginação e filtros funcionam
- [x] Resposta inclui `city` e `state` do endereço
- [x] Detalhe continua em `GET /arenas/:id` (sem rota duplicada)
- [x] Testes automatizados passam localmente
- [x] Documentação de feature atualizada

## 10. Fora de escopo / sprint futura
- Listagem pública de arenas para organizadores
- Contadores agregados (spaces, slots, reservas pendentes) na listagem
- Dashboard financeiro da arena

## 11. Observações para implementação
- Reutilizar padrão de query de `listMyOrganizerEvents` (Sprint 13) e join com `arena_addresses` para `city`/`state` (como `listAdminArenas`).
- Implementar `listMyArenas` em `arenas/service.ts`; registrar rota em `users/routes.ts`.
- Não reutilizar `listAdminArenas` diretamente (escopo e roles diferentes).
