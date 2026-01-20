require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const readline = require('readline')
const { connectToDatabase, getModel } = require('../config/dbManager')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve))

async function updateCompromisedPassword() {
  try {
    console.log('🔒 Script de Atualização de Senha Comprometida')
    console.log('=' .repeat(60))
    console.log('')

    // Conectar ao banco de dados f2f (onde os usuários estão armazenados)
    console.log('📡 Conectando ao banco de dados f2f...')
    await connectToDatabase('f2f')
    const User = await getModel('User', 'f2f')
    console.log('✅ Conectado com sucesso!\n')

    // Buscar o usuário comprometido
    const compromisedEmail = 'admin@apinexus.com'
    console.log(`🔍 Procurando usuário: ${compromisedEmail}`)

    let user = await User.findOne({ email: compromisedEmail })

    if (!user) {
      console.log(`⚠️  Usuário ${compromisedEmail} não encontrado.`)
      console.log('📋 Listando todos os usuários no sistema:\n')

      const allUsers = await User.find({}, 'name email role isActive createdAt')
      if (allUsers.length === 0) {
        console.log('Nenhum usuário encontrado no banco de dados.')
      } else {
        allUsers.forEach((u, index) => {
          console.log(`${index + 1}. Nome: ${u.name}`)
          console.log(`   Email: ${u.email}`)
          console.log(`   Role: ${u.role}`)
          console.log(`   Ativo: ${u.isActive ? 'Sim' : 'Não'}`)
          console.log(`   Criado em: ${u.createdAt}`)
          console.log('')
        })
      }

      const createNew = await question(
        '\n❓ Deseja criar um novo usuário admin? (s/n): '
      )

      if (createNew.toLowerCase() !== 's') {
        console.log('❌ Operação cancelada.')
        rl.close()
        await closeAllConnections()
        process.exit(0)
      }

      const name = await question('Nome do usuário: ')
      const email = await question('Email do usuário: ')

      user = new User({
        name,
        email: email.toLowerCase(),
        password: 'temp123456', // Senha temporária que será substituída
        role: 'admin',
        isActive: true,
      })

      console.log('\n✅ Novo usuário criado (senha temporária definida)')
    } else {
      console.log(`✅ Usuário encontrado: ${user.name} (${user.email})`)
      console.log(`   Role: ${user.role}`)
      console.log(`   Ativo: ${user.isActive ? 'Sim' : 'Não'}\n`)
    }

    // Solicitar nova senha forte
    console.log('🔐 Agora você precisa definir uma senha FORTE e SEGURA')
    console.log('   Recomendações:')
    console.log('   - Mínimo 12 caracteres')
    console.log('   - Misture letras maiúsculas e minúsculas')
    console.log('   - Inclua números e caracteres especiais')
    console.log('   - NÃO use senhas óbvias ou pessoais\n')

    const newPassword = await question('Digite a nova senha: ')
    const confirmPassword = await question('Confirme a nova senha: ')

    if (newPassword !== confirmPassword) {
      console.log('\n❌ As senhas não coincidem!')
      rl.close()
      await closeAllConnections()
      process.exit(1)
    }

    if (newPassword.length < 8) {
      console.log('\n⚠️  AVISO: Senha muito curta! Recomendamos no mínimo 12 caracteres.')
      const proceed = await question('Deseja continuar mesmo assim? (s/n): ')
      if (proceed.toLowerCase() !== 's') {
        console.log('❌ Operação cancelada.')
        rl.close()
        await closeAllConnections()
        process.exit(0)
      }
    }

    // Atualizar a senha (o bcrypt hash será aplicado automaticamente pelo pre-save)
    user.password = newPassword

    // Resetar tentativas de login e desbloqueio
    user.loginAttempts = 0
    user.lockUntil = undefined
    user.isActive = true

    await user.save()

    console.log('\n✅ Senha atualizada com sucesso!')
    console.log(`   Email: ${user.email}`)
    console.log(`   Role: ${user.role}`)
    console.log(`   Conta ativa: ${user.isActive}`)
    console.log(`   Tentativas de login resetadas: Sim`)
    console.log('')

    // Limpar outros usuários suspeitos ou duplicados
    console.log('🧹 Verificando usuários duplicados ou suspeitos...\n')

    const suspiciousEmails = [
      'admin@apinexus.com',
      'user@apinexus.com',
      'test@apinexus.com',
    ]

    for (const email of suspiciousEmails) {
      if (email === user.email) continue // Pular o usuário que acabamos de atualizar

      const duplicates = await User.find({ email })
      if (duplicates.length > 0) {
        console.log(`⚠️  Encontrado usuário: ${email}`)
        const remove = await question(`   Deseja remover este usuário? (s/n): `)
        if (remove.toLowerCase() === 's') {
          await User.deleteMany({ email })
          console.log(`   ✅ Usuário ${email} removido\n`)
        }
      }
    }

    // Buscar credenciais hardcoded no código
    console.log('🔍 Verificação completa!')
    console.log('\n⚠️  ATENÇÃO - PRÓXIMOS PASSOS IMPORTANTES:')
    console.log('=' .repeat(60))
    console.log('1. ✅ Senha atualizada no banco de dados')
    console.log('2. 🔒 Remova o arquivo scripts/create-admin.js (contém senha padrão)')
    console.log('3. 🔑 Atualize a senha do Google Password Manager')
    console.log('4. 📧 Verifique se não há credenciais hardcoded no código')
    console.log('5. 🔐 Considere usar variáveis de ambiente para credenciais')
    console.log('6. 📝 Adicione .env ao .gitignore (se ainda não estiver)')
    console.log('7. 🔄 Revogue todos os tokens JWT existentes (faça logout em todos os dispositivos)')
    console.log('=' .repeat(60))
    console.log('')

    rl.close()
    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Erro ao atualizar senha:', error.message)
    console.error(error)
    rl.close()
    await mongoose.disconnect()
    process.exit(1)
  }
}

// Executar o script
updateCompromisedPassword()
