const { jsonResponse } = require("./_gemini");

module.exports = function handler(req, res) {
  jsonResponse(res, 200, {
    connected: false,
    message: "Online Command Center uses browser chat history plus Gemini. Supermemory is not connected on Vercel yet."
  });
};
