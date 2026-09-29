# Contrato do token de cliente (SESC / SENAC)

Documento para quem vai **servir os dados** de SESC e SENAC — a camada de
planilha/Excel ou a API que vier a substituí-la. A API Nexus autentica o
usuário e emite um token que carrega o escopo de visibilidade; cabe a você
respeitá-lo.

## O modelo de acesso, em uma frase

Cada um dos 27 estados tem um login próprio, por cliente. Um usuário estadual
pode ver **o dado nacional, o dado da região dele e o dado do estado dele** —
e nada de outros estados ou outras regiões.

## Como obter o token

```http
POST https://<api>/api/clients/auth/login
Content-Type: application/json

{ "identity": "sesc-sp", "password": "..." }
```

Resposta (200):

```jsonc
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 28800,
  "mustChangePassword": true,
  "user": { "id": "...", "client": "sesc", "login": "sp", "identity": "sesc-sp",
            "name": "SESC São Paulo", "role": "state_user",
            "uf": "SP", "region": "sudeste", "isActive": true },
  "scope": {
    "level": "state",
    "client": "sesc",
    "uf": "SP",
    "region": "sudeste",
    "scopes": ["data:national", "data:region", "data:state"],
    "allowed": { "national": true, "regions": ["sudeste"], "ufs": ["SP"] }
  }
}
```

## Claims do token

```jsonc
{
  "sub": "665f1a2b3c4d5e6f70819202",   // id do usuário
  "typ": "client",                      // discrimina de qualquer token da Secom
  "ver": 1,                             // versão deste contrato
  "client": "sesc",                     // "sesc" | "senac" | "nexus"
  "login": "sp",
  "identity": "sesc-sp",
  "name": "SESC São Paulo",
  "role": "state_user",                 // "state_user" | "nexus_admin"
  "uf": "SP",                           // null para nexus_admin
  "region": "sudeste",                  // null para nexus_admin
  "scopes": ["data:national", "data:region", "data:state"],
  "allowed": { "national": true, "regions": ["sudeste"], "ufs": ["SP"] },
  "iss": "nexus-api",
  "aud": "nexus-clients",
  "iat": 1757318400,
  "exp": 1757347200
}
```

Para um **admin da Nexus** (`role: "nexus_admin"`), `allowed` é `null` e
`scopes` é `["users:read", "users:write"]` — ele administra usuários e **não é
consumidor de dado de pesquisa**. Um admin não deve receber dado nenhum.

O token **nunca** contém: hash de senha, tentativas de login, estado de
bloqueio, e-mail, identificadores da Secom ou qualquer dado de pesquisa.

## Como validar

```js
const jwt = require("jsonwebtoken")

const decoded = jwt.verify(token, process.env.CLIENT_JWT_SECRET, {
  algorithms: ["HS256"],        // obrigatório: fecha alg:none
  issuer: "nexus-api",
  audience: "nexus-clients",
  clockTolerance: 5,
})

if (decoded.typ !== "client") throw new Error("Token não é de cliente")
if (decoded.ver !== 1) throw new Error("Versão de token não suportada")
```

O `CLIENT_JWT_SECRET` é **diferente** do `JWT_SECRET` usado pela Secom. Um
token da Secom falha na verificação de assinatura antes de qualquer outra
checagem, e vice-versa.

## Regra de autorização

O ponto que mais importa é o **4**.

1. Consulta **nacional** (sem recorte geográfico) → permitida se `scopes`
   contém `data:national`.
2. Consulta por **região R** → permitida se `allowed.regions` contém `R`.
3. Consulta por **UF U** → permitida se `allowed.ufs` contém `U`.
4. **Nunca filtre pelo `uf`/`region` que veio na requisição.** Intersecione o
   filtro pedido com o que está em `allowed`; se a interseção for vazia,
   responda **403**. Ausência de filtro significa *consulta nacional* — nunca
   "devolve tudo, quebrado por estado".
5. `allowed: null` (admin da Nexus) → nenhum dado de pesquisa.

