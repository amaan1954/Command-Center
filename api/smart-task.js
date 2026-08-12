const { SYSTEM_CONTEXT, askGemini, compact, jsonResponse } = require("./_gemini");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Use POST" });
    return;
  }

  try {
    const body = req.body || {};
    const prompt = `
${SYSTEM_CONTEXT}

Create one practical to-do task from this brand progress note.
Be concrete. If a note says a target, done count, and left count, make the task about the remaining work.
If videos are left, default dependency is editor unless the note says otherwise.
If creatives/designs are left, default dependency is designer unless the note says otherwise.
If captions/posts/reports are left, default dependency is Amaan unless the note says otherwise.
Do not say "review schedule" unless the note literally asks for a schedule review.
Return only JSON with:
{
  "task": "Brand: action",
  "priority": "low|medium|high",
  "dependency": "none or person/team needed",
  "reason": "short reason"
}

Brand context:
${compact(body, 5000)}
`;

    const result = await askGemini(prompt, { max_output_tokens: 260, temperature: 0.2 });
    jsonResponse(res, 200, {
      task: String(result.task || ""),
      priority: result.priority || "medium",
      dependency: result.dependency || "none",
      reason: result.reason || "Created from the brand progress note"
    });
  } catch (error) {
    jsonResponse(res, error.statusCode || 500, {
      error: error.message || "Smart task request failed"
    });
  }
};
