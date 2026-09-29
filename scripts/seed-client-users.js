// Cria os 27 acessos estaduais de um cliente (SESC / SENAC).
//
// SEGURANÇA:
//   - Dry-run por padrão: sem --confirm, NADA é escrito.
//   - Idempotente: usuários que já existem são pulados (a menos de --rotate).
//   - Escreve apenas no banco MONGODB_URI_CLIENTS; config/clientDb.js aborta
//     se a conexão apontar para f2f, test ou qualquer banco da Secom.
//   - As senhas geradas vão para um arquivo FORA do repositório git.
//
// Uso:
//   node scripts/seed-client-users.js --client=sesc                            (dry-run)
//   node scripts/seed-client-users.js --client=sesc --confirm
//   node scripts/seed-client-users.js --client=sesc --client=senac --confirm   (os 54)
//   node scripts/seed-client-users.js --client=sesc --only=SP,RJ --confirm
//
// Flags:
//   --confirm            executa de verdade (sem ela, só simula)
//   --client=<code>      repetível; obrigatório; sesc | senac
//   --only=UF,UF         restringe a um subconjunto de UFs
//   --rotate             reseta a senha de quem JÁ existe (desligada por padrão)
//   --out=<dir>          onde gravar o arquivo de senhas (default: ../../docs)
//   --format=csv|json|both   (default: both)
//   --print-passwords    também imprime as senhas no terminal (default: não)

require("dotenv").config()

const fs = require("fs")
const path = require("path")

const { getClientUserModel, expectedDbName } = require("../config/clientDb")
const { generatePassword } = require("../utils/clientPassword")
const { UFS, UF_LABELS, getRegion } = require("../utils/brazilRegions")
const { DATA_CLIENT_CODES, ROLE_STATE_USER } = require("../models/ClientUser")

const CLIENT_LABELS = { sesc: "SESC", senac: "SENAC" }

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(`--${name}`)
const getValues = (name) =>
  argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
const getValue = (name, fallback) => {
  const values = getValues(name)
  return values.length > 0 ? values[values.length - 1] : fallback
}

const CONFIRM = hasFlag("confirm")
const ROTATE = hasFlag("rotate")
const PRINT_PASSWORDS = hasFlag("print-passwords")
const FORMAT = getValue("format", "both")
// Fora do repositório git (mesma convenção de scripts/delete-rounds.js:71)
const OUT_DIR = getValue("out", path.join(__dirname, "..", "..", "docs"))

const clients = [...new Set(getValues("client").map((c) => c.trim().toLowerCase()))]
const onlyUFs = getValue("only", "")
  .split(",")
  .map((u) => u.trim().toUpperCase())
  .filter(Boolean)

