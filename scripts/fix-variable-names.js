// Script para corrigir variáveis no QuestionIndex das rodadas 51, 52, 53
// Execute com: node scripts/fix-variable-names.js

// Carregar variáveis de ambiente
require("dotenv").config();

const { getModel } = require("../config/dbManager");

async function fixVariableNames() {
  try {
    console.log("\n🔧 Corrigindo nomes de variáveis no QuestionIndex...\n");

    const dbKey = "telephonic";
    const theme = "Popularidade tracking";
    const questionText = "E você aprova ou desaprova o desempenho do Governo Federal? (ESTIMULADA E ÚNICA)";

    const QuestionIndex = await getModel("QuestionIndex", dbKey);

    // Mapeamento de correções (de -> para)
    // Adiciona zero à esquerda para P1-P9
    const corrections = {
      "P1": "P01",
      "P2": "P02",
      "P3": "P03",
      "P4": "P04",
      "P5": "P05",
      "P6": "P06",
      "P7": "P07",
      "P8": "P08",
      "P9": "P09",
    };

    console.log("📋 Verificando rodadas 51, 52, 53...\n");

    let totalUpdated = 0;

    for (const round of [51, 52, 53]) {
      console.log(`\n🔍 Rodada ${round}:`);

      const questionsInRound = await QuestionIndex.find({
        index: theme,
        questionText: questionText,
        surveyNumber: round.toString(),
      }).lean();

      if (questionsInRound.length === 0) {
        console.log(`  ⚠️  Nenhuma pergunta encontrada`);
        continue;
      }

      for (const question of questionsInRound) {
        const currentVariable = question.variable;
        const correctVariable = corrections[currentVariable];

        if (correctVariable) {
          console.log(`  🔄 Atualizando variável: "${currentVariable}" → "${correctVariable}"`);

          await QuestionIndex.updateOne(
            { _id: question._id },
            { $set: { variable: correctVariable } }
          );

          totalUpdated++;
          console.log(`  ✅ Atualizado com sucesso`);
        } else {
          console.log(`  ℹ️  Variável "${currentVariable}" já está correta (não precisa atualizar)`);
        }
      }
    }

    console.log("\n\n📊 RESUMO:\n");
    console.log(`Total de registros atualizados: ${totalUpdated}`);

    if (totalUpdated > 0) {
      console.log("\n✅ Correção concluída! Agora teste o dashboard novamente.\n");
    } else {
      console.log("\nℹ️  Nenhum registro foi atualizado. As variáveis já estão corretas.\n");
      console.log("O problema pode ser outro. Execute 'node scripts/check-variable-mapping.js' para mais detalhes.\n");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao corrigir variáveis:", error);
    process.exit(1);
  }
}

// Confirmar antes de executar
console.log("\n⚠️  ATENÇÃO: Este script vai MODIFICAR o banco de dados!\n");
console.log("Ele vai adicionar zero à esquerda nas variáveis:");
console.log("P1→P01, P2→P02, P3→P03, P4→P04, P5→P05, P6→P06, P7→P07, P8→P08, P9→P09");
console.log("nas rodadas 51, 52, 53 para o tema 'Popularidade tracking'\n");

console.log("Pressione Ctrl+C para cancelar ou Enter para continuar...\n");

process.stdin.once("data", () => {
  fixVariableNames();
});
