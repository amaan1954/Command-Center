const { SYSTEM_CONTEXT, askGemini, compact, jsonResponse } = require("./_gemini");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Use POST" });
    return;
  }

  try {
    const body = req.body || {};
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const prompt = `
${SYSTEM_CONTEXT}

Temporary chat role:
${body.role || "Command Center operations copilot"}

Chat title:
${body.chat_title || "Desk AI"}

Recent chat:
${compact(history, 5000)}

Live dashboard context:
${compact(body.dashboard, 9000)}

Amaan says:
${body.message || ""}

Decision rule:
If the request can be performed using an allowed Command Center action, include the action in actions.
If the request is a question or planning request, answer from the live dashboard context.
If the request has typos, infer the closest valid brand/platform/action from context.
If you are unsure between two real dashboard options, ask one short clarification question instead of making a risky change.
`;

    const result = await askGemini(prompt, { maxOutputTokens: 520, temperature: 0.3 });
    jsonResponse(res, 200, {
      reply: String(result.reply || "I got the request, but my answer came back suspiciously blank."),
      actions: Array.isArray(result.actions) ? result.actions : []
    });
  } catch (error) {
    jsonResponse(res, error.statusCode || 500, {
      error: error.message || "Desk AI request failed"
    });
  }
};
