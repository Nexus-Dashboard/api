// Cria o primeiro admin da Nexus no banco de autenticação dos clientes.
//
// Necessário porque o módulo de clientes NÃO tem rota pública de registro —
// sem este script não haveria como criar o primeiro acesso administrativo.
//
// Uso:
//   node scripts/create-client-admin.js
//
// Escreve APENAS no banco definido por MONGODB_URI_CLIENTS (nexus_clients).
// Nenhum banco da Secom é tocado — config/clientDb.js aborta se a conexão
// apontar para f2f, test ou qualquer outro banco que não o esperado.

require("dotenv").config()

const readline = require("readline")

const { getClientUserModel, expectedDbName } = require("../config/clientDb")
const { validatePassword, generatePassword } = require("../utils/clientPassword")
const { ROLE_NEXUS_ADMIN } = require("../models/ClientUser")

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (query) => new Promise((resolve) => rl.question(query, resolve))

async function createClientAdmin() {
  try {
    console.log("👤 Criação de admin da Nexus (módulo de clientes)")
    console.log("=".repeat(56))
    console.log("")

    console.log(`📡 Conectando ao banco de clientes [${expectedDbName()}]...`)
    const ClientUser = await getClientUserModel()
    console.log(`✅ Conectado ao banco "${ClientUser.db.name}"\n`)

    const existingAdmin = await ClientUser.findOne({ role: ROLE_NEXUS_ADMIN })
    if (existingAdmin) {
      console.log("⚠️  Já existe um admin no módulo de clientes:")
      console.log(`   Nome:  ${existingAdmin.name}`)
      console.log(`   Login: ${existingAdmin.identity}`)
      console.log(`   Ativo: ${existingAdmin.isActive ? "Sim" : "Não"}\n`)

      const proceed = await question("Deseja criar outro admin mesmo assim? (s/n): ")
      if (proceed.trim().toLowerCase() !== "s") {
        console.log("Operação cancelada.")
        rl.close()
        process.exit(0)
      }
      console.log("")
    }

    const name = (await question("Nome completo: ")).trim()
    const login = (await question("Login (ex.: marco) [o cliente será 'nexus']: ")).trim().toLowerCase()

    if (!name || !login) {
      console.log("\n❌ Nome e login são obrigatórios.")
      rl.close()
      process.exit(1)
    }

    const exists = await ClientUser.findOne({ client: "nexus", login })
    if (exists) {
      console.log(`\n❌ Já existe um usuário "nexus-${login}".`)
      rl.close()
      process.exit(1)
    }

    console.log("")
    const useGenerated = await question("Gerar senha automaticamente? (s/n): ")

    let password
    if (useGenerated.trim().toLowerCase() === "s") {
      password = generatePassword()
      console.log(`\n🔑 Senha gerada: ${password}`)
      console.log("   Anote agora — ela não será exibida novamente.\n")
    } else {
      password = await question("Senha (mín. 12 caracteres): ")
      const confirmPassword = await question("Confirmar senha: ")

      if (password !== confirmPassword) {
        console.log("\n❌ As senhas não coincidem.")
        rl.close()
        process.exit(1)
      }

      const problem = validatePassword(password, { client: "nexus", login })
      if (problem) {
        console.log(`\n❌ ${problem}`)
        rl.close()
        process.exit(1)
      }
    }

    const user = new ClientUser({
      client: "nexus",
      login,
      name,
      password,
      role: ROLE_NEXUS_ADMIN,
      isActive: true,
      mustChangePassword: false,
    })

    await user.save()

    console.log("\n✅ Admin criado com sucesso!")
    console.log(`   Nome:   ${user.name}`)
    console.log(`   Login:  ${user.identity}`)
    console.log(`   Papel:  ${user.role}`)
    console.log(`   Banco:  ${ClientUser.db.name}`)
    console.log(`   ID:     ${user._id}`)
    console.log("\n   Teste o login com:")
    console.log(`   POST /api/clients/auth/login  { "identity": "${user.identity}", "password": "..." }\n`)

    rl.close()
    process.exit(0)
  } catch (error) {
    console.error("\n❌ Erro ao criar admin:", error.message)
    rl.close()
    process.exit(1)
  }
}

createClientAdmin()
