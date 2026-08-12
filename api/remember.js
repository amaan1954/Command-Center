const { jsonResponse } = require("./_gemini");

module.exports = function handler(req, res) {
  jsonResponse(res, 200, { remembered: true, memory: "browser" });
};
