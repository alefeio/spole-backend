# Feature Spec — Categories

## 1. Resumo
Gestão das categorias de eventos da plataforma, permitindo organizar os eventos por modalidade, atividade ou tipo de experiência.

## 2. Objetivo
Permitir que eventos sejam classificados de forma consistente, facilitando criação, filtragem, busca e navegação no catálogo público.

## 3. Atores envolvidos
- Participante
- Organizador
- Administrador
- Sistema

## 4. Regras de negócio
1. Toda categoria representa um agrupamento lógico de eventos.
2. Eventos devem estar vinculados a uma categoria válida.
3. Apenas administradores podem criar, editar, ativar, inativar ou remover categorias.
4. Categorias ativas podem ser usadas na criação de eventos.
5. Categorias inativas não devem ser aceitas para novos eventos.
6. O `slug` da categoria deve ser único.
7. A listagem pública deve exibir apenas categorias ativas, salvo necessidade administrativa.
8. A categoria pode possuir ícone e metadados visuais, mas isso não deve afetar a regra central do domínio.

## 5. Fluxo principal
1. Administrador cria uma categoria.
2. Sistema valida nome e slug.
3. Sistema persiste a categoria.
4. Organizador usa a categoria ao criar um evento.
5. Participantes podem ver categorias ativas no catálogo público.

## 6. Fluxos alternativos

### 6.1 Categoria inativada
Categoria deixa de ser usada em novos eventos, mas pode continuar associada a eventos antigos, conforme política da plataforma.

### 6.2 Categoria atualizada
Administrador atualiza nome, ícone ou status sem quebrar integridade dos eventos já cadastrados.

## 7. Fluxos de exceção

### 7.1 Slug duplicado
- condição: tentativa de criar ou editar categoria com slug já existente
- resultado esperado: erro 409

### 7.2 Usuário sem permissão
- condição: usuário não admin tenta criar ou editar categoria
- resultado esperado: erro 403

### 7.3 Categoria inexistente
- condição: id inexistente
- resultado esperado: erro 404

### 7.4 Categoria inativa usada em evento novo
- condição: organizador tenta criar evento usando categoria inativa
- resultado esperado: erro 422

## 8. Entidades envolvidas
- EventCategory
- Event

## 9. Campos relevantes

### EventCategory
- id
- name
- slug
- icon
- status
- createdAt
- updatedAt

## 10. Estado e transições

### Category status
- ACTIVE
- INACTIVE

### Transições válidas
- ACTIVE -> INACTIVE
- INACTIVE -> ACTIVE

## 11. Entradas
- name
- slug
- icon
- status

## 12. Saídas
- categoria criada
- categoria atualizada
- categoria listada
- categoria ativada ou inativada

## 13. Validações
- `name` obrigatório
- `slug` obrigatório
- `slug` único
- `status` dentro do enum permitido
- ícone opcional, quando adotado

## 14. Regras de concorrência
1. A principal regra de integridade é unicidade do slug.
2. Não há disputa crítica como em booking ou reservations.
3. Atualizações devem preservar consistência relacional com eventos.

## 15. Regras de persistência
- criar categoria
- atualizar categoria
- ativar ou inativar categoria
- listar categorias
- preservar vínculo com eventos existentes

## 16. Regras de cache
- categorias públicas podem ser cacheadas
- qualquer alteração de categoria deve invalidar cache relacionado
- criação ou inativação de categoria deve refletir na criação de eventos e filtros públicos

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 categoria não encontrada
- 409 conflito de slug
- 422 regra de domínio inválida

## 18. Critérios de aceite
- [x] Admin consegue criar categoria
- [x] Admin consegue editar categoria
- [x] Admin consegue ativar e inativar categoria
- [x] Categorias ativas podem ser listadas publicamente
- [x] Slug duplicado é bloqueado
- [x] Usuário sem permissão não consegue alterar categoria
- [x] Categoria inativa não pode ser usada para criar novo evento

## 19. Fora do escopo
- hierarquia de categorias
- categorias com múltiplos níveis
- taxonomia complexa
- recomendação baseada em categoria