function csvCell(value) {
  const str = value === null || value === undefined ? "" : String(value)
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function usage(message) {
  console.error(`\n❌ ${message}\n`)
  console.error("Uso: node scripts/seed-client-users.js --client=sesc [--client=senac] [--confirm]")
  console.error(`Clientes válidos: ${DATA_CLIENT_CODES.join(", ")}\n`)
  process.exit(1)
}

async function run() {
  if (clients.length === 0) usage("Informe ao menos um --client=")

  const invalid = clients.filter((c) => !DATA_CLIENT_CODES.includes(c))
  if (invalid.length > 0) usage(`Cliente inválido: ${invalid.join(", ")}`)

  const invalidUFs = onlyUFs.filter((uf) => !UFS.includes(uf))
  if (invalidUFs.length > 0) usage(`UF inválida em --only: ${invalidUFs.join(", ")}`)

  const targetUFs = onlyUFs.length > 0 ? onlyUFs : [...UFS]

  console.log(`\n👥 Criação de acessos estaduais: ${clients.map((c) => CLIENT_LABELS[c]).join(", ")}`)
  console.log(`   UFs: ${targetUFs.length} (${targetUFs.join(", ")})`)
  console.log(
    CONFIRM
      ? "   ✍️  MODO CONFIRMADO (vai escrever no banco)\n"
      : "   ⚠️  DRY-RUN (nada será escrito). Use --confirm para executar.\n",
  )

  // A trava de banco vive em config/clientDb.js: se a URI apontar para um
  // banco que não o esperado, isto lança antes de qualquer escrita.
  const ClientUser = await getClientUserModel()
  console.log(`📡 Banco conectado: "${ClientUser.db.name}" (esperado "${expectedDbName()}")\n`)

  const summary = []
  const created = []

  for (const client of clients) {
    const label = CLIENT_LABELS[client]

    const existing = await ClientUser.find({
      client,
      login: { $in: targetUFs.map((uf) => uf.toLowerCase()) },
    }).select("login uf")
    const existingLogins = new Set(existing.map((u) => u.login))

    const plan = targetUFs.map((uf) => ({
      client,
      login: uf.toLowerCase(),
      identity: `${client}-${uf.toLowerCase()}`,
      name: `${label} ${UF_LABELS[uf]}`,
      uf,
      region: getRegion(uf),
      action: existingLogins.has(uf.toLowerCase()) ? (ROTATE ? "ROTATE" : "SKIP") : "CREATE",
    }))

    console.log(`========== [${label}] ==========`)
    console.log("   login      | uf | região       | ação   | nome")
    console.log("   " + "-".repeat(66))
    for (const row of plan) {
      console.log(
        `   ${row.identity.padEnd(10)} | ${row.uf} | ${row.region.padEnd(12)} | ${row.action.padEnd(6)} | ${row.name}`,
      )
    }

    const counts = plan.reduce((acc, r) => {
      acc[r.action] = (acc[r.action] || 0) + 1
      return acc
    }, {})
    console.log(
      `   → CREATE: ${counts.CREATE || 0} | SKIP: ${counts.SKIP || 0} | ROTATE: ${counts.ROTATE || 0}\n`,
    )

    summary.push({ client, plan, counts })
  }

  if (!CONFIRM) {
    console.log("Dry-run concluído. Nada foi escrito. Para executar de verdade rode:")
    console.log(`   node scripts/seed-client-users.js ${clients.map((c) => `--client=${c}`).join(" ")} --confirm\n`)
    process.exit(0)
  }

  // ---- Execução ----
  let errors = 0

  for (const { client, plan } of summary) {
    for (const row of plan) {
      if (row.action === "SKIP") continue

      const password = generatePassword()

      try {
        if (row.action === "ROTATE") {
          const user = await ClientUser.findOne({ client, login: row.login }).select("+password")
          user.password = password
          user.mustChangePassword = true
          await user.save()
        } else {
          // Um a um com .save(): insertMany PULA o pre("save") e gravaria a
          // senha em texto claro.
          const user = new ClientUser({
            client: row.client,
            login: row.login,
            name: row.name,
            uf: row.uf, // region é derivada pelo hook do model
            role: ROLE_STATE_USER,
            password,
            mustChangePassword: true,
          })
          await user.save()
        }

        created.push({ ...row, password })
        console.log(`   ✅ ${row.action === "ROTATE" ? "Senha rotacionada" : "Criado"}: ${row.identity}`)
      } catch (error) {
        if (error.code === 11000) {
          console.log(`   ⏭️  Já existe (corrida): ${row.identity}`)
        } else {
          errors++
          console.error(`   ❌ Falha em ${row.identity}: ${error.message}`)
        }
      }
    }
  }

  if (created.length === 0) {
    console.log("\nNenhum acesso criado. Encerrando.\n")
    process.exit(errors > 0 ? 2 : 0)
  }

  // ---- Arquivo de senhas ----
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const slug = clients.join("-")
  const written = []

  if (FORMAT === "csv" || FORMAT === "both") {
    const header = ["client", "login", "identity", "name", "uf", "region", "role", "senha_inicial"]
    const lines = [header.join(",")]
    for (const row of created) {
      lines.push(
        [row.client, row.login, row.identity, row.name, row.uf, row.region, ROLE_STATE_USER, row.password]
          .map(csvCell)
          .join(","),
      )
    }
    const file = path.join(OUT_DIR, `client-users_${slug}_${stamp}.csv`)
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8")
    written.push(file)
  }

  if (FORMAT === "json" || FORMAT === "both") {
    const file = path.join(OUT_DIR, `client-users_${slug}_${stamp}.json`)
    fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), users: created }, null, 2), "utf8")
    written.push(file)
  }

  console.log(`\n💾 ${created.length} acesso(s) gravado(s). Arquivo(s) de senha:`)
  written.forEach((f) => console.log(`   ${f}`))
  console.log("\n⚠️  ATENÇÃO: estes arquivos contêm SENHAS EM TEXTO CLARO.")
  console.log("   Distribua por canal seguro e apague os arquivos em seguida.")
  console.log("   Todos os usuários já nascem com mustChangePassword = true.\n")

  if (PRINT_PASSWORDS) {
    console.log("Senhas (--print-passwords):")
    created.forEach((r) => console.log(`   ${r.identity.padEnd(10)}  ${r.password}`))
    console.log("")
  }

  process.exit(errors > 0 ? 2 : 0)
}

run().catch((error) => {
  console.error("\n❌ Erro:", error.message)
  process.exit(1)
})
