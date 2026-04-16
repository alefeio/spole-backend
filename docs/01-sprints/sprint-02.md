# Sprint 02 — Autenticação e usuários

## 1. Objetivo da sprint
Implementar a autenticação básica da API do Spolê, permitindo cadastro, login, acesso a rotas protegidas e leitura do perfil autenticado.

## 2. Problema que esta sprint resolve
Sem autenticação, não é possível controlar identidade, permissões, ownership de recursos e segurança mínima para criação de eventos, reservas e operações administrativas.

## 3. Escopo da sprint

### Inclui
- cadastro de usuário
- login de usuário
- geração de token JWT
- middleware de autenticação
- middleware de autorização por role
- endpoint de perfil autenticado
- estrutura inicial das entidades `User` e `UserProfile`
- hash seguro de senha
- validações básicas de entrada
- tratamento de erros de autenticação

### Não inclui
- recuperação de senha
- autenticação social
- MFA
- gestão avançada de permissões
- painel administrativo
- cadastro de arena
- CRUD de eventos

## 4. Módulos afetados
- `src/modules/auth/`
- `src/modules/users/`
- `src/shared/middleware/`
- `src/shared/errors/`
- `src/shared/config/`
- persistência de usuários no banco

## 5. Dependências
- Sprint 01 concluída
- infraestrutura da API funcional
- PostgreSQL configurado
- padrão de JWT definido

## 6. Regras de negócio desta sprint
1. Todo usuário deve possuir e-mail único.
2. Senhas nunca podem ser armazenadas em texto puro.
3. O token JWT deve representar o usuário autenticado e sua role.
4. Usuários suspensos não podem autenticar normalmente.
5. Novos usuários entram com role padrão `user`, salvo regra administrativa futura.

## 7. Entidades e tabelas envolvidas
- `User`
- `UserProfile` opcional ou mínima estrutura inicial, conforme decisão técnica

## 8. Endpoints esperados

### POST /auth/register
**Descrição:** cria uma conta de usuário.

**Auth:** não  
**Perfis permitidos:** público

**Request**
```json
{
  "name": "Alexandre Feio",
  "email": "alexandre@email.com",
  "password": "SenhaSegura123",
  "phone": "91999999999"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Alexandre Feio",
    "email": "alexandre@email.com",
    "role": "user"
  }
}
```

**Erros esperados**
- 400 dados inválidos
- 409 e-mail já cadastrado

### POST /auth/login
**Descrição:** autentica um usuário e retorna token.

**Auth:** não  
**Perfis permitidos:** público

**Request**
```json
{
  "email": "alexandre@email.com",
  "password": "SenhaSegura123"
}
```

**Response 200**
```json
{
  "success": true,
  "data": {
    "token": "jwt-token",
    "user": {
      "id": "uuid",
      "name": "Alexandre Feio",
      "email": "alexandre@email.com",
      "role": "user"
    }
  }
}
```

**Erros esperados**
- 400 dados inválidos
- 401 credenciais inválidas
- 403 usuário bloqueado

### GET /users/me
**Descrição:** retorna os dados do usuário autenticado.

**Auth:** sim  
**Perfis permitidos:** user, arena_owner, admin

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Alexandre Feio",
    "email": "alexandre@email.com",
    "role": "user",
    "status": "ACTIVE"
  }
}
```

**Erros esperados**
- 401 token inválido ou ausente
- 403 usuário sem acesso

## 9. Fluxo funcional
1. Usuário envia dados de cadastro.
2. Sistema valida os dados.
3. Sistema verifica se o e-mail já existe.
4. Sistema cria o usuário com senha criptografada.
5. Usuário realiza login.
6. Sistema valida credenciais.
7. Sistema gera token JWT.
8. Usuário usa o token para acessar `/users/me`.

## 10. Critérios de aceite
- [ ] Usuário consegue se cadastrar
- [ ] E-mail duplicado é bloqueado
- [ ] Senha é armazenada com hash seguro
- [ ] Usuário consegue fazer login
- [ ] JWT é retornado após login válido
- [ ] Rota `/users/me` funciona com token válido
- [ ] Rota protegida bloqueia token ausente ou inválido

## 11. Critérios técnicos
- [ ] Estrutura modular de auth criada
- [ ] Estrutura modular de users criada
- [ ] Hash seguro de senha implementado
- [ ] JWT configurado corretamente
- [ ] Middleware de autenticação implementado
- [ ] Validações de entrada aplicadas
- [ ] Tratamento de erro padronizado
- [ ] testes automatizados compatíveis com o escopo
- [ ] testes executáveis localmente

## 12. Riscos e cuidados
- falha em hash de senha
- token mal configurado
- duplicidade de usuário por falta de constraint
- mistura de autenticação com regras de outros domínios

## 13. Observações para o Cursor
1. Não implementar recuperação de senha nesta sprint.
2. Não implementar autenticação social.
3. Não antecipar cadastro de arena nem CRUD de eventos.
4. Manter auth e users separados por domínio.
5. Todo endpoint novo deve sair com testes
6. Toda correção relevante deve incluir regressão, quando aplicável