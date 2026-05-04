# Feature Spec — Events

## 1. Resumo
Gestão de eventos da plataforma, incluindo criação, edição, listagem, busca e visualização de detalhes.

## 2. Objetivo
Permitir que organizadores publiquem eventos e que participantes encontrem, consultem e, em sprints posteriores, participem desses eventos.

## 3. Atores envolvidos
- Participante
- Organizador
- Profissional
- Administrador

## 4. Regras de negócio
1. Eventos podem ser gratuitos ou pagos.
2. Eventos podem ser públicos ou privados.
3. Eventos privados exigem código ou link.
4. Eventos podem ser em local livre ou vinculados a uma reserva de arena.
5. Todo evento deve ter organizador, categoria, data de início, data de fim, local e capacidade.
6. Eventos pagos exigem valor por inscrição válido.
7. Eventos não podem aceitar inscrições acima da capacidade.
8. Eventos privados não devem aparecer na listagem pública.
9. Apenas o organizador do evento ou um admin pode editar ou cancelar o evento.
10. Eventos vinculados a arena exigem uma reserva válida, mas esse fluxo pode ficar para sprint específica.
11. O status do evento deve refletir seu ciclo de vida operacional.

## 5. Fluxo principal
1. Organizador autenticado cria um evento.
2. Sistema valida os dados recebidos.
3. Sistema persiste o evento.
4. Evento pode ser publicado.
5. Participantes visualizam eventos públicos na listagem.
6. Participantes acessam os detalhes do evento.

## 6. Fluxos alternativos

### 6.1 Evento privado
O organizador cria um evento privado e o sistema gera ou armazena um código de acesso.

### 6.2 Evento em arena
O organizador cria um evento vinculado a uma reserva válida de slot.

### 6.3 Evento salvo como rascunho
O evento pode ser salvo como `DRAFT` antes de ser publicado.

## 7. Fluxos de exceção

### 7.1 Capacidade inválida
- condição: `capacity <= 0`
- resultado esperado: erro 422

### 7.2 Evento pago sem preço
- condição: `type = PAID` e `pricePerPerson` ausente ou inválido
- resultado esperado: erro 422

### 7.3 Usuário sem permissão para editar
- condição: não é dono do evento nem admin
- resultado esperado: erro 403

### 7.4 Evento não encontrado
- condição: id inexistente
- resultado esperado: erro 404

### 7.5 Evento privado acessado sem autorização adequada
- condição: evento privado sendo acessado sem link ou permissão válida
- resultado esperado: erro 403

## 8. Entidades envolvidas
- Event
- EventCategory
- Reservation, quando o evento for em arena

## 9. Campos relevantes

### Event
- id
- organizerId
- categoryId
- reservationId
- title
- slug
- description
- type
- visibility
- sourceType
- status
- startAt
- endAt
- addressName
- street
- number
- district
- city
- state
- latitude
- longitude
- capacity
- pricePerPerson
- privateCode
- coverImageUrl
- createdAt
- updatedAt

### EventCategory
- id
- name
- slug
- icon
- status

## 10. Estado e transições

### Event status
- DRAFT
- PUBLISHED
- CANCELLED
- FINISHED

### Transições válidas
- DRAFT -> PUBLISHED
- PUBLISHED -> CANCELLED
- PUBLISHED -> FINISHED

## 11. Entradas
- categoryId
- title
- description
- type
- visibility
- sourceType
- status
- startAt
- endAt
- addressName
- street
- number
- district
- city
- state
- latitude
- longitude
- capacity
- pricePerPerson
- privateCode
- reservationId, quando aplicável

## 12. Saídas
- evento criado
- evento atualizado
- lista de eventos
- detalhes do evento
- confirmação de cancelamento lógico

## 13. Validações
- organizerId válido
- categoryId válido
- `capacity > 0`
- preço válido para evento pago
- `startAt < endAt`
- `privateCode` exigido ou gerado em eventos privados
- `reservationId` válido quando o evento for em arena
- `type` e `visibility` dentro dos enums aceitos

## 14. Regras de concorrência
1. A criação e edição do evento não são o ponto mais crítico de concorrência.
2. O cuidado principal nesta feature é integridade de ownership e consistência do status.
3. A concorrência crítica da capacidade acontecerá na sprint de inscrições e bookings.

## 15. Regras de persistência
- salvar evento
- atualizar evento
- cancelar logicamente evento
- listar eventos públicos
- filtrar eventos por parâmetros permitidos
- vincular a categoria
- vincular a reserva quando aplicável

## 16. Regras de cache
- listagens públicas podem ser cacheadas futuramente
- detalhes de evento podem ser cacheados
- qualquer alteração no evento deve invalidar caches relacionados

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 evento não encontrado
- 409 conflito de regra quando aplicável
- 422 regra de domínio inválida

## 18. Critérios de aceite
- [x] Organizador consegue criar evento gratuito
- [x] Organizador consegue criar evento pago com preço válido
- [x] Organizador consegue criar evento público
- [x] Organizador consegue criar evento privado
- [x] Participante consegue listar eventos públicos
- [x] Participante consegue visualizar detalhes de evento público
- [x] Evento privado não aparece na listagem pública
- [x] Organizador consegue editar o próprio evento
- [x] Organizador consegue cancelar logicamente o próprio evento
- [x] Usuário sem permissão não consegue editar evento de outro usuário

## 19. Fora do escopo
- compra de ingresso
- reserva temporária
- pagamento
- check-in
- notificações avançadas
- fila de espera
- recomendação personalizada