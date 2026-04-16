# Spolê — Architecture Overview

## 1. Estratégia arquitetural
O Spolê seguirá uma abordagem API-first.

A primeira versão não será construída como um conjunto completo de microsserviços independentes. Em vez disso, será criada uma API Node.js única, organizada por módulos de domínio, com separação interna suficiente para permitir extração futura de serviços especializados.

## 2. Arquitetura inicial recomendada

### Componentes
- API Node.js
- PostgreSQL
- Redis
- Docker
- DigitalOcean

### Papel de cada componente

#### API Node.js
Responsável por expor endpoints REST, aplicar autenticação e autorização, validar regras de negócio e coordenar persistência.

#### PostgreSQL
Fonte principal de verdade transacional do sistema.

#### Redis
Usado para:
- reserva temporária de compra com TTL
- cache de leitura
- chaves auxiliares de concorrência

#### Docker
Usado para empacotamento e padronização de ambientes.

#### DigitalOcean
Ambiente inicial de hospedagem dos containers e serviços do MVP.

## 3. Organização por domínio
A API deve ser organizada por módulos de negócio.

### Módulos iniciais
- auth
- users
- categories
- events
- arenas
- spaces
- slots
- reservations
- bookings
- payments
- notifications
- admin

## 4. Fluxos arquiteturais principais

### 4.1 Leitura de evento
1. Cliente chama o endpoint.
2. A API valida autenticação, quando necessário.
3. A API busca em cache, se aplicável.
4. Em caso de cache miss, consulta o PostgreSQL.
5. Retorna a resposta e atualiza o cache quando fizer sentido.

### 4.2 Compra de vaga ou ingresso
1. O usuário inicia a compra.
2. O sistema verifica a disponibilidade.
3. O sistema cria uma reserva temporária em Redis com TTL de 30 minutos.
4. O pagamento deve ser concluído dentro do TTL.
5. Se o pagamento for confirmado, a vaga vira confirmada e indisponível.
6. Se expirar, a vaga volta à disponibilidade.

### 4.3 Reserva de slot de arena
1. O organizador escolhe um slot disponível.
2. O sistema valida as regras da arena.
3. Cria a reserva do horário.
4. Após confirmação do pagamento mínimo, a reserva é confirmada.
5. O organizador usa a reserva para criar o evento.

## 5. Arquitetura alvo futura
Quando houver validação suficiente, a arquitetura pode evoluir para:
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

## 6. Estratégia de evolução

### Fase 1
API única modular.

### Fase 2
Extração do Booking Service, se a concorrência de compra justificar.

### Fase 3
Extração do Search Service com Elasticsearch.

### Fase 4
CDC com Debezium, Kafka e Worker para sincronização do índice.

## 7. Decisões arquiteturais obrigatórias
1. Não iniciar com microsserviços completos.
2. Não usar Elasticsearch antes da necessidade real da sprint correspondente.
3. Toda lógica crítica deve ficar encapsulada em domínio próprio.
4. PostgreSQL permanece como fonte de verdade.
5. Redis não substitui persistência; apenas acelera leitura e controla reserva temporária.
6. A separação futura de serviços deve reaproveitar os mesmos contratos de domínio.