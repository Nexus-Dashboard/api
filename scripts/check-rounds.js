// Diagnóstico: localizar rodadas em todos os bancos e coleções (somente leitura)
// Uso: node scripts/check-rounds.js 63 64

require("dotenv").config();

const { getModel } = require("../config/dbManager");

const ROUNDS = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const DB_KEYS = ["telephonic", "telephonic_archive", "f2f"];

async function run() {
  if (ROUNDS.length === 0) {
    console.error("Informe as rodadas. Ex: node scripts/check-rounds.js 63 64");
    process.exit(1);
  }

  console.log(`\n🔍 Procurando rodada(s) ${ROUNDS.join(", ")} em todos os bancos (somente leitura)\n`);

  for (const dbKey of DB_KEYS) {
    console.log(`========== [${dbKey}] ==========`);
    try {
      const Response = await getModel("Response", dbKey);
      const Survey = await getModel("Survey", dbKey);
      const QuestionIndex = await getModel("QuestionIndex", dbKey);

      for (const round of ROUNDS) {
        const respCount = await Response.countDocuments({ rodada: round });
        const surveyDocs = await Survey.find({ month: round }).select("name year month").lean();
        const qiCount = await QuestionIndex.countDocuments({ surveyNumber: String(round) });

        console.log(`   Rodada ${round}:`);
        console.log(`      Response  (rodada=${round})            : ${respCount} doc(s)`);
        console.log(`      Survey    (month=${round})             : ${surveyDocs.length} doc(s)`);
        surveyDocs.forEach((s) => console.log(`          - "${s.name}" | year=${s.year}`));
        console.log(`      QuestionIndex (surveyNumber="${round}") : ${qiCount} doc(s)`);
      }
    } catch (err) {
      console.log(`   ⚠️  Não foi possível consultar [${dbKey}]: ${err.message}`);
    }
    console.log("");
  }

  console.log("✅ Diagnóstico completo (nada foi alterado).\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
