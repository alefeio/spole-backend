# Spolê — Master Spec

## 1. Visão do produto
O Spolê é uma plataforma API-first para criação, descoberta, reserva e participação em eventos esportivos e de bem-estar.

A API deve servir:
- app mobile
- frontend web
- painel administrativo
- futuras integrações

O produto conecta:
- participantes
- organizadores
- profissionais
- donos de arena
- administradores da plataforma

## 2. Objetivo do MVP
Validar o modelo de negócio com um backend centralizado, permitindo:
- cadastro e autenticação de usuários
- criação e listagem de eventos
- pesquisa de eventos
- inscrição em eventos gratuitos
- compra de vagas e ingressos em eventos pagos
- cadastro de arenas e horários
- reserva de horários por organizadores
- reserva temporária com TTL para compra
- operação inicial em ambiente containerizado

## 3. Tipos de evento

### 3.1 Evento gratuito
Evento sem cobrança para o participante.

### 3.2 Evento pago
Evento com cobrança por vaga ou ingresso.

### 3.3 Evento em local livre
Evento criado sem depender de arena.

### 3.4 Evento em arena
Evento criado a partir de uma reserva de horário.

### 3.5 Evento público
Aparece nas listagens e pesquisas da plataforma.

### 3.6 Evento privado
Só pode ser acessado por link ou código.

## 4. Perfis de usuário

### 4.1 Participante
Usuário que navega e participa de eventos.

### 4.2 Organizador
Usuário que cria eventos e pode reservar horários em arenas.

### 4.3 Profissional
No MVP, tratado como organizador com atributos adicionais no perfil.

### 4.4 Arena
Dono ou gestor de espaço esportivo.

### 4.5 Administrador
Perfil interno da plataforma.

## 5. Regras de negócio obrigatórias
1. A arena não cria o evento no fluxo de aluguel; ela apenas disponibiliza horários.
2. O organizador reserva o horário da arena e publica o evento.
3. Eventos podem ser gratuitos ou pagos.
4. Eventos podem ser públicos ou privados.
5. Eventos privados exigem link ou código.
6. O sistema trabalha com vagas e capacidade, não com assentos numerados, no MVP.
7. O sistema não pode permitir inscrições acima da capacidade disponível.
8. Toda compra paga deve passar por reserva temporária.
9. O TTL oficial da reserva temporária é de 30 minutos.
10. Se o pagamento não for concluído dentro do TTL, a reserva expira automaticamente.
11. Após pagamento confirmado, a vaga deve ficar indisponível para outros usuários.
12. A plataforma cobra taxa sobre inscrições pagas.
13. No MVP, a arena não paga comissão sobre o aluguel do espaço.
14. Reservas recorrentes devem ser liberadas automaticamente se não forem pagas até 24h antes da ocorrência.
15. O PostgreSQL é a fonte de verdade transacional.
16. Redis será usado para reserva temporária e cache estratégico.

## 6. Escopo do MVP

### Entram no MVP
- autenticação e usuários
- categorias
- eventos
- arenas
- espaços
- slots e horários
- reservas de horário
- reservas temporárias de compra
- pagamentos
- notificações básicas
- admin básico
- Docker
- PostgreSQL
- Redis
- deploy na DigitalOcean

### Não entram no MVP inicial
- microsserviços completos desde a primeira entrega
- Kafka
- Debezium
- Elasticsearch
- chat interno
- sistema avançado de reputação
- seat map
- split avançado
- antifraude avançado

## 7. Arquitetura inicial
- Node.js
- API REST
- PostgreSQL
- Redis
- Docker
- DigitalOcean
- arquitetura modular por domínio

## 8. Arquitetura alvo
- API Gateway
- Event Service
- Booking Service
- Search Service
- Payment Service
- PostgreSQL
- Redis
- Elasticsearch
- Kafka
- Debezium
- Worker

## 9. Entidades principais
- User
- UserProfile
- Arena
- ArenaAddress
- ArenaSpace
- ArenaPolicy
- ArenaSlot
- Reservation
- ReservationRecurrence
- ReservationOccurrence
- EventCategory
- Event
- EventParticipant
- Booking
- Payment
- Notification
- PlatformSetting

## 10. Requisitos funcionais
- visualizar eventos
- pesquisar eventos
- visualizar detalhes do evento
- criar eventos
- inscrever-se em evento gratuito
- comprar vaga ou ingresso em evento pago
- cadastrar arena
- cadastrar espaços
- cadastrar slots
- reservar horários
- confirmar pagamentos
- liberar reservas expiradas

## 11. Requisitos não funcionais
- API containerizada
- baixa latência em leitura
- consistência na compra
- escalabilidade progressiva
- alta taxa de leitura
- uso de cache
- proteção básica contra abuso
- observabilidade mínima

## 12. Definition of Done global
Uma funcionalidade só é considerada pronta quando:
- respeita as regras de negócio
- possui validações mínimas
- foi documentada
- foi testada localmente
- não quebra o que já existe
- possui tratamento básico de erro
- atende os critérios de aceite da sprint

## 13. Restrições globais
1. Não antecipar arquitetura complexa sem necessidade da sprint.
2. Não criar abstrações prematuras.
3. Não sair do escopo definido.
4. Não alterar contratos de API sem atualizar a documentação.
5. Toda implementação deve obedecer o fluxo por sprint.