O erro clássico a evitar é usar o `uf` do token como filtro e devolver o
restante quebrado por UF. O usuário de SP pode ver o **total** nacional, mas
não pode ver a linha do Rio de Janeiro dentro dele. Se a sua resposta tem uma
quebra por UF ou por região, ela precisa ser reduzida ao que está em
`allowed` antes de sair.

### Exemplo

```js
function autorizar(decoded, filtroPedido) {
  const { allowed, scopes } = decoded
  if (!allowed) return { ok: false, motivo: "admin não consome dado" }

  const { uf, region } = filtroPedido

  if (!uf && !region) {
    return scopes.includes("data:national")
      ? { ok: true, filtro: {} }                       // total nacional
      : { ok: false }
  }
  if (uf && !allowed.ufs.includes(String(uf).toUpperCase())) return { ok: false }
  if (region && !allowed.regions.includes(String(region).toLowerCase())) return { ok: false }

  return { ok: true, filtro: { uf, region } }
}
```

## Regiões

Os slugs de região são fixos e sem acento: `norte`, `nordeste`,
`centro-oeste`, `sudeste`, `sul`. A região **nunca** é informada por quem
cadastra — é derivada da UF pelo mapa do IBGE, dentro do model. O mapa
completo, com os rótulos para exibição, está em
`GET /api/clients/auth/meta/regions` (requer token).

| Região | UFs |
|---|---|
| `norte` | AC AP AM PA RO RR TO |
| `nordeste` | AL BA CE MA PB PE PI RN SE |
| `centro-oeste` | DF GO MT MS |
| `sudeste` | ES MG RJ SP |
| `sul` | PR RS SC |

Se a sua base usa outra grafia (`"Centro-Oeste"`, `"CO"`), a conversão é do
seu lado: use `REGION_LABELS` do endpoint acima como referência.

## Revogação

Dentro da API Nexus a revogação é imediata — toda requisição confere o
usuário no banco. Desativar a conta, trocar a senha ou resetá-la invalida
todos os tokens vigentes daquele usuário na hora.

Para um verificador **offline** (que só confere a assinatura), a invalidação
só vale a partir do `exp` — por isso a validade é de 8 horas. Se você precisar
de revogação em tempo real, chame:

```http
GET https://<api>/api/clients/auth/me
Authorization: Bearer <token>
```

200 = token e conta continuam válidos; 401 = revogado (o campo `code` diz o
motivo: `TOKEN_STALE`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `TOKEN_EXPIRED`).

## Endpoint de diagnóstico

Para testar o escopo sem envolver dado nenhum:

```http
GET /api/clients/auth/scope/check?uf=SP        -> 200
GET /api/clients/auth/scope/check?uf=RJ        -> 403 OUT_OF_SCOPE
GET /api/clients/auth/scope/check?region=sul   -> 403 OUT_OF_SCOPE
GET /api/clients/auth/scope/check              -> 200 (nacional)
```

Útil para conferir, em produção, que um acesso estadual está enxergando
exatamente o que deveria.

## Códigos de erro

| HTTP | `code` | Significado |
|---|---|---|
| 400 | `MISSING_FIELDS` | Faltou cliente, login ou senha |
| 401 | `NO_TOKEN` | Header `Authorization` ausente |
| 401 | `INVALID_TOKEN` | Assinatura, `typ`, `aud` ou `iss` inválidos |
| 401 | `INVALID_CREDENTIALS` | Login ou senha errados (idêntico nos dois casos) |
| 401 | `TOKEN_EXPIRED` | Passou do `exp` |
| 401 | `TOKEN_STALE` | Senha trocada/resetada, ou UF/papel alterados |
| 403 | `ACCOUNT_DISABLED` | Conta desativada pelo admin |
| 403 | `FORBIDDEN` | Papel insuficiente (estadual em rota de admin) |
| 403 | `OUT_OF_SCOPE` | Recorte geográfico fora do permitido |
| 423 | `ACCOUNT_LOCKED` | 5 tentativas erradas; 15 min ou unlock do admin |
| 429 | `RATE_LIMITED` | Excesso de tentativas de login por IP |
