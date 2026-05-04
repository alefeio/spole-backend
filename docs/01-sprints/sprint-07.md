# Sprint 07 — Payments e confirmação da compra

## 1. Objetivo da sprint
Implementar o fluxo de pagamento dos bookings de eventos pagos, garantindo confirmação da compra por integração externa, idempotência no processamento e criação ou confirmação do participante no evento após pagamento aprovado.

## 2. Problema que esta sprint resolve
Após a Sprint 06, o sistema já cria bookings temporários para eventos pagos, mas ainda não conclui a compra. Sem a camada de payments, o booking apenas bloqueia a vaga por tempo limitado, sem transformar isso em participação efetiva no evento.

## 3. Escopo da sprint

### Inclui
- criação da entidade `Payment`
- criação de pagamento pendente para um booking válido
- integração inicial com gateway ou provedor externo em nível de contrato
- endpoint de criação de pagamento
- endpoint de webhook ou confirmação externa
- validação de idempotência do processamento do pagamento
- confirmação do booking após pagamento aprovado
- criação ou confirmação de `EventParticipant` no fluxo de evento pago
- bloqueio de duplicidade de compra
- registro de valor bruto, taxa e valor líquido
- registro de referência externa da transação
- testes automatizados compatíveis com o escopo

### Não inclui
- split financeiro avançado
- repasse automático para organizador
- repasse para arena
- reembolso completo
- chargeback completo
- antifraude avançado
- múltiplos gateways simultâneos
- conciliação financeira avançada
- dashboard financeiro completo
- fila de espera
- check-in

## 4. Módulos afetados
- `src/modules/payments/`
- `src/modules/bookings/`
- `src/modules/event-participants/`
- `src/modules/events/`
- `src/shared/middleware/`
- persistência da entidade `Payment`
- possível ajuste pontual em `src/shared/env/` para configurações do provedor

## 5. Dependências
- Sprint 06 concluída
- bookings funcionando com Redis e `expires_at`
- autenticação e ownership funcionando
- eventos pagos com booking operacional
- Redis e PostgreSQL funcionando corretamente
- documentação de payments disponível em `docs/02-features/payments.md`

## 6. Regras de negócio desta sprint
1. Apenas bookings válidos e ainda ativos podem gerar pagamento.
2. O pagamento nasce em estado `PENDING`.
3. O pagamento deve ficar vinculado a um booking e ao usuário autenticado.
4. Um mesmo booking não pode gerar múltiplas compras efetivas.
5. A confirmação do pagamento deve ser idempotente.
6. Webhooks repetidos ou confirmações duplicadas não podem duplicar efeitos no domínio.
7. Quando o pagamento for aprovado:
   - o booking deve ser concluído
   - o participante do evento deve ser criado ou confirmado
   - a vaga deve permanecer definitivamente ocupada
8. Quando o pagamento falhar, for cancelado ou expirar:
   - o booking não deve ser confirmado
   - a vaga não deve se tornar compra efetiva
9. O sistema deve registrar:
   - valor bruto
   - taxa
   - valor líquido
   - provedor
   - referência externa
10. O pagamento não substitui o booking; ele o conclui.
11. O sistema deve impedir que pagamento aprovado seja processado duas vezes.
12. Se o booking já estiver expirado, o pagamento não deve concluir a compra.
13. O `EventParticipant` de evento pago deve passar a existir ou ser confirmado somente após pagamento aprovado.
14. Nesta sprint, o pagamento pode ser tratado por um contrato simples de gateway, sem implementar toda a complexidade financeira futura.

## 7. Entidades e tabelas envolvidas
- `Payment`
- `Booking`
- `EventParticipant`
- `Event`

## 8. Endpoints esperados

### POST /bookings/:bookingId/payments
**Descrição:** cria um pagamento pendente para um booking válido.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Request**
```json
{
  "method": "PIX",
  "provider": "mock-provider"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "bookingId": "uuid",
    "status": "PENDING",
    "method": "PIX",
    "provider": "mock-provider",
    "grossAmount": 10,
    "feeAmount": 1,
    "netAmount": 9
  }
}
```

**Erros esperados**
- 401 não autenticado
- 403 booking de outro usuário
- 404 booking não encontrado
- 409 booking incompatível com pagamento
- 422 regra de domínio inválida

### POST /payments/webhook
**Descrição:** recebe confirmação externa do gateway e atualiza o estado do pagamento.

**Auth:** não via JWT  
**Proteção:** validação de assinatura/token do provedor, conforme estratégia adotada

**Request**
```json
{
  "providerReference": "external-transaction-id",
  "status": "PAID"
}
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "status": "processed"
  }
}
```

**Erros esperados**
- 400 payload inválido
- 403 webhook inválido
- 404 pagamento não encontrado
- 409 conflito de estado
- 422 regra de domínio inválida

### GET /users/me/payments
**Descrição:** lista os pagamentos do usuário autenticado.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

### GET /payments/:id
**Descrição:** retorna detalhes de um pagamento.

**Auth:** sim  
**Perfis permitidos:** dono do pagamento, admin

## 9. Fluxo funcional
1. Usuário autenticado possui um booking ativo de evento pago.
2. Usuário inicia a criação do pagamento.
3. Sistema valida o booking.
4. Sistema cria o registro `Payment` com status `PENDING`.
5. Sistema registra dados financeiros e referência do provedor.
6. Gateway ou provedor externo confirma o pagamento via webhook.
7. Sistema valida o webhook e garante idempotência.
8. Sistema marca o pagamento como `PAID`.
9. Sistema conclui o booking.
10. Sistema cria ou confirma `EventParticipant` do usuário naquele evento.
11. O usuário passa a estar efetivamente confirmado no evento pago.

## 10. Critérios de aceite
- [x] Usuário consegue criar pagamento pendente para booking válido
- [x] Sistema impede pagamento para booking inválido ou expirado
- [x] Sistema registra `grossAmount`, `feeAmount` e `netAmount`
- [x] Sistema registra a referência externa da transação
- [x] Webhook válido consegue confirmar pagamento
- [x] Pagamento aprovado conclui o booking
- [x] Pagamento aprovado cria ou confirma `EventParticipant`
- [x] Pagamento repetido não duplica efeitos
- [x] Usuário não consegue pagar booking de outro usuário
- [x] Usuário consegue listar os próprios pagamentos

## 11. Critérios técnicos
- [x] Estrutura modular de `payments` criada
- [x] Regras de idempotência implementadas
- [x] Integração com `bookings` feita sem acoplamento excessivo
- [x] Integração com `event-participants` feita sem quebrar a Sprint 06
- [x] Tratamento de erro padronizado
- [x] Ownership e autorização aplicados
- [x] Testes automatizados cobrindo fluxos principais
- [x] Testes executáveis localmente

## 12. Riscos e cuidados
- processar o mesmo pagamento duas vezes
- confirmar compra com booking expirado
- criar participante duplicado para evento pago
- acoplar demais payment ao gateway específico
- tratar webhook sem validação mínima
- inconsistência entre status financeiro e status do booking

## 13. Observações para o Cursor
1. Não implementar split financeiro nesta sprint.
2. Não implementar chargeback completo ou reembolso completo.
3. Não antecipar antifraude avançado.
4. Não alterar o comportamento central da Sprint 06 além do necessário para concluir a compra paga.
5. Todo endpoint novo deve sair com testes automatizados compatíveis com o escopo.
6. Os testes devem cobrir idempotência e confirmação repetida de pagamento.