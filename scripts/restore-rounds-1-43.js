/**
 * Script para restaurar rodadas 1 a 43 do backup
 * Backup: telephonic_responses.json (exportado em 2025-12-03)
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BACKUP_FILE = 'C:/Users/marco/OneDrive/Desktop/Nexus/docs/mongodb_export_2025-12-03T02-18-19/telephonic_responses.json';
const BATCH_SIZE = 500;
const MAX_RODADA = 43;

const ResponseSchema = new mongoose.Schema(
  {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
    entrevistadoId: { type: String, required: true },
    answers: [{ k: String, v: mongoose.Schema.Types.Mixed, _id: false }],
    rodada: Number,
    year: Number,
  },
  { timestamps: true, minimize: false }
);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI não definida no .env');
    process.exit(1);
  }

  console.log('Conectando ao MongoDB...');
  await mongoose.connect(uri);
  console.log('Conectado!\n');

  const Response = mongoose.model('Response', ResponseSchema);

  // Verificar rodadas já existentes para não duplicar
  const existingRodadas = await Response.distinct('rodada');
  const existingSet = new Set(existingRodadas);
  console.log('Rodadas já no banco:', existingRodadas.sort((a, b) => a - b).join(', ') || 'nenhuma');

  // Carregar backup
  console.log('\nCarregando arquivo de backup...');
  const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
  const allData = JSON.parse(raw);
  console.log(`Total de registros no backup: ${allData.length}`);

  // Filtrar apenas rodadas 1 a 43 que não existem no banco
  const toInsert = allData.filter(r => r.rodada >= 1 && r.rodada <= MAX_RODADA && !existingSet.has(r.rodada));

  // Contar por rodada o que será inserido
  const rodadasParaInserir = {};
  for (const r of toInsert) {
    rodadasParaInserir[r.rodada] = (rodadasParaInserir[r.rodada] || 0) + 1;
  }

  console.log(`\nRegistros a inserir (rodadas 1-${MAX_RODADA}): ${toInsert.length}`);
  console.log('Por rodada:');
  for (const k of Object.keys(rodadasParaInserir).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  Rodada ${k}: ${rodadasParaInserir[k]} registros`);
  }

  if (toInsert.length === 0) {
    console.log('\nNada a inserir. Encerrando.');
    await mongoose.disconnect();
    return;
  }

  // Preparar documentos (remover _id do backup para deixar o MongoDB gerar novos)
  const docs = toInsert.map(r => {
    const { _id, __v, ...rest } = r;
    // Converter surveyId para ObjectId se necessário
    if (rest.surveyId && typeof rest.surveyId === 'string') {
      rest.surveyId = new mongoose.Types.ObjectId(rest.surveyId);
    }
    return rest;
  });

  // Inserir em lotes
  console.log(`\nInserindo em lotes de ${BATCH_SIZE}...`);
  let inserted = 0;
  const startTime = Date.now();

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await Response.insertMany(batch, { ordered: false });
    inserted += batch.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((inserted / docs.length) * 100).toFixed(1);
    process.stdout.write(`\r  Progresso: ${inserted}/${docs.length} (${pct}%) - ${elapsed}s`);
  }

  console.log('\n\nMigração concluída!');
  console.log(`Total inserido: ${inserted} registros`);

  // Verificação final
  console.log('\nVerificação final no banco:');
  const finalRodadas = await Response.aggregate([
    { $match: { rodada: { $lte: MAX_RODADA } } },
    { $group: { _id: '$rodada', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  for (const r of finalRodadas) {
    console.log(`  Rodada ${r._id}: ${r.count} registros`);
  }

  await mongoose.disconnect();
  console.log('\nDesconectado. Pronto!');
}

main().catch(err => {
  console.error('\nErro durante migração:', err);
  process.exit(1);
});
