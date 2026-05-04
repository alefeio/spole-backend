# Sprint 06 — Event participants e bookings

## 1. Objetivo da sprint
Implementar o fluxo de participação em eventos, cobrindo inscrição em eventos gratuitos e reserva temporária de vagas em eventos pagos, com bloqueio por tempo limitado e proteção contra dupla compra.

## 2. Problema que esta sprint resolve
Após a Sprint 05, o sistema já possui eventos em local livre e eventos em arena, mas ainda não permite que usuários se inscrevam de forma consistente. Esta sprint cria a base transacional da participação, separando inscrição gratuita de booking temporário para eventos pagos.

## 3. Escopo da sprint

### Inclui
- criação de `EventParticipant`
- inscrição em evento gratuito
- criação de booking temporário para evento pago
- uso de Redis com TTL oficial de 30 minutos
- bloqueio temporário da vaga durante o booking
- expiração automática do booking
- prevenção de dupla compra da mesma vaga sob concorrência
- leitura das inscrições do usuário autenticado
- leitura dos participantes de um evento pelo organizador
- cancelamento de inscrição, quando permitido pela regra básica da sprint
- testes automatizados compatíveis com o escopo

### Não inclui
- confirmação financeira por gateway
- webhook de pagamento
- split financeiro
- reembolso completo
- antifraude avançado
- fila de espera
- check-in
- seat map
- busca avançada com Elasticsearch
- recorrência de booking

## 4. Módulos afetados
- `src/modules/event-participants/`
- `src/modules/bookings/`
- `src/modules/events/`
- `src/modules/payments/` apenas se necessário para preparar contratos mínimos, sem fluxo completo
- `src/shared/cache/redis/`
- `src/shared/middleware/`

## 5. Dependências
- Sprint 03 funcional
- Sprint 05 funcional
- autenticação e ownership funcionando
- Redis operacional
- eventos com capacidade e tipo definidos corretamente

## 6. Regras de negócio desta sprint
1. Usuários podem se inscrever em eventos gratuitos sem fluxo de booking temporário.
2. Eventos gratuitos geram `EventParticipant` confirmado diretamente.
3. Eventos pagos devem passar por booking temporário antes da confirmação final.
4. O TTL oficial do booking é de 30 minutos.
5. Enquanto o booking estiver ativo, a vaga deve ficar indisponível para outros usuários.
6. Se o booking expirar sem conclusão, a vaga volta à disponibilidade.
7. O sistema deve impedir dupla compra da mesma última vaga.
8. Usuário não pode possuir duas inscrições confirmadas para o mesmo evento.
9. Usuário não pode criar múltiplos bookings ativos conflitantes para o mesmo evento, salvo estratégia explicitamente permitida.
10. Apenas eventos `PUBLISHED` e compatíveis com participação podem aceitar inscrição.
11. Eventos privados devem respeitar as mesmas regras de acesso já definidas no domínio de eventos.
12. O organizador do evento deve poder visualizar os participantes do próprio evento.
13. O participante deve poder visualizar as próprias inscrições e bookings quando aplicável.
14. Nesta sprint, booking reservado não confirma compra definitiva; ele apenas segura a vaga até a sprint de payments.
15. A contagem de vagas deve considerar participantes confirmados e bookings ativos, conforme a estratégia implementada.

## 7. Entidades e tabelas envolvidas
- `EventParticipant`
- `Booking`
- `Event`
- `Payment` apenas como dependência futura, sem fluxo completo obrigatório nesta sprint

## 8. Endpoints esperados

### POST /events/:eventId/participants/free
**Descrição:** inscreve o usuário autenticado em um evento gratuito.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Request**
```json
{}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "eventId": "uuid",
    "userId": "uuid",
    "status": "CONFIRMED"
  }
}
```

**Erros esperados**
- 401 não autenticado
- 404 evento não encontrado
- 409 usuário já inscrito
- 409 evento sem vagas
- 422 evento incompatível com inscrição gratuita

### POST /events/:eventId/bookings
**Descrição:** cria um booking temporário para um evento pago.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Request**
```json
{}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "eventId": "uuid",
    "userId": "uuid",
    "status": "RESERVED",
    "expiresAt": "2026-05-10T20:30:00.000Z"
  }
}
```

**Erros esperados**
- 401 não autenticado
- 404 evento não encontrado
- 409 evento sem vagas
- 409 booking conflitante
- 422 evento incompatível com booking

### GET /users/me/participants
**Descrição:** lista as inscrições do usuário autenticado.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

### GET /users/me/bookings
**Descrição:** lista os bookings do usuário autenticado.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

### GET /events/:eventId/participants
**Descrição:** lista participantes de um evento.

**Auth:** sim  
**Perfis permitidos:** dono do evento, admin

### PATCH /bookings/:id/cancel
**Descrição:** cancela um booking ativo do usuário.

**Auth:** sim  
**Perfis permitidos:** dono do booking, admin

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

## 9. Fluxo funcional
1. Usuário autenticado escolhe um evento.
2. Sistema valida se o evento pode receber participação.
3. Se o evento for gratuito:
   - cria `EventParticipant`
   - confirma imediatamente
4. Se o evento for pago:
   - cria `Booking`
   - grava reserva temporária em Redis com TTL de 30 minutos
   - bloqueia a vaga temporariamente
5. Usuário pode consultar seu estado de participação ou booking.
6. Se o booking expirar, a vaga volta à disponibilidade.
7. Se o booking for cancelado manualmente, a vaga também volta à disponibilidade.

## 10. Critérios de aceite
- [x] Usuário consegue se inscrever em evento gratuito com vaga disponível
- [x] Sistema impede inscrição gratuita duplicada no mesmo evento
- [x] Sistema impede inscrição quando não há vagas
- [x] Usuário consegue criar booking em evento pago com vaga disponível
- [x] Booking é criado com TTL de 30 minutos
- [x] Booking bloqueia a vaga temporariamente
- [x] Sistema impede dupla disputa da última vaga
- [x] Booking expirado devolve a vaga à disponibilidade
- [x] Usuário consegue cancelar o próprio booking
- [x] Organizador consegue listar participantes do próprio evento
- [x] Usuário consegue listar suas próprias inscrições e bookings

## 11. Critérios técnicos
- [x] Estrutura modular de `event-participants` criada
- [x] Estrutura modular de `bookings` criada
- [x] Integração com Redis implementada para TTL
- [x] Regras de concorrência tratadas no fluxo de booking
- [x] Tratamento de erro padronizado
- [x] Ownership e autorização aplicados
- [x] Testes automatizados cobrindo fluxos principais
- [x] Testes executáveis localmente

## 12. Riscos e cuidados
- permitir overbooking por falha de concorrência
- contar vagas de forma inconsistente entre participantes confirmados e bookings ativos
- permitir múltiplos bookings conflitantes para o mesmo usuário/evento
- acoplar demais booking com payment antes da sprint de payments
- tratar Redis apenas como cache e não como parte do controle transacional temporário

## 13. Observações para o Cursor
1. Não implementar gateway de pagamento nesta sprint.
2. Não confirmar compra financeira definitiva nesta sprint.
3. Não implementar webhook de pagamento.
4. Não implementar split, reembolso completo ou chargeback.
5. Todo endpoint novo deve sair com testes automatizados compatíveis com o escopo.
6. Os fluxos de booking devem respeitar a `testing-strategy.md`, incluindo testes de concorrência ou de comportamento equivalente quando aplicável.