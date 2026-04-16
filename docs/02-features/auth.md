# Feature Spec — Auth

## 1. Resumo
Autenticação de usuários da plataforma, com cadastro, login e acesso ao próprio perfil.

## 2. Objetivo
Permitir que usuários acessem rotas protegidas e que a API reconheça identidade e permissões.

## 3. Atores envolvidos
- Participante
- Organizador
- Arena
- Administrador

## 4. Regras de negócio
1. Todo usuário deve possuir e-mail único.
2. Senha deve ser armazenada de forma segura.
3. O token de autenticação deve identificar usuário e role.
4. Usuários suspensos não podem autenticar normalmente.

## 5. Fluxo principal
1. Usuário se cadastra.
2. Sistema valida dados.
3. Sistema cria conta.
4. Usuário faz login.
5. Sistema retorna token.
6. Usuário acessa rotas protegidas.

## 6. Fluxos alternativos

### 6.1 Cadastro com role padrão
Usuários entram como `user` por padrão, salvo processo interno diferente.

### 6.2 Atualização posterior de role
Role de `arena_owner` ou `admin` pode ser atribuída em fluxo separado.

## 7. Fluxos de exceção

### 7.1 E-mail já cadastrado
- condição: e-mail já existe
- resultado esperado: erro 409

### 7.2 Senha inválida
- condição: senha incorreta
- resultado esperado: erro 401

### 7.3 Token inválido
- condição: token ausente, expirado ou inválido
- resultado esperado: erro 401

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
- role
- status

## 10. Estado e transições

### User status
- ACTIVE
- SUSPENDED
- INACTIVE

## 11. Entradas
- nome
- e-mail
- senha
- telefone opcional

## 12. Saídas
- token JWT
- dados básicos do usuário

## 13. Validações
- e-mail válido;
- senha com regras mínimas;
- unicidade do e-mail;
- role controlada internamente.

## 14. Regras de concorrência
Não há disputa crítica relevante nesta feature.

## 15. Regras de persistência
- salvar usuário;
- salvar hash da senha;
- atualizar perfil quando necessário.

## 16. Regras de cache
Não obrigatório no início.

## 17. Erros esperados
- 400 dados inválidos
- 401 credenciais inválidas
- 403 usuário bloqueado
- 409 e-mail já existe

## 18. Critérios de aceite
- [ ] Usuário consegue se cadastrar
- [ ] Usuário consegue fazer login
- [ ] Token permite acessar rota protegida
- [ ] E-mail duplicado é bloqueado
- [ ] Senha não é salva em texto puro

## 19. Fora do escopo
- autenticação social
- MFA
- recuperação de senha por e-mail, se não estiver na sprint correspondente