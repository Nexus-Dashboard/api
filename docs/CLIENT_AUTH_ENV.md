# Variáveis de ambiente — módulo de clientes (SESC / SENAC)

Estas variáveis são **exclusivas** do módulo `/api/clients`. Nenhuma delas
altera o comportamento das rotas da Secom (`/api/auth`, `/api/users`,
`/api/data`, `/api/migration`, `/api/maintenance`, `/api/google`).

Sem `MONGODB_URI_CLIENTS` e `CLIENT_JWT_SECRET` o módulo simplesmente não
funciona — e falha com mensagem explícita, em vez de degradar em silêncio.

## Obrigatórias

### `MONGODB_URI_CLIENTS`

URI completa do banco de autenticação dos clientes, **incluindo o nome do
database**.

**Não é um cluster novo.** É um *database* novo dentro do cluster que já
existe — o mesmo que hoje hospeda `telephonic` e `f2f`. No Atlas cobra-se por
cluster, não por database, então isto não gera custo adicional algum. Na
prática, só muda o nome depois da barra na URI:

```
mongodb+srv://USUARIO:SENHA@cluster0.XXXXXXX.mongodb.net/f2f?...             <- o que a Secom já usa
mongodb+srv://USUARIO:SENHA@cluster0.XXXXXXX.mongodb.net/nexus_clients?...   <- este módulo
```

Mesma credencial, mesmo cluster, mesmo custo. O database é criado sozinho no
primeiro `save()` — não é preciso criá-lo à mão no Atlas.

```
MONGODB_URI_CLIENTS=mongodb+srv://USUARIO:SENHA@cluster0.XXXXXXX.mongodb.net/nexus_clients?retryWrites=true&w=majority
```

O nome do database precisa bater com `CLIENTS_DB_NAME`. Se a URI apontar para
`f2f`, `test` ou qualquer outro banco, `config/clientDb.js` **aborta antes de
qualquer escrita** — essa trava existe justamente para o caso de um erro de
digitação fazer a conexão cair no fallback do `dbManager`.

### Por que um database separado, e não uma collection dentro do `f2f`

As duas formas são seguras: uma collection nova nunca encosta nas collections
existentes. O que decide é **backup e restore** — com database separado, um
restore do `f2f` (ver `scripts/restore-rounds-1-43.js`) não arrasta nem apaga
os 54 acessos dos clientes. Como o custo é idêntico, vale a separação.

### `CLIENT_JWT_SECRET`

Segredo de assinatura dos tokens de cliente. **Precisa ser diferente do
`JWT_SECRET` da Secom** — é o que garante que um token da Secom nunca abra
uma rota de cliente e vice-versa. Se os dois forem iguais, o módulo lança um
erro em runtime em vez de subir.

Gerar com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Opcionais (têm default)

| Variável | Default | Para que serve |
|---|---|---|
| `CLIENTS_DB_NAME` | `nexus_clients` | Nome esperado do database. A conexão é recusada se o banco conectado tiver outro nome. |
| `CLIENT_JWT_EXPIRES_IN` | `8h` | Validade do token. Curta de propósito: não há lista de revogação para verificadores offline. |
| `CLIENT_JWT_ISSUER` | `nexus-api` | Claim `iss`. |
| `CLIENT_JWT_AUDIENCE` | `nexus-clients` | Claim `aud`. Segunda barreira contra reuso cruzado de token. |
| `CLIENT_AUTH_RATE_LIMIT` | `10` | Tentativas de login por IP a cada 15 min. Ver a ressalva abaixo. |

## Exemplo completo

```
MONGODB_URI_CLIENTS=mongodb+srv://.../nexus_clients?retryWrites=true&w=majority
CLIENTS_DB_NAME=nexus_clients
CLIENT_JWT_SECRET=<gerado com o comando acima>
CLIENT_JWT_EXPIRES_IN=8h
CLIENT_JWT_ISSUER=nexus-api
CLIENT_JWT_AUDIENCE=nexus-clients
```

Na Vercel, cadastrar as mesmas variáveis em *Settings → Environment
Variables*. O `vercel.json` não precisa de alteração: a rota catch-all
`/(.*)` já entrega `/api/clients/*`.

## Ressalva sobre o rate limit

`CLIENT_AUTH_RATE_LIMIT` usa o store em memória do `express-rate-limit`, que
na Vercel é **por instância de lambda** — cada instância fria tem o próprio
contador. Trate-o como uma conveniência, não como um controle de segurança.

A proteção real contra força bruta é o **lockout gravado no MongoDB**
(`loginAttempts` / `lockUntil` em `models/ClientUser.js`): 5 tentativas
erradas bloqueiam a conta por 15 minutos, e esse estado é compartilhado entre
todas as instâncias. O admin destrava com
`POST /api/clients/users/:id/unlock`.

Os 15 minutos são deliberadamente mais curtos que as 2 horas usadas para os
usuários da Secom: aqui os logins são públicos por construção (`sesc-sp` é
adivinhável), então um bloqueio longo viraria um jeito fácil de derrubar o
acesso de um estado inteiro.

## Primeiro acesso

Não existe rota pública de registro. O primeiro admin é criado por script:

```bash
node scripts/create-client-admin.js
```

Depois dele, os 27 acessos estaduais de cada cliente saem do seeder — que é
**dry-run por padrão**:

```bash
node scripts/seed-client-users.js --client=sesc                            # simula
node scripts/seed-client-users.js --client=sesc --client=senac --confirm   # cria os 54
```

O seeder grava as senhas iniciais num CSV/JSON **fora do repositório git**
(`../../docs` por padrão). São senhas em texto claro: distribua por canal
seguro e apague os arquivos em seguida. Todos os acessos nascem com
`mustChangePassword = true`.
