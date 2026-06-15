// Diagnóstico: o que cada variável demográfica (PF*) significa por rodada (telephonic)
// e quais valores distintos aparecem nas respostas. Somente leitura.
// Execute com: node scripts/check-demographic-meaning.js

require("dotenv").config();

const { getModel, getAllModels } = require("../config/dbManager");

const DEMO_VARS = ["PF1", "PF2_FAIXAS", "PF3", "PF4", "PF5", "PF6", "PF7", "PF8", "PF9", "PF10", "PF13", "PF15"];

async function run() {
  try {
    const dbKey = "telephonic";
    console.log(`\n🔍 Significado das variáveis demográficas por rodada [${dbKey}]\n`);

    // 1) Labels por variável/rodada no QuestionIndex
    const QuestionIndex = await getModel("QuestionIndex", dbKey);
    for (const v of DEMO_VARS) {
      const docs = await QuestionIndex.find({ variable: v })
        .select("surveyNumber label questionText")
        .lean();

      // agrupar rodadas por label
      const byLabel = {};
      for (const d of docs) {
        const lab = (d.label || d.questionText || "(sem label)").trim();
        if (!byLabel[lab]) byLabel[lab] = [];
        byLabel[lab].push(parseInt(d.surveyNumber));
      }
      console.log(`\n=== ${v} ===`);
      if (docs.length === 0) {
        console.log("   (não existe no QuestionIndex)");
        continue;
      }
      for (const [lab, rounds] of Object.entries(byLabel)) {
        rounds.sort((a, b) => a - b);
        const rng = `${Math.min(...rounds)}-${Math.max(...rounds)} (${rounds.length} rodadas)`;
        console.log(`   "${lab}"  →  rodadas ${rng}`);
      }
    }

    // 2) Valores distintos de PF15 por rodada nas RESPOSTAS (amostra)
    console.log(`\n\n🔬 Valores distintos de PF15 nas respostas, por rodada:\n`);
    const responseModels = await getAllModels("Response", dbKey);
    for (const Response of responseModels) {
      if (Response.db.name !== "telephonic") continue;
      const agg = await Response.aggregate([
        { $unwind: "$answers" },
        { $match: { "answers.k": "PF15" } },
        { $group: { _id: { rodada: "$rodada", v: "$answers.v" }, n: { $sum: 1 } } },
        { $group: { _id: "$_id.rodada", valores: { $addToSet: "$_id.v" } } },
        { $sort: { _id: 1 } },
      ], { allowDiskUse: true, maxTimeMS: 60000 });

      agg.forEach((r) => {
        const vals = r.valores.filter(Boolean).slice(0, 12);
        console.log(`   R${r._id}: [${vals.join(" | ")}]${r.valores.length > 12 ? " ..." : ""}`);
      });
    }

    console.log("\n✅ Diagnóstico completo (somente leitura).\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

run();
