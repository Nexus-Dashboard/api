// scripts/check-mongodb-data.js
require('dotenv').config();
const { getModel } = require('../config/dbManager');

async function checkMongoDBData() {
  console.log('🔍 INVESTIGANDO DADOS NO MONGODB\n');
  console.log('='.repeat(70) + '\n');

  try {
    // ==================== QUESTION INDEX ====================
    console.log('📋 1. QUESTION INDEX (QuestionIndex)');
    console.log('-'.repeat(70));
    
    const QuestionIndex = await getModel('QuestionIndex', 'telephonic');
    const totalQuestions = await QuestionIndex.countDocuments();
    console.log(`   Total de perguntas: ${totalQuestions.toLocaleString()}\n`);

    // Ver rodadas únicas
    const uniqueSurveyNumbers = await QuestionIndex.distinct('surveyNumber');
    console.log(`   📊 Rodadas encontradas (${uniqueSurveyNumbers.length}):`);
    uniqueSurveyNumbers.slice(0, 20).forEach(sn => {
      console.log(`      - "${sn}"`);
    });
    if (uniqueSurveyNumbers.length > 20) {
      console.log(`      ... e mais ${uniqueSurveyNumbers.length - 20} rodadas`);
    }

    // Exemplo de pergunta
    const sampleQuestion = await QuestionIndex.findOne().lean();
    if (sampleQuestion) {
      console.log(`\n   📄 Exemplo de pergunta:`);
      console.log(`      ID: ${sampleQuestion._id}`);
      console.log(`      surveyNumber: "${sampleQuestion.surveyNumber}"`);
      console.log(`      surveyName: "${sampleQuestion.surveyName}"`);
      console.log(`      variable: "${sampleQuestion.variable}"`);
      console.log(`      questionText: "${sampleQuestion.questionText.substring(0, 60)}..."`);
      console.log(`      index (theme): "${sampleQuestion.index}"`);
    }

    console.log('\n' + '='.repeat(70) + '\n');

    // ==================== SURVEYS ====================
    console.log('📊 2. SURVEYS (Survey)');
    console.log('-'.repeat(70));
    
    const Survey = await getModel('Survey', 'telephonic');
    const totalSurveys = await Survey.countDocuments();
    console.log(`   Total de surveys: ${totalSurveys.toLocaleString()}\n`);

    if (totalSurveys > 0) {
      // Ver anos e meses disponíveis
      const uniqueYears = await Survey.distinct('year');
      const uniqueMonths = await Survey.distinct('month');
      
      console.log(`   📅 Anos disponíveis: ${uniqueYears.join(', ')}`);
      console.log(`   📅 Meses/Rodadas: ${uniqueMonths.slice(0, 20).join(', ')}`);

      // Listar algumas surveys
      const surveys = await Survey.find().limit(10).lean();
      console.log(`\n   📄 Exemplos de surveys:`);
      surveys.forEach(s => {
        console.log(`      - ${s.name} (year: ${s.year}, month: ${s.month})`);
      });
    } else {
      console.log(`   ⚠️  Nenhuma survey encontrada!`);
      console.log(`   💡 Isso pode ser normal se você ainda não importou surveys`);
    }

    console.log('\n' + '='.repeat(70) + '\n');

    // ==================== RESPONSES ====================
    console.log('💾 3. RESPONSES (Response)');
    console.log('-'.repeat(70));
    
    const Response = await getModel('Response', 'telephonic');
    const totalResponses = await Response.countDocuments();
    console.log(`   Total de respostas: ${totalResponses.toLocaleString()}\n`);

    if (totalResponses > 0) {
      // Ver anos e rodadas disponíveis
      const uniqueResponseYears = await Response.distinct('year');
      const uniqueRodadas = await Response.distinct('rodada');
      
      console.log(`   📅 Anos disponíveis: ${uniqueResponseYears.join(', ')}`);
      console.log(`   📅 Rodadas disponíveis (${uniqueRodadas.length}):`);
      console.log(`      ${uniqueRodadas.slice(0, 20).join(', ')}`);
      if (uniqueRodadas.length > 20) {
        console.log(`      ... e mais ${uniqueRodadas.length - 20} rodadas`);
      }

      // Contar por ano e rodada
      console.log(`\n   📊 Distribuição por ano/rodada (últimas 10):`);
      const distribution = await Response.aggregate([
        {
          $group: {
            _id: { year: '$year', rodada: '$rodada' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': -1, '_id.rodada': -1 } },
        { $limit: 10 }
      ]);

      distribution.forEach(d => {
        console.log(`      ${d._id.year} - Rodada ${d._id.rodada}: ${d.count.toLocaleString()} respostas`);
      });

      // Exemplo de resposta
      const sampleResponse = await Response.findOne().lean();
      if (sampleResponse) {
        console.log(`\n   📄 Exemplo de resposta:`);
        console.log(`      ID: ${sampleResponse._id}`);
        console.log(`      surveyId: ${sampleResponse.surveyId}`);
        console.log(`      entrevistadoId: ${sampleResponse.entrevistadoId}`);
        console.log(`      year: ${sampleResponse.year} (tipo: ${typeof sampleResponse.year})`);
        console.log(`      rodada: ${sampleResponse.rodada} (tipo: ${typeof sampleResponse.rodada})`);
        console.log(`      Quantidade de answers: ${sampleResponse.answers?.length || 0}`);
        
        if (sampleResponse.answers && sampleResponse.answers.length > 0) {
          console.log(`      Exemplo de answers (primeiras 3):`);
          sampleResponse.answers.slice(0, 3).forEach(a => {
            console.log(`         ${a.k}: ${a.v}`);
          });
        }
      }
    } else {
      console.log(`   ⚠️  Nenhuma resposta encontrada!`);
      console.log(`   ❌ Isso é um problema - você precisa ter responses para migrar`);
    }

    console.log('\n' + '='.repeat(70) + '\n');

    // ==================== SUGESTÕES ====================
    console.log('💡 4. SUGESTÕES PARA MIGRAÇÃO');
    console.log('-'.repeat(70));

    if (totalResponses > 0 && uniqueSurveyNumbers.length > 0) {
      // Encontrar a melhor combinação
      const lastResponse = await Response.findOne().sort({ year: -1, rodada: -1 }).lean();
      
      if (lastResponse) {
        const year = lastResponse.year;
        const rodada = lastResponse.rodada;
        
        // Contar quantas respostas tem nessa rodada
        const countInRodada = await Response.countDocuments({ year, rodada });
        
        console.log(`\n   ✅ Dados encontrados! Use este comando:\n`);
        console.log(`   📌 npm run bq:migrate ${year} ${rodada}`);
        console.log(`\n   📊 Esta rodada tem ${countInRodada.toLocaleString()} respostas\n`);

        // Verificar se existe questionIndex correspondente
        const matchingQuestions = await QuestionIndex.countDocuments({
          $or: [
            { surveyNumber: rodada.toString() },
            { surveyNumber: `Rodada ${rodada.toString().padStart(2, '0')}` },
            { surveyNumber: `Rodada ${rodada}` }
          ]
        });

        if (matchingQuestions > 0) {
          console.log(`   ✅ Encontradas ${matchingQuestions} perguntas correspondentes`);
        } else {
          console.log(`   ⚠️  ATENÇÃO: Não encontrei perguntas para esta rodada!`);
          console.log(`   📋 Rodadas disponíveis no QuestionIndex:`);
          uniqueSurveyNumbers.slice(0, 5).forEach(sn => {
            console.log(`      - "${sn}"`);
          });
        }

        // Sugerir rodadas alternativas menores
        console.log(`\n   💡 Sugestões de rodadas para teste (menores):`);
        
        const smallRodadas = await Response.aggregate([
          {
            $group: {
              _id: { year: '$year', rodada: '$rodada' },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: 1 } },
          { $limit: 5 }
        ]);

        smallRodadas.forEach((r, i) => {
          console.log(`      ${i + 1}. npm run bq:migrate ${r._id.year} ${r._id.rodada} (${r.count.toLocaleString()} respostas)`);
        });
      }
    } else {
      console.log(`\n   ❌ PROBLEMA: Sem dados suficientes para migrar`);
      
      if (totalQuestions === 0) {
        console.log(`   📋 Execute primeiro: npm run sync-index`);
      }
      if (totalResponses === 0) {
        console.log(`   💾 Execute primeiro: npm run sync-surveys`);
      }
    }

    console.log('\n' + '='.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Erro ao verificar dados:', error);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  checkMongoDBData()
    .then(() => {
      console.log('✅ Verificação concluída!\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = checkMongoDBData;