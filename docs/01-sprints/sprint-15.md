# Sprint 15 — Public Arenas Discovery

## 1. Objetivo da sprint
Entregar um **catálogo público paginado** de arenas (`GET /arenas`) para descoberta no frontend (`/arenas`), sem depender de IDs conhecidos.

## 2. Problema que esta sprint resolve
Existiam detalhe (`GET /arenas/:id`), listagem do dono (`GET /users/me/arenas`) e admin (`GET /admin/arenas`), mas **não havia listagem pública** para busca por nome, cidade, bairro ou endereço.

## 3. Escopo

### Inclui
- `GET /arenas` — público, sem JWT
- Apenas arenas `ACTIVE` (filtro server-side; sem filtro de status na query)
- Paginação e filtros: `page`, `limit`, `q`, `city`, `state`, `district`, `sort`, `order`
- `q` em `name`, `slug`, `city`, `district`, `street`
- Payload enxuto sem dados sensíveis
- Testes de integração
- Documentação (`arenas.md`, `README.md`)

### Não inclui
- Cache público de arenas (não padronizado ainda)
- Geolocalização, ranking, agregados
- Alterações em `GET /arenas/:id`, `/users/me/arenas`, `/admin/arenas`
- Frontend

## 4. Endpoint

### `GET /arenas`
**Auth:** nenhuma

**Query params:** `page`, `limit`, `q`, `city`, `state`, `district`, `sort` (`name` | `createdAt` | `updatedAt`), `order` (default `updatedAt` + `desc`)

**Item:** `id`, `name`, `slug`, `status`, `city`, `state`, `district`, `addressName`, `createdAt`

**Frontend:** usar `GET /arenas` para catálogo e `GET /arenas/:id` para detalhe em `/arenas/[arenaId]`.

## 5. Critérios de aceite
- [x] `GET /arenas` responde 200 sem JWT
- [x] Retorna apenas arenas `ACTIVE`
- [x] Arenas `INACTIVE` não aparecem
- [x] Paginação, `q`, `city`, `state`, `district`, ordenação funcionam
- [x] Payload sem `ownerId`, `document`, `policy`, `phone`, `email`
- [x] `GET /arenas/:id`, `GET /users/me/arenas`, `/admin/arenas` intactos
- [x] Testes passam; documentação atualizada
