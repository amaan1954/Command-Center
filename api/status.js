const { AI_PROVIDER, GEMINI_MODEL, OMNIROUTE_BASE_URL, OMNIROUTE_MODEL, jsonResponse } = require("./_gemini");
const { isSupabaseReady } = require("./_supabase");

module.exports = function handler(req, res) {
  jsonResponse(res, 200, {
    provider: AI_PROVIDER,
    ready: AI_PROVIDER === "omniroute" ? Boolean(OMNIROUTE_BASE_URL) : Boolean(process.env.GEMINI_API_KEY),
    memory: isSupabaseReady() ? "supabase" : "browser",
    dashboardSync: isSupabaseReady() ? "supabase" : "browser-only",
    model: AI_PROVIDER === "omniroute" ? OMNIROUTE_MODEL : GEMINI_MODEL,
    baseUrl: AI_PROVIDER === "omniroute" ? OMNIROUTE_BASE_URL : undefined
  });
};
