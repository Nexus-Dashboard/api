// controllers/searchController.js
const { getModel } = require("../config/dbManager")

// GET /api/data/search/questions
const searchQuestions = async (req, res) => {
  const { q } = req.query
  const dbKey = req.dbKey

  if (!q || q.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Parâmetro 'q' é obrigatório e deve ter pelo menos 2 caracteres.",
    })
  }

  try {
    console.log(`🔍 Buscando perguntas com termo: "${q}" em [${dbKey}]`)

    const QuestionIndex = await getModel("QuestionIndex", dbKey)

    const searchResults = await QuestionIndex.find({
      $or: [
        { variable: { $regex: q, $options: "i" } },
        { questionText: { $regex: q, $options: "i" } },
        { label: { $regex: q, $options: "i" } },
        { surveyName: { $regex: q, $options: "i" } },
        { index: { $regex: q, $options: "i" } },
      ],
    })
      .limit(20)
      .lean()

    console.log(`✅ Encontradas ${searchResults.length} perguntas para o termo "${q}" em [${dbKey}]`)

    res.json({
      success: true,
      type: dbKey,
      searchTerm: q,
      count: searchResults.length,
      questions: searchResults,
    })
  } catch (error) {
    console.error("❌ Erro na busca de perguntas:", error)
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message,
    })
  }
}

module.exports = {
  searchQuestions,
}
