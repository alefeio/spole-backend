# Spolê — API

API REST do Spolê, seguindo abordagem **API-first** e **arquitetura modular por domínio** (monólito modular).

## Objetivo deste repositório
Esta base foi preparada na **Sprint 00** para permitir evolução disciplinada sprint a sprint, sem antecipar integrações ou regras de negócio fora do escopo.

## Como executar localmente

### Pré-requisitos
- Node.js (LTS recomendado)

### Instalação
```bash
npm install
```

### Rodar em modo desenvolvimento
```bash
npm run dev
```

Por padrão a API sobe em `http://localhost:3000`.

### Healthcheck
- `GET /health`

Resposta (padrão de sucesso):
```json
{
  "success": true,
  "data": { "status": "ok" },
  "meta": { "uptimeMs": 123 }
}
```

## Testes
```bash
npm test
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
Na Sprint 00 **não** existe:
- autenticação funcional
- endpoints de negócio
- integração com PostgreSQL
- integração com Redis
