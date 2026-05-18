# Sprint 11 — Admin operacional, moderação e auditoria

## 1. Objetivo da sprint
Dar à operação do Spolê uma camada mínima de controle administrativo, moderação e rastreabilidade, permitindo gerenciar usuários, arenas, eventos, reservas, pagamentos e notificações sem depender de acesso direto ao banco.

## 2. Problema que esta sprint resolve
Após a Sprint 10, o núcleo transacional do MVP está funcional:
- auth
- eventos
- categorias
- arenas, spaces e slots
- reservations
- bookings
- payments de eventos
- payments de reservas de arena
- recorrência simples
- notificações
- busca, cache e CI mínima

Mas ainda falta uma camada importante para operação real:
- gestão administrativa
- moderação de recursos problemáticos
- suspensão/bloqueio controlado
- trilha de auditoria
- ferramentas de suporte interno

Sem isso, o produto funciona, mas a operação do negócio fica frágil.

## 3. Escopo da sprint

### Inclui
- endpoints administrativos protegidos por `admin`
- listagem administrativa de usuários
- listagem administrativa de arenas
- listagem administrativa de eventos
- listagem administrativa de reservations
- listagem administrativa de bookings
- listagem administrativa de payments
- leitura detalhada administrativa desses recursos
- mudança de status de usuários (`ACTIVE`, `SUSPENDED`, `INACTIVE`)
- suspensão e reativação de arenas
- suspensão/cancelamento administrativo de eventos, quando aplicável
- trilha mínima de auditoria para ações críticas de admin
- filtros básicos em listagens administrativas
- paginação consistente nos endpoints administrativos priorizados
- testes automatizados compatíveis com o escopo

### Não inclui
- dashboard analítico completo
- BI
- relatórios financeiros avançados
- antifraude avançado
- RBAC complexo com múltiplos níveis administrativos
- sistema de tickets de suporte
- moderação assistida por IA
- exportação massiva de relatórios
- backoffice visual completo no frontend

## 4. Módulos afetados
- `src/modules/admin/`
- `src/modules/users/`
- `src/modules/arenas/`
- `src/modules/events/`
- `src/modules/reservations/`
- `src/modules/bookings/`
- `src/modules/payments/`
- `src/modules/notifications/`, apenas se necessário para refletir ações administrativas
- `src/shared/middleware/`
- `src/shared/logger/`

## 5. Dependências
- Sprint 02 concluída
- Sprint 05 concluída
- Sprint 07 concluída
- Sprint 09 concluída
- Sprint 10 concluída
- autenticação e role `admin` funcionando
- paginação e contratos de resposta estabilizados

## 6. Regras de negócio desta sprint
1. Apenas usuários com role `admin` podem acessar os endpoints administrativos desta sprint.
2. Ações administrativas críticas devem gerar trilha mínima de auditoria.
3. O admin pode consultar recursos do sistema sem depender de ownership.
4. O admin pode suspender usuários.
5. O admin pode suspender arenas.
6. O admin pode cancelar ou bloquear eventos em situações operacionais válidas.
7. O admin não deve quebrar a consistência dos fluxos financeiros ao agir sobre recursos já concluídos.
8. Toda ação administrativa mutável deve ser rastreável com:
   - quem executou
   - qual recurso foi afetado
   - qual ação foi realizada
   - quando ocorreu
9. A sprint deve priorizar controle operacional, não automação complexa.
10. Mudanças administrativas devem respeitar os estados válidos do domínio.

## 7. Entidades e tabelas envolvidas
- `User`
- `Arena`
- `Event`
- `Reservation`
- `Booking`
- `Payment`
- `Notification`, se algum reflexo for implementado
- `AuditLog` ou estrutura equivalente mínima

## 8. Endpoints esperados

### GET /admin/users
**Descrição:** lista usuários com filtros básicos e paginação.

**Auth:** sim  
**Perfis permitidos:** admin

### GET /admin/users/:id
**Descrição:** retorna detalhes administrativos de um usuário.

### PATCH /admin/users/:id/status
**Descrição:** altera status do usuário.

**Request**
```json
{
  "status": "SUSPENDED",
  "reason": "violação de regras operacionais"
}
```

### GET /admin/arenas
**Descrição:** lista arenas com filtros e paginação.

### PATCH /admin/arenas/:id/status
**Descrição:** altera status da arena.

### GET /admin/events
**Descrição:** lista eventos com filtros e paginação.

### PATCH /admin/events/:id/status
**Descrição:** altera status administrativo do evento, dentro das regras válidas.

### GET /admin/reservations
**Descrição:** lista reservas com filtros e paginação.

### GET /admin/bookings
**Descrição:** lista bookings com filtros e paginação.

### GET /admin/payments
**Descrição:** lista payments com filtros e paginação.

### GET /admin/audit-logs
**Descrição:** lista logs administrativos mínimos.

## 9. Fluxo funcional
1. Admin autenticado acessa listagens operacionais.
2. Sistema retorna recursos paginados e filtráveis.
3. Admin escolhe um recurso problemático.
4. Admin executa ação permitida.
5. Sistema aplica a ação.
6. Sistema registra auditoria.
7. Operação consegue revisar o histórico da ação posteriormente.

## 10. Critérios de aceite
- [x] Admin consegue listar usuários com paginação
- [x] Admin consegue alterar status de usuário
- [x] Admin consegue listar arenas com paginação
- [x] Admin consegue alterar status de arena
- [x] Admin consegue listar eventos com paginação
- [x] Admin consegue executar ação administrativa válida sobre evento
- [x] Admin consegue listar reservations, bookings e payments
- [x] Endpoints administrativos não ficam acessíveis para usuários comuns
- [x] Ações críticas de admin geram auditoria mínima
- [x] Testes automatizados cobrem acessos, bloqueios e auditoria

## 11. Critérios técnicos
- [x] Estrutura modular de `admin` criada
- [x] Paginação consistente nos endpoints administrativos priorizados
- [x] Filtros básicos implementados
- [x] Middleware de autorização aplicado corretamente
- [x] Auditoria mínima persistida ou registrada de forma confiável
- [x] Tratamento de erro padronizado
- [x] Testes executáveis localmente
- [x] Sem quebrar sprints anteriores

## 12. Riscos e cuidados
- abrir escopo demais e tentar construir um backoffice completo
- permitir ação administrativa sem trilha de auditoria
- quebrar fluxos financeiros ao suspender/cancelar recursos
- criar estados administrativos incompatíveis com estados do domínio
- expor dados sensíveis além do necessário
- tornar a camada admin um atalho para “editar qualquer coisa” sem regra

## 13. Observações para o Cursor
1. Não implementar dashboard analítico nesta sprint.
2. Não criar um sistema completo de suporte/tickets.
3. Não ampliar RBAC além do necessário; `admin` basta para esta entrega.
4. Toda ação mutável de admin deve gerar auditoria mínima.
5. Todo endpoint novo deve sair com testes automatizados compatíveis com o escopo.