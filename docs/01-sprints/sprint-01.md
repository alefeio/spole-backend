# Sprint 01 — Infraestrutura base da API

## 1. Objetivo da sprint
Subir a base técnica do backend do Spolê com Docker, PostgreSQL, Redis e um servidor Node.js funcional, pronto para rodar localmente e preparado para deploy posterior na DigitalOcean.

## 2. Problema que esta sprint resolve
Sem infraestrutura base funcionando, não é possível iniciar desenvolvimento de autenticação, eventos, reservas e compra.

## 3. Escopo da sprint

### Inclui
- criação do projeto Node.js da API
- Dockerfile da aplicação
- docker-compose.yml
- serviço da API
- serviço PostgreSQL
- serviço Redis
- variáveis de ambiente
- conexão com PostgreSQL
- conexão com Redis
- endpoint `/health`
- estrutura base de módulos
- lint e formatter básicos

### Não inclui
- autenticação completa
- CRUD de eventos
- pagamentos
- reservas de arena
- booking com TTL de negócio

## 4. Módulos afetados
- `src/`
- `src/shared/`
- arquivos de configuração da aplicação
- `Dockerfile`
- `docker-compose.yml`
- `README.md`

## 5. Dependências
- Sprint 00 concluída
- stack já definida

## 6. Regras de negócio desta sprint
1. Esta sprint não implementa regras de negócio do domínio, apenas infraestrutura.
2. A API deve subir com dependências mínimas operacionais.
3. O Redis deve estar pronto para uso futuro, mas sem lógica de booking nesta sprint.

## 7. Entidades e tabelas envolvidas
Podem existir estruturas técnicas, mas sem schema de domínio completo obrigatório nesta sprint.

## 8. Endpoints esperados

### GET /health
**Descrição:** verifica se a API está operacional.

**Auth:** não  
**Perfis permitidos:** público

**Response 200**
```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

**Erros esperados**
- 500 se a aplicação estiver inconsistente

## 9. Fluxo funcional
1. Subir containers.
2. API inicializa.
3. Conecta no PostgreSQL.
4. Conecta no Redis.
5. Responde ao healthcheck.

## 10. Critérios de aceite
- [ ] Projeto Node.js criado
- [ ] Dockerfile criado
- [ ] docker-compose.yml criado
- [ ] API sobe com um único comando
- [ ] PostgreSQL conecta
- [ ] Redis conecta
- [ ] Endpoint `/health` responde 200
- [ ] README explica como subir o ambiente

## 11. Critérios técnicos
- [ ] Estrutura modular criada
- [ ] Variáveis de ambiente organizadas
- [ ] Logs básicos aplicados
- [ ] Tratamento mínimo de erro de bootstrap
- [ ] testes automatizados compatíveis com o escopo
- [ ] testes executáveis localmente

## 12. Riscos e cuidados
- acoplamento indevido entre módulos
- configuração quebrada de Docker
- dependências desnecessárias cedo demais

## 13. Observações para o Cursor
1. Não implementar autenticação nem domínio de eventos ainda.
2. Não antecipar schema completo do domínio nesta sprint.
3. Priorizar simplicidade e ambiente funcional.
4. Todo endpoint novo deve sair com testes
5. Toda correção relevante deve incluir regressão, quando aplicável