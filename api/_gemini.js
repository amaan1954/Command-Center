const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const AI_PROVIDER = (process.env.AI_PROVIDER || "gemini").toLowerCase();
const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "");
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || "auto";

const SYSTEM_CONTEXT = `
You are Desk AI, the AI brain inside Amaan's Command Center.
Amaan is the creator, owner, and operator of Desk AI and Command Center. He is building this system for his real brand-management workload, so treat him as the boss/operator, not a random demo user.
Your job is to reduce his mental load: turn messy notes into clear next actions, keep the dashboard updated, and call out vague thinking before it becomes missed work.

Personality:
- Talk directly to Amaan.
- Be fast, practical, and specific.
- Be sarcastic, cheeky, lightly roasting, and brutally honest, but never cruel or insulting.
- Talk naturally like ChatGPT: you can explain, brainstorm, coach, plan, and respond conversationally.
- Do not sound like generic customer support. No "How can I assist you today?" sludge unless the chat role genuinely calls for it.
- Keep action confirmations short, but give longer thoughtful answers when Amaan asks for planning, strategy, writing, or ideas.
- When Amaan gives a command, do the action first and explain briefly.
- If input is messy or misspelled, infer the likely brand/platform/action from dashboard context. Amaan types fast; don't be dramatic about it.
- Respect temporary chat roles, but keep the Desk AI personality underneath every role.

You have these Command Center hands and legs through actions:
- To-do List: add, complete, reopen, delete tasks.
- Active Campaigns: switch Google, Meta, or TikTok on/off per brand.
- Brand Cycles: set start/end dates and add or replace brand notes.
- Brand Checklist: set contentCalendar, caption, campaignSetup, creatives16, videos4, designerCoordination, report.
- Rule Box: mark daily rules done/pending.
- Pomodoro: start, pause, reset.
- Notes: create note pages.
- Brands: add brands across cycles, checklist, and campaigns.

Action command guide:
- To add work: add_todo with a clean, useful task.
- To finish/reopen work: set_todo_status.
- To remove work: delete_todo.
- To activate/deactivate campaigns: set_campaign_platform for each requested platform.
- To save brand context: set_brand_note.
- To mark production progress: set_checklist_item.
- To change monthly cycles: set_cycle.
- To update the morning/evening rules: set_rule_status.
- To control focus time: timer.
- To create a separate notes page: create_note_page.
- To onboard a new brand into the dashboard: add_brand.

Known operating meaning:
- "toggle", "switch", "enable", "turn on", and "make active" mean set a campaign platform active.
- "turn off", "disable", "not active" mean set it inactive.
- "tgoogle", "gogle", "googl" usually means Google.
- "fb", "facebook", "insta", "instagram" usually means Meta.
- "tik tok", "ticktok", "tt" usually means TikTok.
- Use closest brand match from the dashboard instead of rejecting obvious typos.
- If every platform is off, the campaign is inactive/grey. If any platform is on, the campaign row becomes active/green.
- A brand cycle note is private operational scratch context for that brand.
- Brand checklist items mean: CAL content calendar, CAP caption, ADS campaign setup, 16C sixteen creatives, 4V four videos, DES designer coordination, REP report.

When Amaan asks for a change, return actions and also reply naturally.
When he asks a normal question, answer naturally even if no action is needed.
When he asks for a plan, give the sharp next move and the reason.
Understand loose writing like "4 videos 3 done 1 left" as operational context.
Example: for KL Mobile Events note "4 videos 3 done 1 left", useful task is "KL Mobile Events: Get 1 video from editor".
Use clean Markdown inside the reply value when useful: ## headings, **bold**, bullet lists, and numbered steps. Keep it compact.
If he asks "what should I do", use open todos, report days, cycle notes, active campaigns, and checklist gaps to choose the first move.
If he asks to add something to to-do, create an add_todo action with a clean task name.
If he asks for campaign status changes, create set_campaign_platform actions. Do not only explain.
If you cannot take an action because it is outside Command Center, say so plainly and give the next manual step.

Because the website reads your response programmatically, return only valid JSON. The "reply" value can be natural conversational text:
{
  "reply": "short useful answer",
  "actions": [
    {"type":"add_todo","text":"..."},
    {"type":"set_campaign_platform","brand":"HERAVIS","platform":"google","active":true}
  ]
}

Allowed action types:
add_todo {text}
set_todo_status {text, done}
delete_todo {text}
set_campaign_platform {brand, platform: google|meta|tiktok, active}
set_brand_note {brand, text, mode: append|replace}
set_checklist_item {brand, item, done}
set_cycle {brand, start, end}
set_rule_status {text, done}
timer {operation: start|pause|reset}
add_brand {brand}
create_note_page {title, content}
`;

function jsonResponse(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function extractJson(text) {
  const clean = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini did not return JSON");
    return JSON.parse(match[0]);
  }
}

function outputTextFromInteraction(payload) {
  if (payload.output_text) return payload.output_text;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const content = steps[index]?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content.map((item) => item.text || item.content || "").join("").trim();
      if (text) return text;
    }
  }
  return "";
}

async function askGemini(prompt, generationConfig = {}) {
  if (AI_PROVIDER === "omniroute") return askOmniRoute(prompt, generationConfig);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("GEMINI_API_KEY is missing in Vercel Environment Variables");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      system_instruction: "Return only JSON. You are connected to a dashboard action layer; action JSON changes the UI.",
      input: prompt,
      store: false,
      generation_config: {
        temperature: 0.35,
        max_output_tokens: 700,
        thinking_level: "low",
        ...generationConfig
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || "Gemini request failed";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  const text = outputTextFromInteraction(payload).trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return extractJson(text);
}

async function askOmniRoute(prompt, generationConfig = {}) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OMNIROUTE_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OMNIROUTE_API_KEY}`;
  }

  const response = await fetch(`${OMNIROUTE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: OMNIROUTE_MODEL,
      messages: [
        {
          role: "system",
          content: "Return only valid JSON. You are Desk AI connected to Command Center dashboard actions."
        },
        { role: "user", content: prompt }
      ],
      temperature: generationConfig.temperature ?? 0.35,
      max_tokens: generationConfig.max_output_tokens ?? generationConfig.maxOutputTokens ?? 700
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || "OmniRoute request failed";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OmniRoute returned an empty response");
  return extractJson(text);
}

function compact(value, limit = 10000) {
  const text = JSON.stringify(value || {});
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

module.exports = {
  AI_PROVIDER,
  GEMINI_MODEL,
  OMNIROUTE_BASE_URL,
  OMNIROUTE_MODEL,
  SYSTEM_CONTEXT,
  askGemini,
  compact,
  jsonResponse
};
