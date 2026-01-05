// Script para verificar o mapeamento de variáveis no QuestionIndex
// Execute com: node scripts/check-variable-mapping.js

// Carregar variáveis de ambiente
require("dotenv").config();

const { getModel } = require("../config/dbManager");

async function checkVariableMapping() {
  try {
    console.log("\n🔍 Verificando mapeamento de variáveis para a pergunta de aprovação...\n");

    const dbKey = "telephonic";
    const theme = "Popularidade tracking";
    const questionText = "E você aprova ou desaprova o desempenho do Governo Federal? (ESTIMULADA E ÚNICA)";

    const QuestionIndex = await getModel("QuestionIndex", dbKey);

    // Buscar todas as variações desta pergunta
    const allQuestions = await QuestionIndex.find({
      index: theme,
      questionText: questionText,
    })
      .select("surveyNumber variable")
      .lean();

    console.log(`Total de registros encontrados: ${allQuestions.length}\n`);

    // Agrupar por rodada
    const byRound = {};
    allQuestions.forEach(q => {
      const round = q.surveyNumber;
      if (!byRound[round]) {
        byRound[round] = [];
      }
      byRound[round].push(q.variable);
    });

    // Mostrar todas as rodadas
    const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);

    console.log("📋 Mapeamento de variáveis por rodada:\n");
    rounds.forEach(round => {
      const variables = byRound[round];
      const marker = (round >= 51 && round <= 53) ? "🔴" : "✅";
      console.log(`${marker} Rodada ${round}: ${variables.join(", ")}`);
    });

    // Focar nas rodadas problemáticas
    console.log("\n\n🔍 ANÁLISE DETALHADA DAS RODADAS 51, 52, 53:\n");

    for (const round of [51, 52, 53]) {
      console.log(`\n📋 Rodada ${round}:`);

      const questionsInRound = await QuestionIndex.find({
        index: theme,
        questionText: questionText,
        surveyNumber: round.toString(),
      }).lean();

      if (questionsInRound.length > 0) {
        const q = questionsInRound[0];
        console.log(`  ✅ Encontrado no QuestionIndex`);
        console.log(`  - Variável cadastrada: "${q.variable}"`);
        console.log(`  - ID: ${q._id}`);
        console.log(`  - Data: ${q.date || "não definida"}`);
      } else {
        console.log(`  ❌ NÃO encontrado no QuestionIndex`);
      }
    }

    // Verificar se há diferença no padrão de nomenclatura
    console.log("\n\n📊 ANÁLISE DE PADRÕES:\n");

    const variablesSet = new Set();
    allQuestions.forEach(q => variablesSet.add(q.variable));
    const uniqueVariables = Array.from(variablesSet);

    console.log(`Variáveis únicas encontradas: ${uniqueVariables.join(", ")}`);

    const hasP2 = uniqueVariables.includes("P2");
    const hasP02 = uniqueVariables.includes("P02");
    const hasP3 = uniqueVariables.includes("P3");
    const hasP03 = uniqueVariables.includes("P03");
    const hasP5 = uniqueVariables.includes("P5");
    const hasP05 = uniqueVariables.includes("P05");

    console.log("\nFormatos encontrados:");
    if (hasP2 || hasP3 || hasP5) {
      console.log("  ✅ Formato SEM zero (P2, P3, P5)");
    }
    if (hasP02 || hasP03 || hasP05) {
      console.log("  ✅ Formato COM zero (P02, P03, P05)");
    }

    console.log("\n\n💡 RECOMENDAÇÃO:\n");
    console.log("Se as rodadas 51, 52, 53 usam variáveis DIFERENTES das outras rodadas,");
    console.log("você precisa ATUALIZAR o QuestionIndex para usar as variáveis corretas.");
    console.log("\nPor exemplo, se os dados usam 'P5' mas o QuestionIndex tem 'P05',");
    console.log("você precisa corrigir o QuestionIndex.\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao verificar mapeamento:", error);
    process.exit(1);
  }
}

checkVariableMapping();
