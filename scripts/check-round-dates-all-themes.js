// Diagnóstico: alcance do problema das rodadas 55-59 em TODOS os temas (telephonic)
// Somente leitura.
// Execute com: node scripts/check-round-dates-all-themes.js

require("dotenv").config();

const { getModel } = require("../config/dbManager");

async function run() {
  try {
    const dbKey = "telephonic";
    const targetRounds = ["55", "56", "57", "58", "59"];

    console.log(`\n🔍 Rodadas ${targetRounds.join(", ")} em TODOS os temas [${dbKey}]\n`);

    const QuestionIndex = await getModel("QuestionIndex", dbKey);

    for (const r of targetRounds) {
      const docs = await QuestionIndex.find({ surveyNumber: r })
        .select("date index")
        .lean();

      const byDate = {};
      const themes = new Set();
      for (const d of docs) {
        const key = d.date || "(sem data)";
        byDate[key] = (byDate[key] || 0) + 1;
        if (d.index) themes.add(d.index);
      }

      console.log(`R${r}: ${docs.length} documentos | temas: ${themes.size}`);
      for (const [date, count] of Object.entries(byDate)) {
        console.log(`   - "${date}": ${count} doc(s)`);
      }
      console.log("");
    }

    console.log("✅ Diagnóstico completo (somente leitura).\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

run();
