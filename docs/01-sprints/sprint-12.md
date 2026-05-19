# Sprint 12 — Segurança operacional, rate limiting e idempotência de cliente

## 1. Objetivo da sprint
Aumentar a segurança operacional e a robustez da API do Spolê para uso real, reduzindo risco de abuso, duplicidade por reenvio do cliente e baixa rastreabilidade em fluxos críticos.

## 2. Problema que esta sprint resolve
Após a Sprint 11, o Spolê já possui:
- fluxos principais do MVP funcionando
- payments de eventos e reservas
- notificações
- busca, cache e CI
- camada admin com auditoria mínima

Mas ainda faltam mecanismos importantes de proteção e resiliência:
- proteção contra abuso em endpoints sensíveis
- prevenção de duplicidade por reenvio do cliente
- rastreabilidade ponta a ponta por request
- hardening mínimo de execução para ambiente real

Sem isso, o sistema funciona, mas fica mais vulnerável a:
- brute force em auth
- spam em busca/listagens públicas
- duplicação por double click/retry do cliente
- dificuldade de rastrear falhas entre logs

## 3. Escopo da sprint

### Inclui
- middleware de request id / correlation id
- inclusão de request id nos logs e respostas
- rate limiting em endpoints prioritários
- idempotência por chave do cliente em endpoints críticos de criação
- persistência mínima de chaves de idempotência
- hardening de respostas e logs em fluxos sensíveis
- documentação operacional mínima das novas proteções
- testes automatizados compatíveis com o escopo

### Não inclui
- WAF
- antifraude avançado
- captcha
- circuit breaker distribuído
- tracing distribuído completo
- observabilidade full-stack
- política avançada de bloqueio geográfico
- firewall de aplicação externo
- proteção DDoS dedicada
- dashboard completo de observabilidade

## 4. Módulos afetados
- `src/shared/middleware/`
- `src/shared/logger/`
- `src/shared/env/`
- `src/modules/auth/`
- `src/modules/bookings/`
- `src/modules/payments/`
- `src/modules/reservations/`
- `src/modules/events/`, apenas nos pontos públicos necessários
- `src/modules/admin/`, apenas se algum log/contexto precisar de ajuste
- persistência de idempotência mínima, se adotada em banco

## 5. Dependências
- Sprint 07 concluída
- Sprint 10 concluída
- Sprint 11 concluída
- logs básicos já existentes
- payments e reservations já estabilizados
- autenticação e ownership funcionando

## 6. Regras de negócio desta sprint
1. Endpoints sensíveis devem ter proteção contra abuso por rate limiting.
2. Endpoints críticos de criação financeira ou transacional devem aceitar idempotência de cliente.
3. Reenvio do mesmo request com a mesma chave de idempotência não pode duplicar efeito.
4. O sistema deve conseguir correlacionar logs de uma mesma requisição.
5. Request id deve estar presente em logs e resposta, quando aplicável.
6. A sprint não deve alterar a regra central dos fluxos de negócio já concluídos.
7. A sprint deve priorizar proteção e rastreabilidade, não novos produtos.
8. Logs não devem expor segredos, tokens ou dados sensíveis além do necessário.
9. Rate limiting deve ser calibrado por tipo de endpoint, não igual para tudo.
10. Falha em componente de idempotência não pode gerar duplicidade silenciosa.

## 7. Entidades e tabelas envolvidas
- `IdempotencyKey` ou estrutura equivalente mínima, se persistida
- `User`, apenas por contexto de auth
- `Booking`
- `Payment`
- `Reservation`
- `ReservationOccurrence`

## 8. Endpoints e fluxos prioritários desta sprint

### Rate limiting obrigatório
- `POST /auth/login`
- `POST /auth/register`
- `GET /events`
- `POST /events/:eventId/bookings`
- `POST /bookings/:bookingId/payments`
- `POST /reservations/:reservationId/payments`
- `POST /reservation-occurrences/:occurrenceId/payments`
- webhooks de pagamento, com estratégia adequada e sem quebrar provedores legítimos

### Idempotência obrigatória
- `POST /events/:eventId/bookings`
- `POST /bookings/:bookingId/payments`
- `POST /reservations/:reservationId/payments`
- `POST /reservation-occurrences/:occurrenceId/payments`

## 9. Fluxo funcional
1. Cliente chama endpoint crítico com `Idempotency-Key`.
2. Sistema verifica se a chave já foi usada naquele contexto.
3. Se não foi usada:
   - processa a operação
   - persiste o resultado ou referência mínima
4. Se já foi usada:
   - retorna resposta idempotente
   - não duplica efeito colateral
5. Toda requisição recebe um request id.
6. Logs críticos passam a carregar o mesmo identificador para rastreio.

## 10. Critérios de aceite
- [x] Request id é gerado e propagado nos fluxos principais
- [x] Logs críticos incluem request id
- [x] Rate limiting existe nos endpoints prioritários
- [x] Tentativas excessivas em auth são limitadas corretamente
- [x] Busca pública suporta proteção básica contra abuso
- [x] Endpoints críticos aceitam `Idempotency-Key`
- [x] Reenvio com a mesma chave não duplica booking
- [x] Reenvio com a mesma chave não duplica payment
- [ ] Reenvio com a mesma chave não duplica payment de reserva *(coberto pela mesma camada; teste E2E de reserva pendente em sprint futura se necessário)*
- [x] Testes automatizados cobrem rate limiting e idempotência

## 11. Critérios técnicos
- [x] Middleware de request id implementado
- [x] Middleware ou serviço de rate limit implementado
- [x] Camada de idempotência implementada sem acoplamento excessivo
- [x] Tratamento de erro padronizado
- [x] Logs revisados sem vazamento de dados sensíveis
- [x] Testes executáveis localmente
- [x] Sem quebrar fluxos das sprints anteriores

## 12. Riscos e cuidados
- bloquear usuários legítimos por rate limit mal calibrado
- usar a mesma estratégia de rate limit para endpoints com perfis muito diferentes
- implementar idempotência de forma frágil e ainda permitir duplicidade
- acoplar idempotência demais aos serviços de domínio
- tornar logs mais verbosos e inseguros
- quebrar integrações externas com rate limit agressivo em webhook

## 13. Observações para o Cursor
1. Não implementar antifraude avançado nesta sprint.
2. Não implementar observabilidade distribuída completa nesta sprint.
3. Não transformar isso em projeto de infraestrutura puro; deve haver impacto operacional real na API.
4. Toda proteção nova deve vir com testes automatizados.
5. Rate limiting de webhook deve ser tratado com cuidado para não prejudicar o provedor legítimo.