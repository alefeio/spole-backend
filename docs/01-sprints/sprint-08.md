# Sprint 08 — Search refinado, paginação, cache e maturidade operacional

## 1. Objetivo da sprint
Refinar a descoberta de eventos e melhorar a maturidade operacional da API, entregando busca pública mais consistente, paginação padronizada, cache nas leituras mais acessadas e base mínima de confiabilidade para CI e execução contínua.

## 2. Problema que esta sprint resolve
Após a Sprint 07, o núcleo transacional do MVP está funcional, mas ainda existem lacunas de experiência e operação:
- algumas listagens ainda não seguem paginação consistente
- a busca pública ainda pode evoluir em filtros e previsibilidade
- faltam políticas mais claras de cache
- o projeto precisa reduzir risco operacional em testes e pipeline

## 3. Escopo da sprint

### Inclui
- refino da busca pública de eventos
- padronização de paginação em listagens prioritárias
- filtros consistentes em endpoints de descoberta
- cache para leituras frequentes de eventos e categorias
- invalidação de cache nas mutações relevantes
- revisão dos contratos de listagem para alinhamento com `api-standards.md`
- documentação operacional mínima para execução de testes
- preparação da base para CI com build, lint e testes
- tratamento de timeouts de testes quando necessário
- testes automatizados compatíveis com o escopo

### Não inclui
- Elasticsearch
- Kafka
- Debezium
- Search Service separado
- recomendação personalizada
- autocomplete avançado
- busca semântica
- antifraude avançado
- observabilidade completa
- dashboards operacionais completos

## 4. Módulos afetados
- `src/modules/events/`
- `src/modules/categories/`
- `src/modules/bookings/`, apenas se necessário para alinhar listagens
- `src/modules/payments/`, apenas se necessário para alinhar listagens do usuário
- `src/shared/cache/`
- `src/shared/cache/redis/`
- documentação e arquivos de pipeline, se adotados nesta sprint

## 5. Dependências
- Sprint 03 concluída
- Sprint 06 concluída
- Sprint 07 concluída
- Redis operacional
- contratos principais da API estabilizados

## 6. Regras de negócio desta sprint
1. Apenas eventos públicos e publicados devem aparecer na busca pública.
2. Eventos privados não devem aparecer em resultados públicos.
3. Listagens principais devem seguir paginação consistente.
4. A busca deve permitir filtros previsíveis por:
   - termo textual
   - categoria
   - cidade
   - intervalo de datas
   - tipo do evento
5. O cache deve ser usado apenas para acelerar leitura, nunca como fonte de verdade.
6. Alterações em eventos e categorias devem invalidar os caches relacionados.
7. O comportamento funcional do domínio não deve ser alterado nesta sprint.
8. A sprint deve melhorar previsibilidade e performance, não mudar a regra central de negócio.
9. Caso alguma listagem continue sem paginação por decisão consciente, isso deve ficar documentado explicitamente.

## 7. Entidades e tabelas envolvidas
- `Event`
- `EventCategory`
- `Booking`, apenas se houver ajuste de listagem
- `Payment`, apenas se houver ajuste de listagem

## 8. Endpoints esperados

### GET /events
**Descrição:** lista eventos públicos com busca, filtros e paginação consistentes.

**Query params esperados**
- `q`
- `category`
- `city`
- `dateFrom`
- `dateTo`
- `type`
- `page`
- `limit`
- `sort`
- `order`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Pelada de quarta",
      "type": "PAID",
      "visibility": "PUBLIC",
      "city": "Belém",
      "state": "PA",
      "startAt": "2026-04-20T18:00:00.000Z",
      "capacity": 20,
      "pricePerPerson": 10
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1
  }
}
```

### GET /categories
**Descrição:** lista categorias públicas, podendo usar cache.

### GET /users/me/bookings
**Descrição:** pode receber paginação se decidido nesta sprint.

### GET /users/me/payments
**Descrição:** pode receber paginação se decidido nesta sprint.

## 9. Fluxo funcional
1. Usuário entra na área pública e pesquisa eventos.
2. Sistema aplica filtros e paginação.
3. Sistema consulta cache quando aplicável.
4. Em cache miss, busca no PostgreSQL.
5. Sistema retorna resultados consistentes com `meta`.
6. Quando evento ou categoria é alterado, o cache correspondente é invalidado.

## 10. Critérios de aceite
- [x] Busca pública de eventos funciona com filtros principais
- [x] Eventos privados não aparecem em busca pública
- [x] Eventos não publicados não aparecem em busca pública
- [x] Listagem pública de eventos possui paginação consistente
- [x] Categorias públicas podem ser servidas com cache
- [x] Alteração em evento invalida cache relacionado
- [x] Alteração em categoria invalida cache relacionado
- [x] Contratos de listagem ficam alinhados ao padrão de resposta da API
- [x] Testes automatizados cobrem filtros, paginação e cache básico
- [x] Documentação operacional mínima de testes e pipeline está atualizada

## 11. Critérios técnicos
- [x] Uso de Redis para cache de leitura implementado de forma segura
- [x] Invalidação de cache aplicada nas mutações relevantes
- [x] Tratamento de erro padronizado
- [x] Paginação consistente nas listagens priorizadas
- [x] Testes automatizados executáveis localmente
- [x] Timeouts de testes revisados quando necessário
- [x] Estrutura pronta para futura evolução de busca sem reescrever o domínio

## 12. Riscos e cuidados
- cache mascarar inconsistências do banco
- paginação quebrar contratos existentes
- invalidar cache de forma insuficiente
- superestender a sprint tentando fazer Elasticsearch cedo demais
- misturar melhoria de busca com mudança de regra de negócio
- alterar listagens internas além do necessário

## 13. Observações para o Cursor
1. Não implementar Elasticsearch nesta sprint.
2. Não criar Search Service separado nesta sprint.
3. Não antecipar Kafka, Debezium ou Worker.
4. Priorizar melhoria incremental e segura da busca atual.
5. Todo ajuste em listagem deve vir com teste automatizado.
6. Toda decisão de não paginar algum endpoint deve ficar documentada de forma explícita.