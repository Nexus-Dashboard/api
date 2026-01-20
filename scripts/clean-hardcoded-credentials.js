require('dotenv').config()
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve))

// Lista de arquivos que podem conter credenciais hardcoded
const filesToCheck = [
  'scripts/create-admin.js',
  'scripts/create-user.js',
  '.env',
  '.env.example',
  '.env.local',
  '.env.development',
  '.env.production',
]

// Padrões suspeitos
const suspiciousPatterns = [
  { pattern: /password\s*[:=]\s*["'](.+?)["']/gi, name: 'password' },
  { pattern: /senha\s*[:=]\s*["'](.+?)["']/gi, name: 'senha' },
  { pattern: /admin@\w+\.\w+/gi, name: 'admin email' },
  { pattern: /user@\w+\.\w+/gi, name: 'user email' },
  { pattern: /password:\s*["'](.+?)["']/gi, name: 'password object' },
  { pattern: /user123/gi, name: 'default password' },
]

async function cleanHardcodedCredentials() {
  console.log('🔒 Script de Limpeza de Credenciais Hardcoded')
  console.log('=' .repeat(60))
  console.log('')

  const projectRoot = path.join(__dirname, '..')
  const findings = []

  console.log('🔍 Escaneando arquivos do projeto...\n')

  // Escanear arquivos
  for (const file of filesToCheck) {
    const filePath = path.join(projectRoot, file)

    if (!fs.existsSync(filePath)) {
      console.log(`⏭️  ${file} - Arquivo não existe, pulando...`)
      continue
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const fileFindings = []

      for (const { pattern, name } of suspiciousPatterns) {
        const matches = [...content.matchAll(pattern)]
        if (matches.length > 0) {
          matches.forEach((match) => {
            fileFindings.push({
              type: name,
              line: content.substring(0, match.index).split('\n').length,
              match: match[0],
            })
          })
        }
      }

      if (fileFindings.length > 0) {
        findings.push({ file, findings: fileFindings })
        console.log(`⚠️  ${file}:`)
        fileFindings.forEach((f) => {
          console.log(`   Linha ${f.line}: ${f.type} - "${f.match}"`)
        })
        console.log('')
      } else {
        console.log(`✅ ${file} - Nenhuma credencial encontrada`)
      }
    } catch (error) {
      console.log(`❌ Erro ao ler ${file}: ${error.message}`)
    }
  }

  console.log('\n' + '=' .repeat(60))
  console.log('📊 RESUMO DA ANÁLISE')
  console.log('=' .repeat(60))
  console.log('')

  if (findings.length === 0) {
    console.log('✅ Nenhuma credencial hardcoded encontrada!')
    rl.close()
    process.exit(0)
  }

  console.log(`⚠️  Encontradas ${findings.length} arquivo(s) com possíveis credenciais:\n`)

  findings.forEach(({ file, findings }) => {
    console.log(`📄 ${file}: ${findings.length} ocorrência(s)`)
  })

  console.log('\n' + '=' .repeat(60))
  console.log('🔧 AÇÕES RECOMENDADAS')
  console.log('=' .repeat(60))
  console.log('')

  // Verificar scripts/create-admin.js
  const createAdminPath = path.join(projectRoot, 'scripts/create-admin.js')
  if (fs.existsSync(createAdminPath)) {
    console.log('1. 🗑️  Arquivo scripts/create-admin.js detectado')
    const removeAdmin = await question(
      '   Este arquivo contém senha padrão. Deseja REMOVER? (s/n): '
    )

    if (removeAdmin.toLowerCase() === 's') {
      fs.unlinkSync(createAdminPath)
      console.log('   ✅ Arquivo scripts/create-admin.js REMOVIDO\n')
    } else {
      console.log('   ⏭️  Mantendo arquivo (você deve alterar manualmente)\n')
    }
  }

  // Verificar .gitignore
  const gitignorePath = path.join(projectRoot, '.gitignore')
  console.log('2. 📝 Verificando .gitignore...')

  if (!fs.existsSync(gitignorePath)) {
    console.log('   ⚠️  Arquivo .gitignore NÃO EXISTE!')
    const createGitignore = await question('   Deseja criar .gitignore? (s/n): ')

    if (createGitignore.toLowerCase() === 's') {
      const gitignoreContent = `# Dependências
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Variáveis de ambiente
.env
.env.local
.env.development
.env.production
.env.test

# Logs
logs/
*.log

# Build
dist/
build/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Scripts temporários
scripts/temp-*.js
scripts/*-temp.js
`
      fs.writeFileSync(gitignorePath, gitignoreContent)
      console.log('   ✅ Arquivo .gitignore criado com sucesso!\n')
    }
  } else {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8')

    const requiredEntries = ['.env', '.env.local', '.env.production', 'node_modules']
    const missingEntries = requiredEntries.filter(
      (entry) => !gitignoreContent.includes(entry)
    )

    if (missingEntries.length > 0) {
      console.log(`   ⚠️  Entradas faltando no .gitignore: ${missingEntries.join(', ')}`)
      const updateGitignore = await question('   Deseja adicionar? (s/n): ')

      if (updateGitignore.toLowerCase() === 's') {
        const entriesToAdd = '\n\n# Adicionado pelo script de limpeza\n' + missingEntries.join('\n')
        fs.appendFileSync(gitignorePath, entriesToAdd)
        console.log('   ✅ Entradas adicionadas ao .gitignore!\n')
      }
    } else {
      console.log('   ✅ .gitignore está configurado corretamente\n')
    }
  }

  // Criar .env.example seguro
  const envExamplePath = path.join(projectRoot, '.env.example')
  console.log('3. 📋 Arquivo .env.example...')

  const safeEnvExample = `# MongoDB Connections
MONGODB_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/database?retryWrites=true&w=majority
MONGODB_URI_SECUNDARIO=mongodb+srv://usuario:senha@cluster.mongodb.net/f2f?retryWrites=true&w=majority

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRES_IN=7d

# Server
PORT=4000
NODE_ENV=development

# IMPORTANTE:
# 1. NÃO commite o arquivo .env com credenciais reais
# 2. Use senhas fortes e únicas
# 3. Altere o JWT_SECRET para uma string aleatória
# 4. Mantenha este arquivo apenas como exemplo
`

  const createEnvExample = await question(
    '   Deseja criar/atualizar .env.example com valores seguros? (s/n): '
  )

  if (createEnvExample.toLowerCase() === 's') {
    fs.writeFileSync(envExamplePath, safeEnvExample)
    console.log('   ✅ .env.example criado/atualizado com valores de exemplo\n')
  }

  console.log('\n' + '=' .repeat(60))
  console.log('✅ LIMPEZA CONCLUÍDA')
  console.log('=' .repeat(60))
  console.log('')
  console.log('📋 CHECKLIST FINAL DE SEGURANÇA:')
  console.log('   [ ] Senha do usuário admin atualizada no banco')
  console.log('   [ ] Senha atualizada no Google Password Manager')
  console.log('   [ ] Arquivo create-admin.js removido ou modificado')
  console.log('   [ ] .env está no .gitignore')
  console.log('   [ ] .env não foi commitado no Git')
  console.log('   [ ] Todos os tokens JWT revogados (logout forçado)')
  console.log('   [ ] Verificado histórico do Git para credenciais expostas')
  console.log('')
  console.log('⚠️  PRÓXIMO PASSO CRÍTICO:')
  console.log('   Execute: git log -p | grep -i "password\\|senha" ')
  console.log('   Para verificar se credenciais foram commitadas no passado')
  console.log('')

  rl.close()
  process.exit(0)
}

cleanHardcodedCredentials()
