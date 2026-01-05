// Script para verificar se as rodadas 51, 52, 53 existem no banco de dados
// Execute com: node scripts/check-missing-rounds.js

// Carregar variáveis de ambiente
require("dotenv").config();

const { getModel } = require("../config/dbManager");

async function checkMissingRounds() {
  try {
    console.log("\n🔍 Verificando rodadas 51, 52, 53 no banco telephonic...\n");

    const dbKey = "telephonic";
    const theme = "Popularidade tracking";
    const missingRounds = [51, 52, 53];

    // 1. Verificar QuestionIndex
    console.log("📋 ETAPA 1: Verificando QuestionIndex\n");
    const QuestionIndex = await getModel("QuestionIndex", dbKey);

    for (const round of missingRounds) {
      const questions = await QuestionIndex.find({
        index: theme,
        surveyNumber: round.toString(),
      }).lean();

      console.log(`Rodada ${round}:`);
      console.log(`  - Total de perguntas encontradas: ${questions.length}`);

      if (questions.length > 0) {
        console.log(`  - Variáveis: ${questions.map(q => q.variable).join(", ")}`);
        console.log(`  - Data: ${questions[0].date || "não definida"}`);
        console.log(`  - Exemplo de questionText: ${questions[0].questionText?.substring(0, 80)}...`);
      } else {
        console.log(`  ❌ Nenhuma pergunta encontrada para o tema "${theme}"`);
      }
      console.log("");
    }

    // 2. Verificar todas as rodadas disponíveis para este tema
    console.log("\n📋 ETAPA 2: Verificando todas as rodadas disponíveis para este tema\n");
    const allQuestions = await QuestionIndex.find({
      index: theme,
    })
      .select("surveyNumber")
      .lean();

    const allRounds = [...new Set(allQuestions.map(q => parseInt(q.surveyNumber)))].sort((a, b) => b - a);
    console.log(`Total de rodadas encontradas: ${allRounds.length}`);
    console.log(`Rodadas: ${allRounds.join(", ")}`);
    console.log("");

    // 3. Verificar se há perguntas similares em outras rodadas
    console.log("\n📋 ETAPA 3: Verificando pergunta específica em todas as rodadas\n");
    const questionText = "E você aprova ou desaprova o desempenho do Governo Federal? (ESTIMULADA E ÚNICA)";

    const questionsWithThisText = await QuestionIndex.find({
      index: theme,
      questionText: questionText,
    })
      .select("surveyNumber variable date")
      .lean();

    const roundsWithThisQuestion = [...new Set(questionsWithThisText.map(q => q.surveyNumber))].sort((a, b) => parseInt(b) - parseInt(a));
    console.log(`Pergunta: "${questionText}"`);
    console.log(`Rodadas com esta pergunta: ${roundsWithThisQuestion.join(", ")}`);
    console.log("");

    // Verificar se as rodadas 51, 52, 53 têm esta pergunta
    for (const round of missingRounds) {
      const hasQuestion = roundsWithThisQuestion.includes(round.toString());
      if (hasQuestion) {
        console.log(`✅ Rodada ${round}: TEM esta pergunta`);
      } else {
        console.log(`❌ Rodada ${round}: NÃO TEM esta pergunta`);
      }
    }

    // 4. Buscar variações do texto da pergunta nas rodadas 51, 52, 53
    console.log("\n\n📋 ETAPA 4: Buscando todas as perguntas nas rodadas 51, 52, 53 (qualquer texto)\n");

    for (const round of missingRounds) {
      const allQuestionsInRound = await QuestionIndex.find({
        index: theme,
        surveyNumber: round.toString(),
      })
        .select("questionText variable")
        .lean();

      console.log(`\nRodada ${round}:`);
      if (allQuestionsInRound.length > 0) {
        console.log(`  Total de perguntas: ${allQuestionsInRound.length}`);
        console.log(`  Textos encontrados:`);
        const uniqueTexts = [...new Set(allQuestionsInRound.map(q => q.questionText))];
        uniqueTexts.forEach((text, idx) => {
          console.log(`    ${idx + 1}. ${text.substring(0, 100)}...`);
        });
      } else {
        console.log(`  ❌ Nenhuma pergunta encontrada`);
      }
    }

    console.log("\n\n✅ Diagnóstico completo!\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao verificar rodadas:", error);
    process.exit(1);
  }
}

checkMissingRounds();
