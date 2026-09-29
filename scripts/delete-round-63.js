// Remove a rodada 63 do banco telephonic (Response, Survey, QuestionIndex).
//
// SEGURANÇA:
//   - Dry-run por padrão: apenas mostra o que seria apagado.
//   - Faz BACKUP em JSON de tudo antes de apagar (pasta docs/).
//   - Só apaga com a flag --confirm.
//
// Uso:
//   node scripts/delete-round-63.js            (dry-run, não apaga nada)
//   node scripts/delete-round-63.js --confirm  (faz backup e apaga)

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getModel } = require("../config/dbManager");

const ROUND = 63;
const DB_KEY = "telephonic";
const CONFIRM = process.argv.includes("--confirm");

async function run() {
  console.log(`\n🗑️  Remoção da rodada ${ROUND} [${DB_KEY}]`);
  console.log(CONFIRM ? "✍️  MODO CONFIRMADO (vai fazer backup e apagar)\n" : "⚠️  DRY-RUN (nada será apagado). Use --confirm para executar.\n");

  const Response = await getModel("Response", DB_KEY);
  const Survey = await getModel("Survey", DB_KEY);
  const QuestionIndex = await getModel("QuestionIndex", DB_KEY);

  const respFilter = { rodada: ROUND };
  const surveyFilter = { month: ROUND };
  const qiFilter = { surveyNumber: String(ROUND) };

  // Contagens
  const respCount = await Response.countDocuments(respFilter);
  const surveyCount = await Survey.countDocuments(surveyFilter);
  const qiCount = await QuestionIndex.countDocuments(qiFilter);

  console.log("📊 Documentos encontrados:");
  console.log(`   Response       : ${respCount}`);
  console.log(`   Survey         : ${surveyCount}`);
  console.log(`   QuestionIndex  : ${qiCount}`);
  console.log(`   TOTAL          : ${respCount + surveyCount + qiCount}\n`);

  if (respCount + surveyCount + qiCount === 0) {
    console.log("Nada a apagar. Encerrando.");
    process.exit(0);
  }

  if (!CONFIRM) {
    console.log("Dry-run concluído. Para apagar de verdade rode:");
    console.log("   node scripts/delete-round-63.js --confirm\n");
    process.exit(0);
  }

  // 1) BACKUP antes de apagar
  const [respDocs, surveyDocs, qiDocs] = await Promise.all([
    Response.find(respFilter).lean(),
    Survey.find(surveyFilter).lean(),
    QuestionIndex.find(qiFilter).lean(),
  ]);

  const backupDir = path.join(__dirname, "..", "..", "docs");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `backup_round_${ROUND}_${DB_KEY}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ round: ROUND, dbKey: DB_KEY, responses: respDocs, surveys: surveyDocs, questionIndexes: qiDocs }, null, 2),
  );
  console.log(`💾 Backup salvo em: ${backupFile}`);
  console.log(`   (${respDocs.length} responses, ${surveyDocs.length} surveys, ${qiDocs.length} questionIndexes)\n`);

  // 2) Apagar
  const respDel = await Response.deleteMany(respFilter);
  const surveyDel = await Survey.deleteMany(surveyFilter);
  const qiDel = await QuestionIndex.deleteMany(qiFilter);

  console.log("🗑️  Apagado:");
  console.log(`   Response       : ${respDel.deletedCount}`);
  console.log(`   Survey         : ${surveyDel.deletedCount}`);
  console.log(`   QuestionIndex  : ${qiDel.deletedCount}\n`);

  // 3) Verificação final
  const [respLeft, surveyLeft, qiLeft] = await Promise.all([
    Response.countDocuments(respFilter),
    Survey.countDocuments(surveyFilter),
    QuestionIndex.countDocuments(qiFilter),
  ]);
  const leftover = respLeft + surveyLeft + qiLeft;
  console.log(leftover === 0
    ? `✅ Rodada ${ROUND} removida por completo.\n`
    : `⚠️  Ainda restam ${leftover} documento(s) da rodada ${ROUND}.\n`);

  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
