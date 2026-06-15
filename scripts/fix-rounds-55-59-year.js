// Correção: ano 2025 -> 2026 nas rodadas 55-59 (banco telephonic)
// Causa: upload leu o ano da pasta "2025"; rodadas 55-59 são de 2026.
//
// Altera de forma consistente:
//   - QuestionIndex.date : sufixo "/25" -> "/26" (só nas rodadas 55-59, preserva "(sem data)")
//   - Survey.year        : 2025 -> 2026 (filtro year:2025, pula R59 que já está 2026)
//   - Response.year      : 2025 -> 2026 (idem)
//
// Idempotente: re-rodar não causa efeito (filtros só pegam o que ainda está errado).
// Execute com: node scripts/fix-rounds-55-59-year.js

require("dotenv").config();

const { getModel, getAllModels } = require("../config/dbManager");

const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  try {
    const dbKey = "telephonic";
    const roundsStr = ["55", "56", "57", "58", "59"];
    const roundsNum = [55, 56, 57, 58, 59];

    console.log(`\n🛠️  Correção ano 2025->2026, rodadas ${roundsNum.join(", ")} [${dbKey}]`);
    console.log(DRY_RUN ? "⚠️  MODO DRY-RUN (nenhuma escrita será feita)\n" : "✍️  MODO ESCRITA\n");

    // 1) QuestionIndex.date: trocar sufixo "/25" por "/26"
    const QuestionIndex = await getModel("QuestionIndex", dbKey);
    const qiFilter = { surveyNumber: { $in: roundsStr }, date: { $regex: /\/25$/ } };
    const qiToFix = await QuestionIndex.countDocuments(qiFilter);
    console.log(`📋 QuestionIndex: ${qiToFix} doc(s) com date terminando em "/25"`);

    if (!DRY_RUN && qiToFix > 0) {
      const res = await QuestionIndex.updateMany(qiFilter, [
        {
          $set: {
            date: {
              $concat: [
                { $substrCP: ["$date", 0, { $subtract: [{ $strLenCP: "$date" }, 2] }] },
                "26",
              ],
            },
          },
        },
      ]);
      console.log(`   ✅ QuestionIndex atualizado: ${res.modifiedCount} doc(s)`);
    }

    // 2) Survey.year: 2025 -> 2026
    const Survey = await getModel("Survey", dbKey);
    const surveyFilter = { month: { $in: roundsNum }, year: 2025 };
    const surveyToFix = await Survey.countDocuments(surveyFilter);
    console.log(`\n📋 Survey: ${surveyToFix} doc(s) com year=2025`);

    if (!DRY_RUN && surveyToFix > 0) {
      const res = await Survey.updateMany(surveyFilter, { $set: { year: 2026 } });
      console.log(`   ✅ Survey atualizado: ${res.modifiedCount} doc(s)`);
    }

    // 3) Response.year: 2025 -> 2026 (todos os models do dbKey)
    console.log(`\n📋 Response:`);
    const responseModels = await getAllModels("Response", dbKey);
    const respFilter = { rodada: { $in: roundsNum }, year: 2025 };
    for (const Response of responseModels) {
      const count = await Response.countDocuments(respFilter);
      console.log(`   [${Response.db.name}] ${count} resposta(s) com year=2025`);
      if (!DRY_RUN && count > 0) {
        const res = await Response.updateMany(respFilter, { $set: { year: 2026 } });
        console.log(`      ✅ atualizado: ${res.modifiedCount} resposta(s)`);
      }
    }

    console.log(DRY_RUN ? "\n✅ Dry-run completo (nada escrito).\n" : "\n✅ Correção aplicada.\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

run();
