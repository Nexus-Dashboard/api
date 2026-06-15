// Diagnóstico: lista o campo `date` por rodada no QuestionIndex
// Somente leitura - não altera nada.
// Execute com: node scripts/check-round-dates.js

require("dotenv").config();

const { getModel } = require("../config/dbManager");

async function checkRoundDates() {
  try {
    const dbKey = "telephonic";
    const theme = "Popularidade tracking";

    console.log(`\n🔍 Datas por rodada em [${dbKey}] / tema "${theme}"\n`);

    const QuestionIndex = await getModel("QuestionIndex", dbKey);

    // Pega uma data por rodada (qualquer pergunta serve, a data é da rodada)
    const docs = await QuestionIndex.find({ index: theme })
      .select("surveyNumber date variable")
      .lean();

    const byRound = new Map();
    for (const d of docs) {
      const n = parseInt(d.surveyNumber);
      if (!byRound.has(n)) byRound.set(n, new Set());
      byRound.get(n).add(d.date || "(sem data)");
    }

    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    console.log("Rodada | Datas distintas gravadas");
    console.log("-------|--------------------------");
    for (const r of rounds) {
      const dates = [...byRound.get(r)].join(" | ");
      const flag = r >= 53 && r <= 62 ? " <==" : "";
      console.log(`R${String(r).padStart(2, "0")}    | ${dates}${flag}`);
    }

    console.log("\n✅ Diagnóstico completo (somente leitura).\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

checkRoundDates();
