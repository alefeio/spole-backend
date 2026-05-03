# Spolê — API

API REST do Spolê, seguindo abordagem **API-first** e **arquitetura modular por domínio** (monólito modular).

## Objetivo deste repositório

Esta base foi preparada na **Sprint 00** para permitir evolução disciplinada sprint a sprint, sem antecipar integrações ou regras de negócio fora do escopo.

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

## Testes

### Testes leves

```bash
npm test
```

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
- `src/modules/`: módulos por domínio (pastas reservadas para evolução nas próximas sprints)

## Nota sobre escopo

Na Sprint 01 **não** existe:

- autenticação funcional
- endpoints de negócio
- regras de domínio (apenas infraestrutura)
