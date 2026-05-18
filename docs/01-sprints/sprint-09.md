# Sprint 09 — Notifications básicas, paginação autenticada e hardening operacional

## 1. Objetivo da sprint
Melhorar a experiência operacional e de uso da API do Spolê com notificações básicas, paginação consistente em endpoints autenticados prioritários, observabilidade mínima mais útil e pequenos hardenings nos fluxos já entregues.

## 2. Problema que esta sprint resolve
Após a Sprint 08, o núcleo funcional do MVP está sólido, mas ainda faltam elementos importantes de maturidade:
- usuários não têm uma base consistente de notificações de eventos importantes
- algumas listagens autenticadas ainda não seguem paginação padronizada
- logs e rastreabilidade ainda podem melhorar para operação real
- é necessário consolidar contratos e pequenos ajustes sem abrir um novo domínio grande

## 3. Escopo da sprint

### Inclui
- módulo básico de notificações
- persistência de notificações
- listagem de notificações do usuário autenticado
- marcação de notificação como lida
- criação de notificações em eventos operacionais prioritários
- paginação consistente em endpoints autenticados prioritários
- revisão de contratos de listagem autenticada
- melhoria de logs operacionais em fluxos críticos
- documentação operacional mínima de observabilidade e execução
- testes automatizados compatíveis com o escopo

### Não inclui
- envio de e-mail
- envio de push notification real
- fila assíncrona de notificações
- preferências avançadas de notificação
- centro de mensagens complexo
- WebSocket
- observabilidade completa com tracing distribuído
- dashboards completos
- antifraude
- novas regras centrais de negócio

## 4. Módulos afetados
- `src/modules/notifications/`
- `src/modules/users/`
- `src/modules/bookings/`, apenas se necessário para geração de notificações
- `src/modules/payments/`, apenas se necessário para geração de notificações
- `src/modules/events/`, apenas se necessário para geração de notificações
- `src/shared/logger/`
- `src/shared/middleware/`
- documentação e arquivos operacionais relacionados

## 5. Dependências
- Sprint 06 concluída
- Sprint 07 concluída
- Sprint 08 concluída
- autenticação funcional
- ownership funcional
- contratos principais da API estabilizados

## 6. Regras de negócio desta sprint
1. Toda notificação pertence a um usuário.
2. Notificações devem ser persistidas no banco.
3. Notificações podem ser listadas pelo próprio usuário autenticado.
4. Apenas o dono da notificação pode marcá-la como lida, salvo admin em fluxo excepcional.
5. Notificações desta sprint são informativas e internas à plataforma.
6. A criação de notificações deve ocorrer apenas em eventos prioritários já existentes no sistema.
7. A paginação nesta sprint deve ser obrigatória em listagens autenticadas priorizadas.
8. A sprint não deve alterar a regra central dos fluxos de bookings, payments ou events.
9. Logs devem aumentar rastreabilidade sem expor dados sensíveis.
10. Caso algum endpoint autenticado continue sem paginação por decisão consciente, isso deve ficar documentado explicitamente.

## 7. Entidades e tabelas envolvidas
- `Notification`
- `User`
- `Payment`, quando a notificação for disparada por pagamento aprovado
- `Booking`, quando a notificação for disparada por booking cancelado ou expirado, se entrar no escopo
- `Event`, quando a notificação depender do contexto do evento

## 8. Endpoints esperados

### GET /users/me/notifications
**Descrição:** lista notificações do usuário autenticado com paginação.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Query params esperados**
- `page`
- `limit`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Pagamento confirmado",
      "message": "Sua vaga foi confirmada no evento.",
      "type": "PAYMENT_CONFIRMED",
      "readAt": null,
      "createdAt": "2026-05-20T18:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1
  }
}
```

### PATCH /notifications/:id/read
**Descrição:** marca uma notificação como lida.

**Auth:** sim  
**Perfis permitidos:** dono da notificação, admin

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "readAt": "2026-05-20T18:05:00.000Z"
  }
}
```

### GET /users/me/bookings
**Descrição:** ajustar para paginação consistente, se entrar no escopo priorizado.

### GET /users/me/payments
**Descrição:** ajustar para paginação consistente, se entrar no escopo priorizado.

## 9. Fluxo funcional
1. Um evento operacional relevante acontece no sistema.
2. A API cria uma notificação para o usuário afetado.
3. O usuário autenticado lista suas notificações.
4. O usuário marca uma ou mais notificações como lidas.
5. Listagens autenticadas priorizadas retornam `meta` consistente.
6. Logs operacionais passam a registrar eventos importantes com mais clareza.

## 10. Eventos prioritários para notificação nesta sprint
A sprint deve focar apenas em eventos já existentes e relevantes. Sugestões prioritárias:
- pagamento aprovado
- booking cancelado pelo próprio usuário
- reserva de arena cancelada, se o fluxo já existir e for estável
- evento cancelado pelo organizador, se houver impacto direto em participantes

> A implementação deve priorizar poucos gatilhos bem definidos, em vez de tentar notificar tudo.

## 11. Critérios de aceite
- [x] Usuário consegue listar as próprias notificações com paginação
- [x] Usuário consegue marcar a própria notificação como lida
- [x] Usuário não consegue marcar notificação de outro usuário
- [x] Sistema cria notificações em eventos prioritários escolhidos para esta sprint (pagamento aprovado; cancelamento de booking pelo próprio usuário)
- [x] Endpoints autenticados priorizados ficam com paginação consistente (`/users/me/notifications`, `/users/me/bookings`, `/users/me/payments`)
- [x] Contratos de listagem autenticada ficam alinhados ao padrão da API
- [x] Logs dos fluxos críticos priorizados ficam mais claros
- [x] Testes automatizados cobrem notificações e paginação autenticada
- [x] Documentação operacional mínima é atualizada

**Fora da paginação obrigatória (decisão Sprint 09):** `GET /users/me/participants` permanece retornando apenas `data` (array), sem `meta` — ver `README.md`.

## 12. Critérios técnicos
- [x] Estrutura modular de `notifications` criada
- [x] Persistência de notificações implementada
- [x] Ownership aplicado no acesso e leitura de notificações
- [x] Paginação implementada nos endpoints autenticados priorizados
- [x] Tratamento de erro padronizado
- [x] Logs revisados sem vazamento de dados sensíveis
- [x] Testes executáveis localmente
- [x] Sem quebrar comportamento das sprints anteriores

## 13. Riscos e cuidados
- abrir escopo demais tentando criar um sistema completo de mensageria
- acoplar notificações demais aos módulos de domínio
- gerar notificações duplicadas em fluxos idempotentes
- paginar endpoints autenticados de forma inconsistente
- aumentar logs sem estratégia mínima de utilidade
- expor dados sensíveis em mensagens ou logs

## 14. Observações para o Cursor
1. Não implementar e-mail ou push real nesta sprint.
2. Não criar fila assíncrona de notificações nesta sprint.
3. Não criar WebSocket nesta sprint.
4. Priorizar poucos gatilhos de notificação bem definidos.
5. Toda listagem autenticada alterada deve vir com testes automatizados.
6. Toda decisão de não paginar algum endpoint priorizado deve ficar documentada explicitamente.