# Dados das pesquisas dos clientes — `/api/clients/surveys`

Rota protegida que entrega as bases das pesquisas do SESC (e, depois, do SENAC) para os dashboards dos clientes, já recortadas pelo escopo do usuário. Complementa o [contrato do token](CLIENT_TOKEN_CONTRACT.md).

**Por que existe:** a rota pública `GET /api/google/file/:id` devolve a planilha inteira, com os 27 estados, para qualquer pessoa que tenha o ID. Aqui, os IDs ficam só no servidor (`config/clientSurveys.js`), e a regra "o usuário estadual não vê estados nem regiões de terceiros" é aplicada **antes** de o dado sair da API.

## Arquivos

| Arquivo | Papel |
|---|---|
| `config/clientSurveys.js` | Registro das pesquisas: cliente, ID da planilha, aba, coluna de peso, colunas de UF e colunas descartadas |
| `services/clientSurveyService.js` | Leitura da aba, normalização, cache, codificação e máscara de escopo |
| `routes/clients/surveyRoutes.js` | Rotas HTTP (todas exigem `authenticateClient`) |

## Rotas

Todas exigem `Authorization: Bearer <token de cliente>`. Os erros de token são os do middleware (`NO_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_STALE`…).

### `GET /api/clients/surveys`

Lista as pesquisas que o usuário pode abrir.

```json
{ "success": true, "surveys": [ { "id": "populacao", "client": "sesc", "title": "População geral" } ] }
```

- `state_user` vê as pesquisas do próprio cliente.
- `nexus_admin` vê todas.

### `GET /api/clients/surveys/:surveyId/data`

| HTTP | `code` | Quando |
|---|---|---|
| 200 | — | ok |
| 403 | `SURVEY_FORBIDDEN` | a pesquisa é de outro cliente (ex.: `senac-*` pedindo `populacao`) |
| 403 | `OUT_OF_SCOPE` | `state_user` sem UF |
| 404 | `SURVEY_NOT_FOUND` | id desconhecido |
| 503 | `SURVEY_NOT_CONFIGURED` | pesquisa registrada, mas ainda sem planilha (`fileId` vazio) |
| 502 | `SURVEY_SOURCE_ERROR` / `SURVEY_SCHEMA_ERROR` | falha ao ler o Google Sheets, ou planilha sem as colunas esperadas |

Cabeçalhos: `Cache-Control: private, max-age=300` e `Vary: Authorization`.

## Payload

```jsonc
{
  "success": true,
  "survey": { "id", "client", "title", "fileName", "modifiedTime" },
  "scope": { "level": "state", "client": "sesc", "uf": "ES", "region": "sudeste" }, // admin: { "level": "admin" }
  "n": 5544,
  "order": ["PF1", "Idade", "..."],          // ordem original das colunas
  "columns": {
    "PF1":       { "type": "code", "bits": 8, "data": "<base64>" },  // código do CODEBOOK; 0 = em branco
    "P1":        { "type": "text", "bits": 8, "data": "<base64>", "values": ["NS/NR", "SESC", "..."] }, // código k = values[k-1]
    "INDICADOR": { "type": "num", "data": [96.9, 100, null] }
  },
  "weight": [1.259, 0.384, "..."],            // peso amostral por linha
  "geo": { "bits": 8, "data": "<base64>" },   // só state_user
  "uf":  { "bits": 8, "data": "<base64>", "values": ["AC", "AL", "..."] }, // só admin
  "loadedAt": "…", "generatedAt": "…"
}
```

**Formato:**
- `bits: 8` é um `Uint8Array` e `bits: 16` é um `Uint16Array` little-endian, os dois em base64.
- Em colunas `code` e `text`, 0 = em branco: pergunta não feita (pulo do questionário) ou NS/NR nos atributos 1–5.
- Os rótulos dos códigos **não** vêm no payload. Ficam no dicionário do dashboard, gerado a partir dos CODEBOOKs.

**Colunas removidas antes do envio:**
- População: `SbjNum`, `uf_cotas`, `Região`.
- Stakeholders: `Response_ID`, `PF3.1`, `PF8`, `P14_O`, `pesojornalista`, `pesoparlamentar`.
- A coluna de peso sai de `columns` e vai para `weight`.

**UF de cada linha** (usada só para montar a máscara):
- população: `uf_cotas`, em texto sem acento;
- stakeholders: `PF3.1 || PF8`, com códigos 1–27 em ordem alfabética do nome do estado.

