const parseDictionarySheet = (sheetData) => {
  const allRows = sheetData.sheets["Sheet1"] || []
  if (!allRows.length) return {}

  let valuesStartIndex = -1
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i] && allRows[i][0] === "Valores de variáveis") {
      valuesStartIndex = i
      break
    }
  }

  if (valuesStartIndex === -1) {
    console.warn("Seção 'Valores de variáveis' não encontrada na planilha.")
    return {}
  }

  const parsedAnswers = {}
  let currentVariable = null

  // Começa 2 linhas depois de "Valores de variáveis" para pular o cabeçalho da seção
  for (let i = valuesStartIndex + 2; i < allRows.length; i++) {
    const row = allRows[i]
    if (!row || row.length < 3) continue // Pula linhas malformadas

    const variableName = row[0] ? row[0].trim() : null
    const value = row[1] ? row[1].toString().trim() : null
    const label = row[2] ? row[2].trim() : null

    if (variableName) {
      currentVariable = variableName
      if (!parsedAnswers[currentVariable]) {
        parsedAnswers[currentVariable] = []
      }
    }

    if (currentVariable && value && label) {
      parsedAnswers[currentVariable].push({ value, label })
    }
  }

  return parsedAnswers
}

module.exports = { parseDictionarySheet }
