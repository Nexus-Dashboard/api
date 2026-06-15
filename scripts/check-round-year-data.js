// Diagnóstico: campo `year` em Response e coleção Survey para rodadas 55-59 (telephonic)
// Somente leitura.
// Execute com: node scripts/check-round-year-data.js

require("dotenv").config();

const { getModel, getAllModels } = require("../config/dbManager");

async function run() {
  try {
    const dbKey = "telephonic";
    const targetRounds = [55, 56, 57, 58, 59];

    console.log(`\n🔍 Ano em Response e Survey para rodadas ${targetRounds.join(", ")} [${dbKey}]\n`);

    // Survey collection
    console.log("📋 Coleção Survey (year/month):");
    const Survey = await getModel("Survey", dbKey);
    const surveys = await Survey.find({ month: { $in: targetRounds } })
      .select("name year month")
      .lean();
    if (surveys.length === 0) {
      console.log("   (nenhum documento Survey encontrado para essas rodadas)");
    }
    surveys
      .sort((a, b) => a.month - b.month)
      .forEach((s) => console.log(`   R${s.month}: year=${s.year} | name="${s.name}"`));

    // Response collection - distribuição de `year` por rodada
    console.log("\n📋 Coleção Response (distribuição de year por rodada):");
    const responseModels = await getAllModels("Response", dbKey);
    for (const Response of responseModels) {
      console.log(`   [DB: ${Response.db.name}]`);
      const agg = await Response.aggregate([
        { $match: { rodada: { $in: targetRounds } } },
        { $group: { _id: { rodada: "$rodada", year: "$year" }, count: { $sum: 1 } } },
        { $sort: { "_id.rodada": 1 } },
      ]);
      if (agg.length === 0) console.log("      (nenhuma resposta)");
      agg.forEach((a) =>
        console.log(`      R${a._id.rodada}: year=${a._id.year} -> ${a.count} respostas`)
      );
    }

    console.log("\n✅ Diagnóstico completo (somente leitura).\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

run();