## Máscara de escopo

Para `state_user`, `geo[i]` vale:

| valor | significado |
|---|---|
| 2 | linha do estado do usuário |
| 1 | linha de outro estado da mesma região |
| 0 | linha de fora da região |

Assim, o dashboard calcula:
- Brasil com todas as linhas;
- a Região com `geo >= 1`;
- o Estado com `geo == 2`.

Ele **não consegue isolar** outro estado nem outra região, porque essa informação não está no payload. O admin recebe a UF de todas as linhas.

A máscara é recalculada a cada requisição a partir de `req.clientScope`, que o middleware reconstrói do banco. O token nunca é usado para isso.

### Risco residual (aceito)

Os pesos amostrais seguem a distribuição populacional:
- na População, o peso médio de uma linha do Sudeste é ~5× o de uma do Norte;
- nos Stakeholders, o peso é constante por público × grupo de estados.

Por isso, alguém com conhecimento técnico que baixe o payload e analise os pesos consegue **inferir aproximadamente** a região, ou o grupo de estados, das linhas mascaradas. O dashboard nunca mostra isso.

Para eliminar o risco, o caminho é agregar no servidor: devolver só frequências ponderadas por pergunta e nenhuma linha individual.

## Pesquisas registradas

| id | cliente | peso | UF (só para a máscara) | colunas removidas |
|---|---|---|---|---|
| `populacao` | sesc | `weights.rf` | `uf_cotas` (nome) | `SbjNum`, `uf_cotas`, `Região` |
| `stakeholders` | sesc | `Peso` | `PF3.1` / `PF8` (código 1–27) | `Response_ID`, `PF3.1`, `PF8`, `P14_O`, pesos por público |
| `senac-populacao` | senac | `weights.rf` | `PF4` (código 1–27) | `SbjNum`, `PF4`, `PF5` (cidade), `Regiao`, `PF3_3_OUT`, `Q_79_S` |
| `senac-empresarios` | senac | `weights` | `PF7_1` (sigla) | `idEntrevista`, `PF7_1`, `PF6` (região), `PF8_cod_1`, `PF8_1` (cidade), `PF2_1`, `PF1_t`, `P14_6_t` |

As colunas de cidade também são removidas, porque revelariam a UF.

**Opções por pesquisa** (em `config/clientSurveys.js`):
- **`geo.kind`:**
  - `ufName`: nome do estado, sem diferenciar acento ou caixa;
  - `ufCode`: código 1–27 em ordem alfabética, usando `ALPHABETICAL_UF_CODES`;
  - `ufSigla`: sigla da UF.
- **`valueRender`:** padrão `FORMATTED_VALUE`. As bases do Senac usam `UNFORMATTED_VALUE`, para ler pesos e indicadores com precisão total, sem depender da formatação da planilha.
- **`nullTokens`:** textos tratados como branco. Nas bases do Senac é `#NULL!`, o valor ausente do SPSS.
- **`sheet`:** quando vem `null`, a API lê a primeira aba da planilha.
- **`fileId`:** quando está vazio, a rota responde `503 SURVEY_NOT_CONFIGURED` até a planilha ser configurada.

## Cache e desempenho

- Cache em memória por instância, com TTL de 15 minutos (`CACHE_TTL_MS`). Requisições simultâneas esperam a mesma leitura (dedupe).
- Lê só a aba configurada (`Dados (códigos)`), via `spreadsheets.values.get`.
- A População passa de ~14 MB (aba de respostas pela rota pública) para ~1,1 MB. A Vercel ainda comprime com gzip/brotli.
- Leitura a frio: ~3–6 s. Com o cache quente, a montagem da resposta leva poucos milissegundos.

## Pendente: bloquear os IDs do SESC na rota pública

Enquanto `GET /api/google/file/:id` continuar aberta, quem já tem os IDs das planilhas consegue baixar a base completa. **Ainda não aplicado.** A mudança proposta, em `routes/googleRoutes.js`, antes da rota `/file/:fileId`:

```js
const { listSurveys } = require("../config/clientSurveys")
const PROTECTED_FILE_IDS = new Set(listSurveys().map((survey) => survey.fileId))

router.use("/file/:fileId", (req, res, next) => {
  if (PROTECTED_FILE_IDS.has(req.params.fileId)) {
    return res.status(403).json({ error: "Arquivo protegido", details: "Use /api/clients/surveys" })
  }
  next()
})
```
