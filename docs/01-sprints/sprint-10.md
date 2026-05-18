# Sprint 10 — Pagamento da reserva de arena e recorrência simples

## 1. Objetivo da sprint
Implementar o pagamento da reserva de slots de arena e a base operacional da recorrência simples, permitindo que o organizador confirme financeiramente a reserva do espaço e que o sistema trate corretamente a continuidade ou liberação de ocorrências futuras.

## 2. Problema que esta sprint resolve
Após a Sprint 09, o Spolê já cobre:
- eventos em local livre
- eventos em arena
- bookings de vagas
- payments de ingressos/vagas
- notificações básicas

Mas ainda falta uma parte central do modelo de negócio:
- o pagamento da própria reserva do espaço da arena
- o controle mínimo de recorrência futura com prazo e liberação do slot quando não houver pagamento

Sem isso, o fluxo financeiro da arena ainda está incompleto.

## 3. Escopo da sprint

### Inclui
- criação de pagamento para reserva de arena
- vínculo do pagamento com `Reservation`
- confirmação da reserva mediante pagamento válido
- uso do módulo de payments também para `Reservation`
- webhook/confirmador idempotente para pagamento da reserva
- extensão do domínio para recorrência simples semanal
- geração de ocorrência futura mínima quando a reserva for recorrente
- definição de prazo para pagamento da próxima ocorrência
- liberação do slot futuro quando a ocorrência não for paga no prazo
- testes automatizados compatíveis com o escopo

### Não inclui
- split financeiro para arena
- repasse automático
- marketplace complexo
- reembolso completo da reserva
- múltiplos gateways reais
- motor completo de recorrência avançada
- painel financeiro avançado
- notificações complexas de cobrança
- agenda externa sincronizada

## 4. Módulos afetados
- `src/modules/reservations/`
- `src/modules/payments/`
- `src/modules/slots/`
- `src/modules/arenas/`
- `src/shared/middleware/`
- persistência de `Reservation`, `ReservationOccurrence` e `Payment`

## 5. Dependências
- Sprint 05 concluída
- Sprint 07 concluída
- autenticação e ownership funcionando
- arena, spaces, slots e reservations já operacionais
- provider de pagamento já abstraído para fluxo de payments

## 6. Regras de negócio desta sprint
1. Reserva de arena pode exigir pagamento para confirmação.
2. Um pagamento aprovado deve confirmar a `Reservation`.
3. O pagamento da reserva deve ser idempotente.
4. Um mesmo pagamento não pode confirmar a mesma reserva duas vezes.
5. Uma reserva recorrente deve gerar ao menos a próxima ocorrência futura.
6. Cada ocorrência futura deve ter prazo próprio de pagamento.
7. Se a ocorrência futura não for paga até 24 horas antes, o slot deve voltar à disponibilidade.
8. A arena não cria o evento; ela continua apenas disponibilizando o slot.
9. O organizador continua sendo o responsável pela reserva e pelo evento associado.
10. Nesta sprint, a recorrência será apenas semanal e simples.
11. O pagamento da reserva não deve quebrar o fluxo já existente de payment para ingresso/vaga.

## 7. Entidades e tabelas envolvidas
- `Reservation`
- `ReservationOccurrence`
- `Payment`
- `ArenaSlot`

## 8. Endpoints esperados

### POST /reservations/:reservationId/payments
**Descrição:** cria pagamento pendente para uma reserva válida.

**Auth:** sim  
**Perfis permitidos:** dono da reserva, admin

### POST /reservation-payments/webhook
**Descrição:** confirma pagamento da reserva por integração externa.

**Auth:** não via JWT  
**Proteção:** segredo/assinatura do provedor

### GET /reservations/:id
**Descrição:** retorna detalhes da reserva, incluindo estado financeiro e recorrência mínima, quando existir.

### GET /reservations/me
**Descrição:** pode ser ajustado para refletir estados recorrentes e financeiros, mantendo o contrato atual ou evoluindo com documentação.

## 9. Fluxo funcional
1. Organizador cria reserva de slot.
2. Sistema cria pagamento pendente para a reserva.
3. Provedor confirma pagamento.
4. Sistema marca a reserva como confirmada.
5. Se a reserva for recorrente, o sistema cria a próxima ocorrência.
6. A próxima ocorrência fica aguardando pagamento até o prazo.
7. Se o prazo expirar, o slot futuro é liberado.

## 10. Critérios de aceite
- [x] Usuário consegue criar pagamento pendente para reserva válida
- [x] Pagamento aprovado confirma a reserva
- [x] Webhook repetido não duplica efeitos
- [x] Reserva recorrente semanal mínima pode gerar próxima ocorrência
- [x] Ocorrência não paga até 24h antes libera o slot
- [x] Fluxo de reserva não quebra payments já existentes de evento pago
- [x] Testes automatizados cobrem confirmação e não pagamento
- [x] Documentação mínima é atualizada

## 11. Critérios técnicos
- [x] Integração de payments com reservations sem acoplamento excessivo
- [x] Idempotência implementada
- [x] Atualização consistente de slot e ocorrência
- [x] Testes executáveis localmente
- [x] Sem quebrar sprints anteriores
- [x] Regras de recorrência simples bem delimitadas

## 12. Riscos e cuidados
- misturar demais payment de ingresso com payment de reserva
- duplicar confirmação em webhook repetido
- liberar slot errado em recorrência
- abrir escopo demais tentando resolver marketplace completo
- criar recorrência complexa cedo demais

## 13. Observações para o Cursor
1. Não implementar split nesta sprint.
2. Não transformar isso em motor completo de assinaturas.
3. Não antecipar múltiplos gateways reais.
4. Priorizar fluxo mínimo e seguro de reserva paga + recorrência semanal simples.
5. Todo endpoint novo deve sair com testes automatizados compatíveis com o escopo.