// Script para verificar se existem dados de respostas para as rodadas 51, 52, 53
// Execute com: node scripts/check-response-data.js

// Carregar variáveis de ambiente
require("dotenv").config();

const { getModel, getAllModels } = require("../config/dbManager");

async function checkResponseData() {
  try {
    console.log("\n🔍 Verificando dados de respostas para rodadas 51, 52, 53...\n");

    const dbKey = "telephonic";
    const missingRounds = [51, 52, 53];

    // 1. Verificar QuestionIndex primeiro
    console.log("📋 ETAPA 1: Verificando QuestionIndex\n");
    const QuestionIndex = await getModel("QuestionIndex", dbKey);

    for (const round of missingRounds) {
      const questions = await QuestionIndex.find({
        surveyNumber: round.toString(),
      })
        .select("variable index questionText")
        .limit(3)
        .lean();

      console.log(`Rodada ${round} no QuestionIndex:`);
      if (questions.length > 0) {
        console.log(`  ✅ Encontradas perguntas cadastradas`);
        console.log(`  - Variáveis: ${questions.map(q => q.variable).join(", ")}...`);
        console.log(`  - Temas: ${[...new Set(questions.map(q => q.index))].join(", ")}`);
      } else {
        console.log(`  ❌ Nenhuma pergunta cadastrada`);
      }
      console.log("");
    }

    // 2. Verificar Response collections
    console.log("\n📊 ETAPA 2: Verificando coleções de Respostas\n");
    const responseModels = await getAllModels("Response", dbKey);

    console.log(`Total de coleções Response encontradas: ${responseModels.length}\n`);

    for (const Response of responseModels) {
      console.log(`📁 Coleção: ${Response.collection.name}`);

      for (const round of missingRounds) {
        const count = await Response.countDocuments({ rodada: round });
        console.log(`  Rodada ${round}: ${count} registros`);
      }
      console.log("");
    }

    // 3. Verificar se há dados em qualquer rodada acima de 50
    console.log("\n📊 ETAPA 3: Verificando todas as rodadas > 50\n");

    for (const Response of responseModels) {
      const highRounds = await Response.distinct("rodada", { rodada: { $gt: 50 } });

      if (highRounds.length > 0) {
        console.log(`📁 ${Response.collection.name}:`);
        console.log(`  Rodadas > 50: ${highRounds.sort((a, b) => a - b).join(", ")}`);

        for (const round of highRounds) {
          const count = await Response.countDocuments({ rodada: round });
          console.log(`    Rodada ${round}: ${count} registros`);
        }
      }
    }

    // 4. Verificar variáveis específicas das rodadas 51, 52, 53
    console.log("\n\n📊 ETAPA 4: Verificando variáveis específicas P03, P05, P02\n");

    const variables = ["P03", "P05", "P02"];

    for (const Response of responseModels) {
      console.log(`📁 Coleção: ${Response.collection.name}`);

      for (const round of missingRounds) {
        for (const variable of variables) {
          const count = await Response.countDocuments({
            rodada: round,
            "answers.k": variable,
          });

          if (count > 0) {
            console.log(`  ✅ Rodada ${round}, Variável ${variable}: ${count} registros`);
          } else {
            console.log(`  ❌ Rodada ${round}, Variável ${variable}: 0 registros`);
          }
        }
      }
      console.log("");
    }

    // 5. Resumo final
    console.log("\n\n📋 RESUMO\n");
    console.log("Se você vê:");
    console.log("  ✅ Perguntas no QuestionIndex MAS ❌ 0 registros nas Respostas");
    console.log("  → As rodadas 51, 52, 53 precisam ter seus dados importados\n");
    console.log("Se você vê:");
    console.log("  ✅ Perguntas no QuestionIndex E ✅ registros nas Respostas");
    console.log("  → Há um problema na query ou no código do backend\n");

    console.log("✅ Diagnóstico completo!\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao verificar dados:", error);
    process.exit(1);
  }
}

checkResponseData();
