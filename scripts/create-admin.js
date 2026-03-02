require('dotenv').config()
const readline = require('readline')
const { connectToDatabase, getModel } = require('../config/dbManager')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve))

async function createAdmin() {
  try {
    console.log('👤 Script de Criação de Usuário Admin')
    console.log('='.repeat(50))
    console.log('')

    console.log('📡 Conectando ao banco de dados f2f...')
    await connectToDatabase('f2f')
    const User = await getModel('User', 'f2f')
    console.log('✅ Conectado!\n')

    // Verificar se já existe algum admin
    const existingAdmin = await User.findOne({ role: 'admin' })
    if (existingAdmin) {
      console.log('⚠️  Já existe um usuário admin no sistema:')
      console.log(`   Nome:  ${existingAdmin.name}`)
      console.log(`   Email: ${existingAdmin.email}`)
      console.log(`   Ativo: ${existingAdmin.isActive ? 'Sim' : 'Não'}\n`)

      const proceed = await question('Deseja criar outro admin mesmo assim? (s/n): ')
      if (proceed.toLowerCase() !== 's') {
        console.log('Operação cancelada.')
        rl.close()
        process.exit(0)
      }
      console.log('')
    }

    // Coletar dados do novo admin
    const name = await question('Nome completo: ')
    const email = await question('Email: ')

    // Verificar se email já está em uso
    const emailExists = await User.findOne({ email: email.toLowerCase() })
    if (emailExists) {
      console.log(`\n❌ Já existe um usuário com o email "${email}".`)
      rl.close()
      process.exit(1)
    }

    const password = await question('Senha (mín. 8 caracteres): ')
    const confirmPassword = await question('Confirmar senha: ')

    if (password !== confirmPassword) {
      console.log('\n❌ As senhas não coincidem.')
      rl.close()
      process.exit(1)
    }

    if (password.length < 8) {
      console.log('\n❌ Senha muito curta. Mínimo 8 caracteres.')
      rl.close()
      process.exit(1)
    }

    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'admin',
      isActive: true,
    })

    await user.save()

    console.log('\n✅ Usuário admin criado com sucesso!')
    console.log(`   Nome:  ${user.name}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   Role:  ${user.role}`)
    console.log(`   ID:    ${user._id}`)

    rl.close()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Erro ao criar admin:', error.message)
    rl.close()
    process.exit(1)
  }
}

createAdmin()
