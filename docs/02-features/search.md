# Feature Spec — Search

## 1. Resumo
Busca de eventos na plataforma, permitindo que usuários encontrem eventos por texto, categoria, localidade, data e outros filtros, com evolução planejada de busca simples em banco para busca especializada com índice invertido.

## 2. Objetivo
Permitir descoberta eficiente de eventos, primeiro com busca simples adequada ao MVP e, depois, com evolução para full-text search de maior escala e melhor relevância.

## 3. Atores envolvidos
- Participante
- Organizador
- Profissional
- Administrador
- Sistema

## 4. Regras de negócio
1. Usuários devem conseguir pesquisar eventos públicos disponíveis na plataforma.
2. Eventos privados não devem aparecer em resultados de busca pública.
3. A busca deve respeitar o status do evento, retornando apenas eventos compatíveis com descoberta pública.
4. No MVP, a busca pode começar com filtros e pesquisa textual simples sobre o banco principal.
5. A arquitetura deve permitir evolução para um serviço de busca especializado.
6. A busca deve suportar, no mínimo:
   - termo textual
   - categoria
   - cidade
   - intervalo de datas
   - tipo do evento
7. Resultados devem ser pagináveis.
8. Ordenação e relevância devem ser previsíveis.
9. Alterações relevantes nos eventos devem refletir nos resultados de busca.
10. Em arquitetura evolutiva, o mecanismo especializado de busca não substitui o PostgreSQL como fonte de verdade transacional.

## 5. Fluxo principal
1. Usuário informa um termo ou filtros de busca.
2. Sistema valida os parâmetros.
3. Sistema consulta a fonte de busca correspondente à fase da arquitetura:
   - banco principal, no MVP
   - mecanismo especializado, em fase evoluída
4. Sistema retorna resultados paginados.
5. Usuário acessa o evento desejado.

## 6. Fluxos alternativos

### 6.1 Busca sem termo textual
Usuário aplica apenas filtros, como categoria, cidade ou data.

### 6.2 Busca por termo textual
Usuário busca por texto livre, como nome do evento ou modalidade.

### 6.3 Busca sem resultado
Sistema retorna lista vazia com metadados consistentes.

### 6.4 Evolução para busca especializada
Em fase futura, a API encaminha consultas para Search Service ou camada equivalente com Elasticsearch.

## 7. Fluxos de exceção

### 7.1 Parâmetros inválidos
- condição: datas inválidas, paginação inválida ou enums incorretos
- resultado esperado: erro 400

### 7.2 Índice de busca desatualizado
- condição: em arquitetura evoluída, resultado inconsistente por atraso de sincronização
- resultado esperado: comportamento controlado, sem quebrar a API

### 7.3 Mecanismo de busca indisponível
- condição: falha do serviço especializado
- resultado esperado: erro operacional ou fallback, conforme a arquitetura da sprint

## 8. Entidades envolvidas
- Event
- EventCategory
- SearchDocument ou estrutura equivalente, em fase futura
- Elasticsearch, em fase futura
- Kafka, Debezium e Worker, em fase futura

## 9. Campos relevantes

### Event
- id
- organizerId
- categoryId
- title
- description
- type
- visibility
- status
- startAt
- endAt
- city
- state
- pricePerPerson
- createdAt
- updatedAt

### EventCategory
- id
- name
- slug
- icon
- status

### Campos com maior interesse para indexação futura
- title
- description
- city
- state
- category name
- startAt
- type
- status
- visibility

## 10. Estado e transições
Esta feature não possui um ciclo de estados próprio como bookings ou payments, mas depende do estado do evento.

### Eventos elegíveis para busca pública
- `PUBLISHED`
- `visibility = PUBLIC`

### Eventos não elegíveis para busca pública
- `DRAFT`
- `CANCELLED`
- `FINISHED`, conforme política de listagem adotada
- `visibility = PRIVATE`

## 11. Entradas
- termo textual opcional
- category
- city
- state opcional
- dateFrom
- dateTo
- type
- page
- limit
- sort
- order

## 12. Saídas
- lista paginada de eventos
- metadados de paginação
- informações básicas necessárias para descoberta do evento

## 13. Validações
- `page` e `limit` em faixas válidas
- `dateFrom` e `dateTo` coerentes
- `type` dentro dos enums aceitos
- filtros textuais saneados
- apenas eventos públicos e publicados entram no resultado da busca pública

## 14. Regras de concorrência
1. Busca é majoritariamente operação de leitura.
2. O principal cuidado é consistência aceitável entre atualização de eventos e resultado retornado.
3. Em fase futura, a sincronização assíncrona com índice externo pode gerar consistência eventual.
4. A API não deve depender de locks transacionais para busca.

## 15. Regras de persistência
### MVP
- não exige persistência adicional além dos dados já presentes em `Event` e `EventCategory`

### Evolução futura
- criação e manutenção de documentos indexados no mecanismo de busca
- sincronização via CDC com Debezium
- publicação em Kafka
- consumo por Worker
- atualização de documentos no Elasticsearch

## 16. Regras de cache
1. Resultados de busca frequentes podem ser cacheados, especialmente em cenários de leitura intensa.
2. Mudanças em eventos publicados devem invalidar caches relacionados.
3. Em busca especializada, cache pode ser aplicado em consultas populares, mas sem comprometer atualização relevante do catálogo.

## 17. Erros esperados
- 400 requisição inválida
- 404 opcionalmente não aplicável para busca, preferindo lista vazia
- 500 falha operacional de busca

## 18. Critérios de aceite
- [ ] Usuário consegue pesquisar eventos públicos por termo textual
- [ ] Usuário consegue filtrar eventos por categoria
- [ ] Usuário consegue filtrar eventos por cidade
- [ ] Usuário consegue filtrar eventos por intervalo de datas
- [ ] Resultados são paginados
- [ ] Eventos privados não aparecem na busca pública
- [ ] Eventos não publicados não aparecem na busca pública
- [ ] Busca sem resultados retorna lista vazia com metadados consistentes

## 19. Fora do escopo
- recomendação personalizada
- ranking por comportamento de usuário
- busca semântica
- autocomplete avançado
- correção avançada de digitação no MVP
- indexação distribuída completa fora da sprint correspondente

## 20. Evolução arquitetural prevista
### Fase MVP
- busca simples por SQL e filtros na API principal
- uso opcional de cache para consultas frequentes

### Fase evoluída
- Search Service dedicado
- Elasticsearch com índice invertido
- sincronização com PostgreSQL via CDC
- Debezium lendo alterações do banco
- Kafka distribuindo eventos de mudança
- Worker consumindo a fila e atualizando o índice
- busca com melhor relevância, tolerância a typo e performance em larga escala