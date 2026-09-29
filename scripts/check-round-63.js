// Diagnóstico: localizar a rodada 63 em todos os bancos e coleções (somente leitura)
// Execute com: node scripts/check-round-63.js

require("dotenv").config();

const { getModel } = require("../config/dbManager");

const ROUND = 63;
const DB_KEYS = ["telephonic", "telephonic_archive", "f2f"];

async function run() {
  console.log(`\n🔍 Procurando rodada ${ROUND} em todos os bancos (somente leitura)\n`);

  for (const dbKey of DB_KEYS) {
    console.log(`========== [${dbKey}] ==========`);
    try {
      const Response = await getModel("Response", dbKey);
      const Survey = await getModel("Survey", dbKey);
      const QuestionIndex = await getModel("QuestionIndex", dbKey);

      const respCount = await Response.countDocuments({ rodada: ROUND });
      const surveyDocs = await Survey.find({ month: ROUND }).select("name year month").lean();
      const qiCount = await QuestionIndex.countDocuments({ surveyNumber: String(ROUND) });

      console.log(`   Response  (rodada=${ROUND})            : ${respCount} doc(s)`);
      console.log(`   Survey    (month=${ROUND})             : ${surveyDocs.length} doc(s)`);
      surveyDocs.forEach((s) => console.log(`       - "${s.name}" | year=${s.year}`));
      console.log(`   QuestionIndex (surveyNumber="${ROUND}") : ${qiCount} doc(s)`);
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
