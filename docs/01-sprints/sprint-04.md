# Sprint 04 — Arenas, spaces e slots

## 1. Objetivo da sprint
Implementar o núcleo operacional de arenas, permitindo cadastrar arenas, cadastrar espaços internos e publicar slots disponíveis para futura reserva por organizadores.

## 2. Problema que esta sprint resolve
Sem o domínio de arenas e disponibilidade de horários, o Spolê ainda cobre apenas eventos em local livre. Esta sprint cria a base para o fluxo de reserva de espaços esportivos, que é parte central do produto.

## 3. Escopo da sprint

### Inclui
- cadastro de arenas
- leitura de detalhes de arena
- atualização de arena pelo owner ou admin
- cadastro de endereço da arena
- cadastro de política básica da arena
- cadastro de spaces da arena
- cadastro de slots disponíveis
- listagem de slots por arena e por espaço
- bloqueio de sobreposição de slots no mesmo espaço
- leitura de disponibilidade para uso futuro por organizadores
- testes automatizados compatíveis com o escopo

### Não inclui
- reserva efetiva do slot por organizador
- pagamento da reserva
- recorrência operacional completa
- criação de evento vinculada à reserva
- booking de ingressos
- payments de eventos
- Elasticsearch
- Kafka
- Debezium

## 4. Módulos afetados
- `src/modules/arenas/`
- `src/modules/spaces/`
- `src/modules/slots/`
- `src/shared/middleware/`
- persistência das entidades de arena, endereço, política, espaço e slot

## 5. Dependências
- Sprint 02 concluída
- autenticação funcional
- controle de roles funcional
- Sprint 03 funcional para manter padrão de domínio e testes

## 6. Regras de negócio desta sprint
1. A arena não cria evento no fluxo de aluguel; ela apenas cadastra estrutura e disponibilidade.
2. Cada arena deve possuir um owner responsável ou ser gerida por admin.
3. A arena pode possuir um ou mais spaces.
4. Cada slot pertence a um space.
5. Slots do mesmo space não podem se sobrepor.
6. Apenas owner da arena ou admin pode criar e editar arena, spaces e slots.
7. O slot pode possuir preço próprio e flag de recorrência permitida.
8. Slots disponíveis devem ficar legíveis para futura reserva, mas a reserva ainda não entra nesta sprint.
9. A política da arena deve permitir configuração mínima para antecedência e recorrência.

## 7. Entidades e tabelas envolvidas
- `Arena`
- `ArenaAddress`
- `ArenaPolicy`
- `ArenaSpace`
- `ArenaSlot`

## 8. Endpoints esperados

### POST /arenas
**Descrição:** cria uma arena.

**Auth:** sim  
**Perfis permitidos:** arena_owner, admin

**Request**
```json
{
  "name": "Arena Belém Sports",
  "description": "Arena com quadras e espaços multiuso",
  "phone": "91999999999",
  "email": "contato@arenabelem.com",
  "document": "12345678901234",
  "address": {
    "zipCode": "66000-000",
    "street": "Av. Exemplo",
    "number": "100",
    "district": "Centro",
    "city": "Belém",
    "state": "PA"
  },
  "policy": {
    "allowRecurring": true,
    "minAdvanceHours": 2,
    "minReservationPaymentPercent": 30
  }
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Arena Belém Sports",
    "status": "ACTIVE"
  }
}
```

### GET /arenas/:id
**Descrição:** retorna detalhes de uma arena.

**Auth:** não ou sim, conforme decisão da API  
**Perfis permitidos:** público ou autenticado, conforme política adotada

### PATCH /arenas/:id
**Descrição:** atualiza uma arena.

**Auth:** sim  
**Perfis permitidos:** owner da arena, admin

### POST /arenas/:arenaId/spaces
**Descrição:** cria um space dentro de uma arena.

**Auth:** sim  
**Perfis permitidos:** owner da arena, admin

### GET /arenas/:arenaId/spaces
**Descrição:** lista spaces de uma arena.

**Auth:** sim ou não, conforme política de leitura adotada

### POST /spaces/:spaceId/slots
**Descrição:** cria um slot disponível para um space.

**Auth:** sim  
**Perfis permitidos:** owner da arena, admin

**Request**
```json
{
  "startAt": "2026-04-25T18:00:00.000Z",
  "endAt": "2026-04-25T19:00:00.000Z",
  "price": 120,
  "allowsRecurring": true,
  "notes": "Horário noturno"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "AVAILABLE"
  }
}
```

### GET /spaces/:spaceId/slots
**Descrição:** lista slots de um space.

### GET /arenas/:arenaId/slots
**Descrição:** lista slots por arena, com filtros básicos de período.

## 9. Fluxo funcional
1. Usuário com role adequada cria uma arena.
2. Sistema persiste arena, endereço e política.
3. Owner cria um ou mais spaces.
4. Owner cria slots para esses spaces.
5. Sistema valida sobreposição e integridade.
6. Slots válidos ficam disponíveis para leitura e uso futuro em reservations.

## 10. Critérios de aceite
- [x] Owner ou admin consegue criar arena
- [x] Arena possui endereço persistido corretamente
- [x] Arena possui política básica persistida corretamente
- [x] Owner ou admin consegue criar spaces
- [x] Owner ou admin consegue criar slots
- [x] Sistema impede sobreposição de slots no mesmo space
- [x] Sistema lista slots por space
- [x] Sistema lista slots por arena
- [x] Usuário sem permissão não consegue editar ou criar estrutura em arena alheia

## 11. Critérios técnicos
- [x] Estrutura modular de arenas criada
- [x] Estrutura modular de spaces criada
- [x] Estrutura modular de slots criada
- [x] Validações de entrada aplicadas
- [x] Ownership e autorização aplicados
- [x] Tratamento de erro padronizado
- [x] Testes automatizados cobrindo fluxos principais
- [x] Testes executáveis localmente

## 12. Riscos e cuidados
- misturar reserva de slot com cadastro de disponibilidade nesta sprint
- permitir sobreposição de slot por falha de validação
- não respeitar ownership de arena
- acoplar demais slot com eventos antes da sprint apropriada

## 13. Observações para o Cursor
1. Não implementar reservations nesta sprint.
2. Não implementar payments nesta sprint.
3. Não implementar criação de evento vinculada a slot.
4. Não antecipar recorrência operacional completa.
5. Todo endpoint novo deve sair com testes automatizados compatíveis com o escopo.