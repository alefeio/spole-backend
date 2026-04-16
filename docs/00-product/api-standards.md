# Spolê — API Standards

## 1. Estilo da API
A API do Spolê será REST.

## 2. Convenção de rotas
Usar substantivos no plural e rotas previsíveis.

### Exemplos
- GET /events
- POST /events
- GET /events/:id
- PATCH /events/:id
- DELETE /events/:id

- GET /arenas
- POST /arenas
- GET /arenas/:id

- POST /auth/register
- POST /auth/login
- GET /users/me

## 3. Convenção de resposta

### Sucesso
```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

### Erro
```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "details": []
  }
}
```

## 4. Status codes
- 200 OK
- 201 Created
- 204 No Content
- 400 Bad Request
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found
- 409 Conflict
- 422 Unprocessable Entity
- 500 Internal Server Error

## 5. Autenticação
Usar JWT.

### Header
Authorization: Bearer <token>

## 6. Autorização
Autorização por role e por ownership quando aplicável.

### Roles iniciais
- user
- arena_owner
- admin

## 7. Validação
Toda entrada deve ser validada.

### Regras mínimas
- tipos corretos
- obrigatoriedade de campos
- limites de tamanho
- validações de enums
- validações de datas e valores monetários

## 8. Paginação
Listagens devem suportar paginação.

### Query params padrão
- page
- limit
- sort
- order

## 9. Filtros
Listagens podem suportar filtros via query params.

### Exemplo
- category
- city
- dateFrom
- dateTo
- visibility
- type

## 10. Logs
Aplicar logs mínimos para:
- subida da aplicação
- erros não tratados
- ações críticas de compra e reserva
- integrações externas

## 11. Tratamento de erros
Erros devem ser centralizados.

### Objetivos
- não vazar stack trace para o cliente
- padronizar formato
- facilitar rastreio

## 12. Convenção de nomes
- rotas em inglês
- entidades em inglês
- documentação pode estar em português
- nomes de tabela devem seguir uma convenção única no projeto

## 13. Organização do código
Cada módulo deve conter, quando aplicável:
- controller
- service ou use-case
- repository
- schema ou validator
- dto
- routes

## 14. Idempotência e concorrência
Endpoints críticos de compra e reserva devem prever concorrência.

## 15. Documentação
Toda sprint que criar endpoints deve atualizar a documentação correspondente.