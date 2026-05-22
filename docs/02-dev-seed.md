# Seed de desenvolvimento/homologação

O projeto possui um seed previsível para testar manualmente os fluxos já implementados. Ele aplica as migrações pendentes, limpa as tabelas de domínio com `TRUNCATE ... CASCADE` e recria uma massa coerente do zero.

> Não execute em produção. O script recusa `NODE_ENV=production`, mas ainda assim ele foi pensado apenas para desenvolvimento e homologação.

## Como executar

```bash
npm run db:seed:dev
```

Para conferir a massa já carregada no banco via `console.log` / `console.table`:

```bash
npm run db:seed:dev:list
```

Pré-requisitos:
- `.env` configurado conforme `.env.example`
- PostgreSQL acessível
- migrações do projeto válidas

Se o seu `.env` tiver **apenas** as variáveis do Postgres (comum em dev), o script ainda preenche automaticamente, quando ausentes: `JWT_SECRET`, `PAYMENTS_WEBHOOK_SECRET` e `REDIS_HOST=localhost` — só para satisfazer `loadEnv()` (o seed não usa Redis nem JWT). Valores explícitos no `.env` **nunca** são sobrescritos.

## Usuários de teste

Senha padrão para todos: `SpoleDev123!`

| Papel | E-mail |
| --- | --- |
| Admin | `admin@spole.dev` |
| Arena owner 1 | `arena1@spole.dev` |
| Arena owner 2 | `arena2@spole.dev` |
| Organizador 1 | `org1@spole.dev` |
| Organizador 2 | `org2@spole.dev` |
| Organizador 3 | `org3@spole.dev` |
| Usuário comum 1 | `user1@spole.dev` |
| Usuário comum 2 | `user2@spole.dev` |
| Usuário comum 3 | `user3@spole.dev` |
| Usuário comum 4 | `user4@spole.dev` |
| Usuário comum 5 | `user5@spole.dev` |
| Usuário comum 6 | `user6@spole.dev` |
| Usuário suspenso | `suspended@spole.dev` |
| Usuário inativo | `inactive@spole.dev` |

## Principais cenários

- Auth: login admin, arena owners, organizadores, usuários comuns, usuário `SUSPENDED` e usuário `INACTIVE`.
- Busca pública: eventos com termos como `futebol`, `corrida`, `pedal`, `funcional`, `beach`.
- Categorias: futebol, vôlei, beach tennis, corrida, ciclismo, funcional, personal trainer e basquete inativa.
- Arenas: uma ativa com recorrência e pagamento mínimo, uma ativa com pagamento mínimo `0%`, uma `INACTIVE`.
- Spaces e slots: slots `AVAILABLE`, `HOLD`, `RESERVED` e `CANCELLED`, com e sem recorrência.
- Reservations: `PENDING`, `CONFIRMED`, `CANCELLED`, `CONSUMED`, recorrente, auto-confirmada por pagamento mínimo `0%` e reservas vinculadas a eventos.
- Recorrência: reserva semanal ativa com ocorrências `PENDING_PAYMENT`, `CONFIRMED`, `RELEASED` e `CANCELLED`.
- Eventos: públicos gratuitos e pagos, privados com código, eventos em arena, evento cancelado e draft.
- Participação: usuário inscrito em evento gratuito, evento quase lotado e eventos lotados.
- Bookings: `RESERVED`, `COMPLETED`, `EXPIRED` e `CANCELLED`.
- Payments: contextos de booking, reservation e reservation occurrence, com status `PENDING`, `PAID`, `FAILED` e `CANCELLED`.
- Notifications: `PAYMENT_CONFIRMED` e `BOOKING_CANCELLED`, lidas e não lidas.
- Admin: audit logs para alteração de usuário, alteração de arena e cancelamento administrativo de evento.
- Paginação: usuários como `user4`, `user5`, `user6` e `org2` possuem histórico suficiente para testar listagens autenticadas.

## Estratégia de reset

O seed não depende de dados manuais existentes. A cada execução:
1. aplica migrações pendentes;
2. executa uma transação;
3. limpa tabelas de domínio em ordem segura com `TRUNCATE ... CASCADE`;
4. recria a massa seguindo a ordem de dependências do domínio;
5. confirma a transação.

Se qualquer etapa falhar, a transação é revertida.
