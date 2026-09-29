// config/clientDb.js
//
// Acesso ao banco de autenticação dos clientes (SESC / SENAC).
//
// POR QUE O MODEL É REGISTRADO AQUI, E NÃO EM config/dbManager.js:
// as linhas 68-73 do dbManager registram os models em TODA conexão que ele
// abre. Se ClientUser entrasse ali, o autoIndex do mongoose criaria a coleção
// "clientusers" com índices dentro de telephonic, telephonic_archive, f2f e
// test — ou seja, escrita nos bancos da Secom. Registrando aqui, o model só
// existe na conexão do banco de clientes.

const { connectToDatabase } = require("./dbManager")
const { ClientUserSchema } = require("../models/ClientUser")

const CLIENTS_DB_KEY = "clients"

// Bancos onde este módulo JAMAIS pode escrever. `f2f` e `test` estão aqui
// porque são exatamente o destino do fallback silencioso de dbManager.js:50-53
// caso a dbKey ou a URI estejam erradas.
const FORBIDDEN_DB_NAMES = ["f2f", "test", "admin", "local", "config"]

function expectedDbName() {
  return process.env.CLIENTS_DB_NAME || "nexus_clients"
}

// Devolve a conexão do banco de clientes, com uma trava contra escrever no
// banco errado. Falhar aqui é MUITO melhor do que gravar um usuário de
// cliente dentro do banco da Secom.
async function getClientConnection() {
  if (!process.env.MONGODB_URI_CLIENTS) {
    throw new Error(
      "MONGODB_URI_CLIENTS não está definida. O módulo de autenticação de clientes exige um " +
        "database próprio (ver docs/CLIENT_AUTH_ENV.md).",
    )
  }

  const cached = await connectToDatabase(CLIENTS_DB_KEY)
  const { conn } = cached
  const dbName = conn.db && conn.db.databaseName

  const expected = expectedDbName()
  if (dbName !== expected || FORBIDDEN_DB_NAMES.includes(dbName)) {
    throw new Error(
      `Conexão de clientes apontando para o banco errado: "${dbName}" (esperado "${expected}"). ` +
        `Verifique MONGODB_URI_CLIENTS — a URI precisa incluir o nome do database.`,
    )
  }

  return cached
}

async function getClientUserModel() {
  const cached = await getClientConnection()

  // dbManager.js:68 reatribui cached.models a cada (re)conexão, apagando o
  // ClientUser do cache — daí a checagem a cada chamada. Passar SEMPRE a
  // mesma instância de schema (garantida pelo require cache do Node) faz
  // conn.model() devolver o model já compilado em vez de lançar
  // OverwriteModelError.
  if (!cached.models.ClientUser) {
    cached.models.ClientUser = cached.conn.model("ClientUser", ClientUserSchema)
  }

  return cached.models.ClientUser
}

module.exports = {
  CLIENTS_DB_KEY,
  getClientConnection,
  getClientUserModel,
  expectedDbName,
}
