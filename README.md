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

Migrações SQL ficam em `db/migrations/` e são aplicadas automaticamente no bootstrap quando a API sobe.

## Testes

### Testes leves

```bash
npm test
```

> Observação: `npm test` também inclui testes de integração de autenticação **quando o Postgres estiver acessível** conforme `POSTGRES_*` no ambiente (e com defaults de JWT para testes via `test/test-env.ts`).

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

## Nota sobre escopo

Fora do escopo imediato (conforme sprints):

- recuperação de senha / social login / MFA
- CRUD de eventos / arenas / reservas / pagamentos (virão em sprints futuras)
