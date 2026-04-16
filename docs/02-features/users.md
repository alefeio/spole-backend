# Feature Spec — Users

## 1. Resumo
Gestão dos usuários da plataforma, incluindo cadastro, leitura do próprio perfil, atualização de informações básicas e controle de papéis e status de acesso.

## 2. Objetivo
Permitir que a API tenha uma base consistente de identidade e perfil para participantes, organizadores, profissionais, donos de arena e administradores, sem misturar regras de autenticação com regras de dados do usuário.

## 3. Atores envolvidos
- Participante
- Organizador
- Profissional
- Arena
- Administrador

## 4. Regras de negócio
1. Todo usuário deve possuir uma conta única identificada por e-mail.
2. O usuário autenticado pode consultar e atualizar os próprios dados permitidos.
3. O perfil de organizador não precisa ser uma role separada no MVP; ele pode ser um comportamento do usuário.
4. O perfil de profissional pode ser representado por atributos complementares no perfil do usuário.
5. O papel `arena_owner` deve ser usado para usuários responsáveis por arenas.
6. O papel `admin` é exclusivo da operação interna da plataforma.
7. Alterações sensíveis de role e status não devem ser livres para o usuário comum.
8. Um usuário suspenso pode ter acesso limitado ou bloqueado conforme a política da plataforma.
9. O sistema deve manter consistência entre dados de autenticação e dados de perfil.
10. Dados básicos do usuário devem estar separados de preferências ou atributos complementares quando fizer sentido.

## 5. Fluxo principal
1. Usuário cria conta na plataforma.
2. Sistema cria o registro base do usuário.
3. Usuário autentica e acessa o próprio perfil.
4. Usuário atualiza dados permitidos, como nome, telefone, bio e cidade.
5. Admin pode consultar e gerenciar usuários quando necessário.

## 6. Fluxos alternativos

### 6.1 Usuário atua como organizador
O mesmo usuário comum cria eventos sem precisar trocar de role estrutural.

### 6.2 Usuário atua como profissional
O usuário adiciona dados complementares em perfil para se apresentar como personal, instrutor ou professor.

### 6.3 Usuário se torna dono de arena
A role ou vínculo apropriado é ajustado por fluxo controlado da plataforma.

## 7. Fluxos de exceção

### 7.1 Usuário não autenticado
- condição: tenta acessar `/users/me` ou atualizar perfil sem token
- resultado esperado: erro 401

### 7.2 Usuário tenta alterar campo não permitido
- condição: tenta editar role, status ou outro campo restrito
- resultado esperado: erro 403 ou 422

### 7.3 Usuário não encontrado
- condição: id inexistente em fluxo administrativo
- resultado esperado: erro 404

### 7.4 E-mail duplicado em atualização
- condição: usuário tenta atualizar e-mail para um já existente, se essa ação for permitida
- resultado esperado: erro 409

## 8. Entidades envolvidas
- User
- UserProfile

## 9. Campos relevantes

### User
- id
- name
- email
- passwordHash
- phone
- avatarUrl
- role
- status
- createdAt
- updatedAt

### UserProfile
- id
- userId
- bio
- city
- state
- birthDate
- gender
- professionalType

## 10. Estado e transições

### User role
- user
- arena_owner
- admin

### User status
- ACTIVE
- SUSPENDED
- INACTIVE

### Transições controladas
- ACTIVE -> SUSPENDED
- SUSPENDED -> ACTIVE
- ACTIVE -> INACTIVE
- INACTIVE -> ACTIVE

> Mudanças de role e status devem ser controladas por regras administrativas ou fluxos específicos.

## 11. Entradas
- nome
- e-mail
- telefone
- avatarUrl
- bio
- cidade
- estado
- data de nascimento, se adotado
- tipo profissional, se aplicável

## 12. Saídas
- dados básicos do usuário
- dados do perfil
- confirmação de atualização
- listagem administrativa, quando aplicável

## 13. Validações
- nome obrigatório em fluxos relevantes
- e-mail válido
- e-mail único
- telefone em formato aceitável, quando fornecido
- role somente alterável em fluxo autorizado
- status somente alterável em fluxo autorizado
- campos textuais com limites de tamanho

## 14. Regras de concorrência
1. Esta feature não possui concorrência crítica como bookings ou payments.
2. O cuidado principal é integridade de dados e unicidade de e-mail.
3. Atualizações simultâneas do perfil devem preservar consistência no banco.

## 15. Regras de persistência
- criar `User`
- criar `UserProfile` quando aplicável
- atualizar dados permitidos do usuário
- atualizar dados complementares do perfil
- restringir persistência de campos administrativos a fluxos autorizados

## 16. Regras de cache
- dados do próprio usuário podem ser cacheados pontualmente, se necessário
- qualquer atualização de perfil deve invalidar cache correspondente
- cache não deve ser usado como fonte primária de verdade para dados de identidade

## 17. Erros esperados
- 400 requisição inválida
- 401 não autenticado
- 403 sem permissão
- 404 usuário não encontrado
- 409 conflito de unicidade
- 422 regra de domínio inválida

## 18. Critérios de aceite
- [ ] Usuário autenticado consegue consultar o próprio perfil
- [ ] Usuário autenticado consegue atualizar os próprios dados permitidos
- [ ] Role não pode ser alterada por usuário comum
- [ ] Status não pode ser alterado por usuário comum
- [ ] E-mail permanece único
- [ ] Dados complementares do perfil podem ser persistidos quando aplicável
- [ ] Admin consegue consultar usuários em fluxo administrativo correspondente

## 19. Fora do escopo
- rede social interna
- preferências avançadas de recomendação
- configuração detalhada de privacidade
- verificação documental
- onboarding complexo
- autenticação social
- MFA