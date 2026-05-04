# Sprint 05 — Reservations e vínculo do evento com arena

## 1. Objetivo da sprint
Implementar o fluxo básico de reserva de slots de arena por organizadores, garantindo que um slot disponível possa ser reservado sem conflito e usado para criação de evento vinculado à arena.

## 2. Problema que esta sprint resolve
Após a Sprint 04, o sistema já possui arenas, spaces e slots disponíveis, mas ainda não permite que um organizador transforme essa disponibilidade em um horário efetivamente reservado. Sem isso, o fluxo central de eventos em arena continua incompleto.

## 3. Escopo da sprint

### Inclui
- criação de reserva para slot disponível
- leitura de reservas do organizador
- leitura de reservas da arena
- cancelamento de reserva
- bloqueio de dupla reserva do mesmo slot
- vínculo de reserva com evento
- adaptação do módulo de eventos para aceitar `reservationId`
- criação de evento em arena apenas a partir de reserva válida
- atualização de status de slot conforme o estado da reserva
- testes automatizados compatíveis com o escopo

### Não inclui
- integração financeira completa da reserva
- gateway de pagamento para aluguel da arena
- recorrência operacional completa
- geração de ocorrências recorrentes
- liberação automática por inadimplência futura
- split financeiro
- bookings de ingressos
- payments de ingressos
- antifraude avançado

## 4. Módulos afetados
- `src/modules/reservations/`
- `src/modules/events/`
- `src/modules/slots/`
- `src/modules/arenas/`
- `src/shared/middleware/`
- persistência das entidades de reserva e ajustes nas entidades de evento e slot

## 5. Dependências
- Sprint 03 funcional
- Sprint 04 funcional
- autenticação e roles funcionando
- CRUD de eventos já existente
- arenas, spaces e slots já implementados

## 6. Regras de negócio desta sprint
1. A arena não cria o evento; ela apenas disponibiliza slots.
2. O organizador escolhe um slot disponível e cria uma reserva.
3. Um slot não pode ter mais de uma reserva ativa ao mesmo tempo.
4. Apenas slots com status `AVAILABLE` podem ser reservados.
5. A reserva deve ficar vinculada ao organizador que a criou.
6. O organizador só pode criar evento em arena usando uma reserva válida que pertença a ele.
7. Uma reserva usada para criar evento não deve poder ser reutilizada para outro evento incompatível.
8. Apenas o organizador dono da reserva ou admin pode cancelá-la.
9. A arena deve conseguir visualizar reservas relacionadas aos seus slots.
10. Nesta sprint, o fluxo financeiro do aluguel não será implementado; a reserva será tratada como fluxo operacional básico.
11. A recorrência não entra como comportamento operacional completo nesta sprint, mesmo que a entidade já exista no domínio.
12. O cancelamento de uma reserva deve devolver o slot à disponibilidade quando não houver vínculo impeditivo.

## 7. Entidades e tabelas envolvidas
- `Reservation`
- `ArenaSlot`
- `Event`
- `Arena`
- `ArenaSpace`

## 8. Endpoints esperados

### POST /reservations
**Descrição:** cria uma reserva para um slot disponível.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Request**
```json
{
  "slotId": "uuid",
  "type": "SINGLE"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "slotId": "uuid",
    "organizerId": "uuid",
    "type": "SINGLE",
    "status": "CONFIRMED"
  }
}
```

**Erros esperados**
- 401 não autenticado
- 404 slot não encontrado
- 409 slot indisponível
- 422 regra de domínio inválida

### GET /reservations/me
**Descrição:** lista reservas do organizador autenticado.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

### GET /arenas/:arenaId/reservations
**Descrição:** lista reservas relacionadas aos slots da arena.

**Auth:** sim  
**Perfis permitidos:** owner da arena, admin

### GET /reservations/:id
**Descrição:** retorna detalhes de uma reserva.

**Auth:** sim  
**Perfis permitidos:** dono da reserva, owner da arena correspondente, admin

### PATCH /reservations/:id/cancel
**Descrição:** cancela uma reserva.

**Auth:** sim  
**Perfis permitidos:** dono da reserva, admin

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

### POST /events
**Descrição:** cria evento, agora podendo aceitar `reservationId` quando o evento for em arena.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Request**
```json
{
  "categoryId": "uuid",
  "reservationId": "uuid",
  "title": "Futebol quarta à noite",
  "description": "Evento em quadra reservada",
  "type": "PAID",
  "visibility": "PUBLIC",
  "sourceType": "ARENA_RESERVATION",
  "status": "PUBLISHED",
  "capacity": 20,
  "pricePerPerson": 10
}
```

**Regras adicionais**
- o `reservationId` deve existir
- a reserva deve pertencer ao organizador autenticado
- a reserva deve estar em status válido
- o slot da reserva deve ser compatível com a criação do evento

## 9. Fluxo funcional
1. Organizador autenticado consulta slots disponíveis.
2. Escolhe um slot e cria uma reserva.
3. Sistema valida disponibilidade e ownership.
4. Sistema cria a reserva e atualiza o slot para estado compatível.
5. Organizador usa a reserva para criar um evento em arena.
6. Sistema valida o `reservationId` e cria o evento vinculado.
7. Se a reserva for cancelada antes do uso impeditivo, o slot volta à disponibilidade.

## 10. Critérios de aceite
- [ ] Organizador consegue reservar slot disponível
- [ ] Sistema impede reserva de slot indisponível
- [ ] Sistema impede dupla reserva do mesmo slot
- [ ] Organizador consegue listar as próprias reservas
- [ ] Arena consegue visualizar reservas dos próprios slots
- [ ] Organizador consegue cancelar a própria reserva
- [ ] Cancelamento devolve disponibilidade ao slot quando aplicável
- [ ] Organizador consegue criar evento em arena usando `reservationId` válido
- [ ] Usuário não consegue criar evento usando reserva de outro organizador
- [ ] Usuário sem permissão não consegue cancelar reserva alheia

## 11. Critérios técnicos
- [ ] Estrutura modular de reservations criada
- [ ] Regras de domínio de reserva isoladas
- [ ] Integração com events feita sem acoplamento excessivo
- [ ] Atualização consistente do status do slot
- [ ] Ownership e autorização aplicados
- [ ] Tratamento de erro padronizado
- [ ] Testes automatizados cobrindo fluxos principais
- [ ] Testes executáveis localmente

## 12. Riscos e cuidados
- misturar reserva operacional com pagamento completo cedo demais
- permitir que dois usuários reservem o mesmo slot por falha de concorrência
- permitir criação de evento com reserva de outro organizador
- não devolver disponibilidade do slot ao cancelar
- acoplar demais reservation e event a ponto de dificultar evolução futura

## 13. Observações para o Cursor
1. Não implementar gateway de pagamento da reserva nesta sprint.
2. Não implementar recorrência operacional completa.
3. Não implementar `ReservationOccurrence` como fluxo completo, salvo se estritamente necessário para consistência estrutural.
4. Não implementar bookings ou payments de ingresso nesta sprint.
5. Todo endpoint novo deve sair com testes automatizados compatíveis com o escopo.