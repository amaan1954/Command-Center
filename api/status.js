const { jsonResponse } = require("./_gemini");

module.exports = function handler(req, res) {
  jsonResponse(res, 200, {
    provider: "gemini",
    ready: Boolean(process.env.GEMINI_API_KEY),
    memory: "browser",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash"
  });
};
