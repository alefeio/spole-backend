# Sprint 03 — Categorias e CRUD de eventos

## 1. Objetivo da sprint
Implementar o primeiro núcleo funcional do domínio do Spolê, permitindo cadastrar categorias, criar eventos, editar eventos, listar eventos públicos e visualizar detalhes de um evento.

## 2. Problema que esta sprint resolve
Sem o CRUD de eventos e categorias, o produto ainda não entrega seu valor principal: permitir que organizadores publiquem atividades e que participantes descubram essas atividades.

## 3. Escopo da sprint

### Inclui
- CRUD de categorias
- CRUD de eventos
- criação de evento gratuito ou pago
- criação de evento público ou privado
- criação de evento em local livre
- listagem de eventos públicos
- visualização de detalhes de evento
- atualização de evento pelo organizador
- cancelamento lógico de evento
- validações principais de domínio
- filtros básicos em listagem

### Não inclui
- compra de ingresso
- reserva temporária com TTL
- pagamentos
- eventos vinculados a arena
- reserva de slots
- recorrência
- cache avançado
- Elasticsearch

## 4. Módulos afetados
- `src/modules/categories/`
- `src/modules/events/`
- `src/shared/middleware/`
- persistência das entidades de categoria e evento

## 5. Dependências
- Sprint 02 concluída
- autenticação funcional
- persistência de usuários pronta
- middleware de autenticação disponível

## 6. Regras de negócio desta sprint
1. Todo evento deve possuir organizador, categoria, título, data de início, data de fim, local e capacidade.
2. Eventos podem ser gratuitos ou pagos.
3. Eventos pagos exigem valor por inscrição válido.
4. Eventos podem ser públicos ou privados.
5. Eventos privados não devem aparecer na listagem pública.
6. Eventos em local livre não dependem de reserva de arena nesta sprint.
7. Apenas o organizador do evento ou admin pode editar ou cancelar o evento.
8. A capacidade do evento deve ser maior que zero.
9. A data de início deve ser anterior à data de fim.
10. O status inicial do evento pode ser `DRAFT` ou `PUBLISHED`, conforme decisão do fluxo da API.

## 7. Entidades e tabelas envolvidas
- `EventCategory`
- `Event`

## 8. Endpoints esperados

### POST /categories
**Descrição:** cria uma categoria de evento.

**Auth:** sim  
**Perfis permitidos:** admin

**Request**
```json
{
  "name": "Futebol",
  "slug": "futebol",
  "icon": "football"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Futebol",
    "slug": "futebol",
    "icon": "football"
  }
}
```

**Erros esperados**
- 400 dados inválidos
- 401 não autenticado
- 403 sem permissão
- 409 slug já existente

### GET /categories
**Descrição:** lista categorias disponíveis.

**Auth:** não  
**Perfis permitidos:** público

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Futebol",
      "slug": "futebol",
      "icon": "football"
    }
  ]
}
```

### POST /events
**Descrição:** cria um evento.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Request**
```json
{
  "categoryId": "uuid",
  "title": "Pelada de quarta",
  "description": "Jogo aberto para completar time",
  "type": "PAID",
  "visibility": "PUBLIC",
  "sourceType": "FREE_LOCATION",
  "status": "PUBLISHED",
  "startAt": "2026-04-20T18:00:00.000Z",
  "endAt": "2026-04-20T20:00:00.000Z",
  "addressName": "Praça Batista Campos",
  "street": "Praça Batista Campos",
  "number": "s/n",
  "district": "Batista Campos",
  "city": "Belém",
  "state": "PA",
  "capacity": 20,
  "pricePerPerson": 10
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Pelada de quarta",
    "type": "PAID",
    "visibility": "PUBLIC",
    "status": "PUBLISHED"
  }
}
```

**Erros esperados**
- 400 dados inválidos
- 401 não autenticado
- 422 regra de domínio inválida

### GET /events
**Descrição:** lista eventos públicos.

**Auth:** não  
**Perfis permitidos:** público

**Query params sugeridos**
- `page`
- `limit`
- `category`
- `city`
- `dateFrom`
- `dateTo`
- `type`

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

### GET /events/:id
**Descrição:** retorna os detalhes de um evento.

**Auth:** não  
**Perfis permitidos:** público, respeitando visibilidade do evento

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Pelada de quarta",
    "description": "Jogo aberto para completar time",
    "type": "PAID",
    "visibility": "PUBLIC",
    "status": "PUBLISHED",
    "startAt": "2026-04-20T18:00:00.000Z",
    "endAt": "2026-04-20T20:00:00.000Z",
    "addressName": "Praça Batista Campos",
    "city": "Belém",
    "state": "PA",
    "capacity": 20,
    "pricePerPerson": 10
  }
}
```

**Erros esperados**
- 404 evento não encontrado
- 403 evento privado sem acesso apropriado

### PATCH /events/:id
**Descrição:** atualiza um evento existente.

**Auth:** sim  
**Perfis permitidos:** dono do evento ou admin

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Pelada de quarta atualizada"
  }
}
```

**Erros esperados**
- 401 não autenticado
- 403 sem permissão
- 404 evento não encontrado
- 422 regra inválida

### DELETE /events/:id
**Descrição:** cancela logicamente um evento.

**Auth:** sim  
**Perfis permitidos:** dono do evento ou admin

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "CANCELLED"
  }
}
```

**Erros esperados**
- 401 não autenticado
- 403 sem permissão
- 404 evento não encontrado

## 9. Fluxo funcional
1. Admin cria categorias.
2. Organizador autenticado cria um evento.
3. Sistema valida regras do evento.
4. Evento é persistido.
5. Eventos públicos aparecem na listagem.
6. Participantes consultam detalhes do evento.
7. Organizador pode editar ou cancelar seu próprio evento.

## 10. Critérios de aceite
- [ ] Admin consegue criar categorias
- [ ] Categorias podem ser listadas publicamente
- [ ] Organizador consegue criar evento gratuito
- [ ] Organizador consegue criar evento pago com preço válido
- [ ] Eventos públicos aparecem na listagem
- [ ] Eventos privados não aparecem na listagem pública
- [ ] Participante consegue ver detalhes de evento público
- [ ] Organizador consegue editar o próprio evento
- [ ] Organizador consegue cancelar logicamente o próprio evento
- [ ] Usuário sem permissão não consegue editar evento de outro usuário

## 11. Critérios técnicos
- [ ] Estrutura modular de categories criada
- [ ] Estrutura modular de events criada
- [ ] Validações de entrada aplicadas
- [ ] Regras de domínio isoladas
- [ ] Tratamento de erro padronizado
- [ ] Paginação básica implementada
- [ ] Filtros básicos implementados
- [ ] testes automatizados compatíveis com o escopo
- [ ] testes executáveis localmente

## 12. Riscos e cuidados
- misturar evento em local livre com evento em arena nesta sprint
- permitir evento pago sem preço
- permitir edição por usuário sem ownership
- expor eventos privados na listagem pública

## 13. Observações para o Cursor
1. Não implementar compra de ingresso nesta sprint.
2. Não implementar booking com TTL.
3. Não implementar arena, slots ou reservas ainda.
4. Priorizar evento em local livre e leitura pública.
5. Todo endpoint novo deve sair com testes
6. Toda correção relevante deve incluir regressão, quando aplicável