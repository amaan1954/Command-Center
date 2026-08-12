"""Local Command Center server with an Ollama task-assistant endpoint."""

import json
import os
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MEMORY_PATH = DATA_DIR / "desk-ai-memory.json"
SECRETS_PATH = DATA_DIR / "secrets.json"
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags"
OLLAMA_MODEL = "command-center"
SUPERMEMORY_SEARCH_URL = "https://api.supermemory.ai/v4/search"
SUPERMEMORY_ADD_URL = "https://api.supermemory.ai/v3/documents"
SUPERMEMORY_CONTAINER = "amaan-command-center"
MEMORY_LOCK = Lock()

CREATOR_IDENTITY = """CREATOR IDENTITY
- The person speaking to you is Amaan, the creator and owner of this Command Center and Desk AI.
- Treat Amaan as the authority for this workspace and speak like a trusted personal operations partner, not like a generic public chatbot.
- Know his working style: he manages many brands, wants direct answers, gets overloaded by scattered work, prefers the next concrete move, and dislikes vague filler or repeated explanations.
- Personalise naturally using the stored profile and relevant past conversation. Do not call him an ordinary user, customer, or random guy.
- You have broad operating authority inside this Command Center: when Amaan asks you to change a dashboard item, perform it through the validated dashboard action system and report what changed.
- You are not unrestricted over the computer, the internet, accounts, money, or destructive files. Stay within Command Center actions and ask before anything outside that scope.
"""

COMMAND_CENTER_FEATURES = """COMMAND CENTER FEATURES AND TOOLS
- Pomodoro Timer: start, pause, or reset the focus timer.
- Rule Box: read daily operating rules and mark a rule done or pending.
- To-do List: add, complete, reopen, or remove tasks.
- Notes: maintain separate general note pages.
- Brand Completion: calculated automatically from the seven checklist items.
- Brand Management Checklist: content calendar, caption, campaign setup, 16 creatives, 4 videos, designer coordination, and report.
- Brand Cycles: each brand has a monthly start, end, progress note, and an AI-to-task flow.
- Active Campaigns: each brand has independent Google, Meta, and TikTok on/off switches.
- Pencil: manual drawing overlay; Desk AI does not draw by itself.
- Desk AI Chats: separate conversations, roles, and histories.

ALLOWED ACTIONS
1. {"type":"add_todo","text":"task"}
2. {"type":"set_todo_status","text":"task to match","done":true}
3. {"type":"delete_todo","text":"task to match"}
4. {"type":"set_campaign_platform","brand":"dashboard brand","platform":"google|meta|tiktok","active":true}
5. {"type":"set_brand_note","brand":"dashboard brand","text":"note","mode":"append|replace"}
6. {"type":"set_checklist_item","brand":"dashboard brand","item":"contentCalendar|caption|campaignSetup|creatives16|videos4|designerCoordination|report","done":true}
7. {"type":"set_cycle","brand":"dashboard brand","start":"01","end":"31"}
8. {"type":"set_rule_status","text":"rule to match","done":true}
9. {"type":"timer","operation":"start|pause|reset"}
10. {"type":"add_brand","brand":"new brand"}
11. {"type":"create_note_page","title":"page title","content":"optional content"}

ACTION RULES
- Use the exact brand spelling from the dashboard summary, even if the user misspells it.
- For requests to change the dashboard, emit the action. Do not give instructions for a change you can perform.
- You may emit multiple actions when the request clearly requires them.
- Never claim a dashboard change succeeded unless the same response includes the matching action.
- Ask one short clarification question only when a required brand, platform, status, or task cannot be inferred.
"""

COMMAND_CENTER_INSTRUCTIONS = CREATOR_IDENTITY + """You are Command Center, a private marketing operations copilot.
Your user manages multiple brands, campaigns, monthly content cycles, client replies, designers, editors, and reports.

ROLE
- Turn dashboard facts and a brand note into the most useful next action.
- Reduce overwhelm: give one clear, concrete action, not a long plan.
- Preserve context across brands. Never treat a task as belonging to KL Mobile Events unless the supplied brand says so.
- Recognize progress language such as quantities done, quantities remaining, approvals, payments, campaign status, content, reports, and client follow-ups.

BEHAVIOUR
- Be respectful, direct, cheeky, and practical. Use short sarcasm when it helps. Do not use Raphael's butler persona or call the user Master.
- Use only the supplied dashboard context. Never invent a person, deadline, platform, completed work, or client instruction.
- If the note is ambiguous, create the safest neutral next action or return a short clarification question.
- Avoid copying the whole note. Convert it into an action that can be checked off.
- Keep task wording short and start with a verb.

OUTPUT
Return JSON only in this exact form:
{"task":"short next action","priority":"high|medium|low","dependency":"person or none","reason":"brief factual reason","needs_clarification":false}
"""


class CommandCenterHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/status":
            self.respond_json({
                "bridge": True,
                "ollama": ollama_is_available(),
                "model": OLLAMA_MODEL,
                "memory": "supermemory" if get_supermemory_key() else "local",
            })
            return
        super().do_GET()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            context = json.loads(self.rfile.read(length) or "{}")
            if self.path == "/api/smart-task":
                self.respond_json(ask_ollama(context))
            elif self.path == "/api/chat":
                result = chat_with_command_center(context)
                Thread(target=remember_conversation, args=(context, result), daemon=True).start()
                self.respond_json(result)
            elif self.path == "/api/memory-key":
                self.respond_json(connect_supermemory(context))
            elif self.path == "/api/remember":
                remember_conversation(context, {
                    "reply": str(context.get("reply", "")),
                    "actions": context.get("actions", []),
                })
                self.respond_json({"remembered": True})
            else:
                self.send_error(404)
        except Exception as error:
            self.respond_json({"error": str(error)}, status=500)

    def respond_json(self, body, status=200):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def read_json_file(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def write_json_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def get_supermemory_key():
    environment_key = os.environ.get("SUPERMEMORY_API_KEY", "").strip()
    if environment_key:
        return environment_key
    return str(read_json_file(SECRETS_PATH, {}).get("supermemory_api_key", "")).strip()


def supermemory_request(url, payload, api_key, timeout=6):
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read() or "{}")


def connect_supermemory(context):
    api_key = str(context.get("api_key", "")).strip()
    if not api_key:
        return {"connected": False, "message": "No Supermemory API key was supplied."}
    try:
        supermemory_request(
            SUPERMEMORY_SEARCH_URL,
            {
                "q": "Command Center connection test",
                "containerTag": SUPERMEMORY_CONTAINER,
                "searchMode": "memories",
                "limit": 1,
            },
            api_key,
        )
    except Exception as error:
        return {"connected": False, "message": f"Supermemory rejected the connection: {error}"}

    secrets = read_json_file(SECRETS_PATH, {})
    secrets["supermemory_api_key"] = api_key
    write_json_file(SECRETS_PATH, secrets)
    return {"connected": True, "message": "Supermemory is connected."}


def ollama_is_available():
    try:
        with urlopen(OLLAMA_TAGS_URL, timeout=2) as response:
            data = json.loads(response.read() or "{}")
        return any(model.get("name", "").split(":")[0] == OLLAMA_MODEL for model in data.get("models", []))
    except Exception:
        return False


def local_memory_data():
    default = {
        "profile": [
            "The user manages multiple brands and needs help prioritising marketing operations.",
            "The user prefers concise answers and dislikes vague filler.",
            "Desk AI should be sarcastic, cheeky, lightly roasting, and brutally honest without becoming cruel or disrespectful.",
        ],
        "conversations": [],
    }
    data = read_json_file(MEMORY_PATH, default)
    data.setdefault("profile", default["profile"])
    data.setdefault("conversations", [])
    return data


def local_memory_context(query, limit=5):
    data = local_memory_data()
    query_words = set(normalize_text(query).split())
    scored = []
    for index, entry in enumerate(data["conversations"]):
        content = f"User: {entry.get('user', '')}\nDesk AI: {entry.get('assistant', '')}"
        content_words = set(normalize_text(content).split())
        score = len(query_words.intersection(content_words)) + (index / max(len(data["conversations"]), 1)) * 0.25
        scored.append((score, index, content))
    selected = sorted(scored, reverse=True)[:limit]
    profile = "\n".join(f"- {fact}" for fact in data["profile"][-12:])
    memories = "\n\n".join(item[2] for item in selected if item[0] > 0)
    return f"USER PROFILE:\n{profile}\n\nRELEVANT PAST CONVERSATIONS:\n{memories or 'None yet.'}"


def supermemory_context(query, api_key, limit=5):
    result = supermemory_request(
        SUPERMEMORY_SEARCH_URL,
        {
            "q": query,
            "containerTag": SUPERMEMORY_CONTAINER,
            "searchMode": "hybrid",
            "threshold": 0.45,
            "limit": limit,
        },
        api_key,
    )
    memories = [item.get("memory") or item.get("chunk") for item in result.get("results", [])]
    return "\n\n".join(memory for memory in memories if memory)


def get_memory_context(query):
    local_context = local_memory_context(query)
    api_key = get_supermemory_key()
    if not api_key:
        return local_context
    try:
        cloud_context = supermemory_context(query, api_key)
        if cloud_context:
            return f"{local_context}\n\nSUPERMEMORY RECALL:\n{cloud_context}"
    except Exception:
        pass
    return local_context


def remember_conversation(context, result):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "chat_id": str(context.get("chat_id", ""))[:120],
        "chat_title": str(context.get("chat_title", ""))[:160],
        "role": str(context.get("role", ""))[:500],
        "user": str(context.get("message", ""))[:4000],
        "assistant": str(result.get("reply", ""))[:4000],
        "actions": result.get("actions", []),
    }
    with MEMORY_LOCK:
        data = local_memory_data()
        duplicate = any(
            item.get("chat_id") == entry["chat_id"]
            and item.get("user") == entry["user"]
            and item.get("assistant") == entry["assistant"]
            for item in data["conversations"][-100:]
        )
        if duplicate:
            return
        data["conversations"].append(entry)
        data["conversations"] = data["conversations"][-600:]
        remember_match = re.search(r"\bremember(?: that)?\s+(.+)", entry["user"], re.IGNORECASE)
        if remember_match:
            fact = remember_match.group(1).strip()
            if fact and fact.lower() not in {item.lower() for item in data["profile"]}:
                data["profile"].append(fact[:500])
        write_json_file(MEMORY_PATH, data)

    api_key = get_supermemory_key()
    if not api_key:
        return
    try:
        supermemory_request(
            SUPERMEMORY_ADD_URL,
            {
                "content": f"User: {entry['user']}\nDesk AI: {entry['assistant']}",
                "containerTag": SUPERMEMORY_CONTAINER,
                "metadata": {
                    "source": "desk-ai-chat",
                    "chatId": entry["chat_id"],
                    "chatTitle": entry["chat_title"],
                    "timestamp": entry["timestamp"],
                },
            },
            api_key,
            timeout=8,
        )
    except Exception:
        pass


def parse_model_json(raw_response, fallback):
    raw = str(raw_response or "").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                pass
    result = dict(fallback)
    if "reply" in result and raw:
        result["reply"] = raw[:3000]
    return result


def instant_chat_reply(message, dashboard):
    """Keep common identity and orientation questions out of the slow model path."""
    normalized = normalize_text(message)
    if normalized in {"hi", "hello", "hey", "yo", "good morning", "good afternoon"}:
        return {"reply": "Desk AI is online. Amaan, what are we fixing first?", "actions": []}
    if any(phrase in normalized for phrase in ("your name", "who are you", "what is your name")):
        return {"reply": "I am Desk AI, Amaan's Command Center brain. I run the dashboard, remember the work, and call out weak process when it deserves it.", "actions": []}
    if any(phrase in normalized for phrase in ("who is the creator", "who made you", "am i the creator", "who is amaan")):
        return {"reply": "Amaan is the creator and owner of this Command Center. I treat him as the authority here, not as some random user wandering into his own system.", "actions": []}
    if any(phrase in normalized for phrase in ("what can you do", "your capabilities", "command center features")):
        return {"reply": "I can operate the Command Center: campaign toggles, brand checklists, cycles and notes, tasks, rules, note pages, brands, and the Pomodoro timer. I can also plan, prioritise, write, remember relevant past context, and switch roles without forgetting who built me.", "actions": []}
    if any(phrase in normalized for phrase in ("what should we do", "what should i do", "what do you think we should do", "what is next")):
        todos = [str(item.get("text", "")).strip() for item in dashboard.get("todos", []) if not item.get("done") and str(item.get("text", "")).strip()]
        if todos:
            return {"reply": f"Start with: {todos[0]}. Finish one thing before collecting another shiny problem.", "actions": []}
        cycles = [item for item in dashboard.get("cycles", []) if str(item.get("note", "")).strip()]
        if cycles:
            return {"reply": f"Start with {cycles[0].get('brand', 'the noted brand')}: {str(cycles[0].get('note', '')).strip()}. The dashboard already told us what is waiting; we do not need a ceremonial meeting with it.", "actions": []}
        return {"reply": "Add the real pending work to the To-do List or a brand note first. Then I can choose the next move instead of inventing productivity theatre.", "actions": []}
    return None


def ask_ollama(context):
    direct_task = extract_clear_progress_task(context)
    if direct_task:
        return direct_task

    prompt = f"""MODE: TASK
{COMMAND_CENTER_INSTRUCTIONS}

CURRENT BRAND CONTEXT
Brand: {context.get('brand', '')}
Monthly cycle: {context.get('cycle', '')}
Active campaign platforms: {context.get('platforms', 'none recorded')}
Brand checklist: {context.get('checklist', 'none recorded')}
Brand progress note: {context.get('note', '')}
Existing tasks for this brand: {context.get('brand_tasks', 'none recorded')}
Daily operating rules: {context.get('daily_rules', 'none recorded')}

Make the next task now."""
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "keep_alive": "30m",
        "options": {"temperature": 0.1, "num_ctx": 4096, "num_predict": 160}
    }).encode("utf-8")
    request = Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})

    with urlopen(request, timeout=90) as response:
        result = json.loads(response.read())
        task_data = parse_model_json(result.get("response", ""), {"task": ""})
        task = task_data.get("task", "").strip()
        if not task:
            raise ValueError("The local model returned no task.")
        return {
            "task": task,
            "priority": task_data.get("priority", "medium"),
            "dependency": task_data.get("dependency", "none"),
            "reason": task_data.get("reason", ""),
            "needs_clarification": bool(task_data.get("needs_clarification", False))
        }


def extract_clear_progress_task(context):
    """Keep obvious quantity progress precise instead of asking the model to guess."""
    note = str(context.get("note", ""))
    brand = str(context.get("brand", "")).strip()
    match = re.search(
        r"(\d+)\s+(videos?|creatives?|captions?|posts?|reports?)\b.*?"
        r"(\d+)\s+(?:done|completed|complete).*?(\d+)\s+(?:left|remaining)",
        note,
        re.IGNORECASE,
    )
    if not match:
        return None

    item = match.group(2).lower().rstrip("s")
    remaining = int(match.group(4))
    count = f"{remaining} {item}{'' if remaining == 1 else 's'}"

    if item == "video":
        task = f"{brand}: Get {remaining} remaining {item}{'' if remaining == 1 else 's'} from editor"
        dependency = "editor"
    else:
        task = f"{brand}: Complete {count}"
        dependency = "none"

    return {
        "task": task,
        "priority": "high",
        "dependency": dependency,
        "reason": f"{remaining} {item}{'' if remaining == 1 else 's'} {'remains' if remaining == 1 else 'remain'} from the progress note",
        "needs_clarification": False,
    }


def normalize_text(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def dashboard_brands(dashboard):
    brands = []
    for section in ("campaigns", "cycles", "checklist"):
        for item in dashboard.get(section, []):
            brand = str(item.get("brand", "")).strip()
            if brand and brand.lower() not in {name.lower() for name in brands}:
                brands.append(brand)
    return brands


def find_dashboard_brand(message, dashboard):
    normalized_message = normalize_text(message)
    brands = dashboard_brands(dashboard)
    for brand in brands:
        if normalize_text(brand) in normalized_message:
            return brand

    message_tokens = normalized_message.split()
    best_brand = None
    best_score = 0.0
    for brand in brands:
        brand_text = normalize_text(brand)
        brand_tokens = brand_text.split()
        sizes = range(max(1, len(brand_tokens) - 1), min(len(message_tokens), len(brand_tokens) + 1) + 1)
        for size in sizes:
            for index in range(len(message_tokens) - size + 1):
                window = " ".join(message_tokens[index:index + size])
                score = SequenceMatcher(None, brand_text, window).ratio()
                if score > best_score:
                    best_brand = brand
                    best_score = score
    return best_brand if best_score >= 0.68 else None


def find_platform(message):
    normalized = normalize_text(message)
    tokens = normalized.split()
    if "tik tok" in normalized:
        return "tiktok"
    for platform in ("google", "meta", "tiktok"):
        if platform in normalized:
            return platform
    for platform in ("google", "meta", "tiktok"):
        if any(SequenceMatcher(None, platform, token).ratio() >= 0.72 for token in tokens):
            return platform
    return None


def direct_dashboard_action(context):
    """Handle obvious dashboard commands without waiting for the model."""
    message = str(context.get("message", ""))
    normalized = normalize_text(message)
    dashboard = context.get("dashboard", {})
    platform = find_platform(message)
    action_words = ("enable", "disable", "activate", "deactivate", "switch", "turn", "toggle", "togle", "start", "stop", "on", "off")

    if any(word in normalized.split() for word in ("timer", "pomodoro")):
        for operation, words in (
            ("reset", ("reset", "restart")),
            ("pause", ("pause", "stop")),
            ("start", ("start", "begin", "run")),
        ):
            if any(word in normalized.split() for word in words):
                verb = {"start": "Starting", "pause": "Pausing", "reset": "Resetting"}[operation]
                return {
                    "reply": f"{verb} the Pomodoro timer. Apparently even focus needs adult supervision.",
                    "actions": [{"type": "timer", "operation": operation}],
                }

    if platform and any(word in normalized.split() for word in action_words):
        brand = find_dashboard_brand(message, dashboard)
        if brand:
            if any(word in normalized.split() for word in ("disable", "deactivate", "off", "stop")):
                active = False
            elif any(word in normalized.split() for word in ("enable", "activate", "on", "start")):
                active = True
            else:
                campaign = next(
                    (item for item in dashboard.get("campaigns", []) if normalize_text(item.get("brand")) == normalize_text(brand)),
                    {},
                )
                active = not bool(campaign.get(platform, False))
            status = "on" if active else "off"
            return {
                "reply": f"Turning {platform.title()} {status} for {brand}. One tiny toggle, rescued from unnecessary drama.",
                "actions": [{
                    "type": "set_campaign_platform",
                    "brand": brand,
                    "platform": platform,
                    "active": active,
                }],
            }

    brand = find_dashboard_brand(message, dashboard)
    checklist_aliases = (
        ("contentCalendar", ("content calendar", "calendar")),
        ("campaignSetup", ("campaign setup", "ad setup", "ads setup")),
        ("designerCoordination", ("designer coordination", "designer")),
        ("creatives16", ("16 creatives", "creatives")),
        ("videos4", ("4 videos", "videos")),
        ("caption", ("captions", "caption")),
        ("report", ("monthly report", "report")),
    )
    checklist_verbs = {"mark", "check", "complete", "finish", "uncheck", "reopen", "set"}
    if brand and checklist_verbs.intersection(normalized.split()):
        for item, aliases in checklist_aliases:
            if any(alias in normalized for alias in aliases):
                done = not any(term in normalized for term in ("pending", "not done", "incomplete", "uncheck", "reopen", "undo"))
                return {
                    "reply": f"Marking {item} {'done' if done else 'pending'} for {brand}.",
                    "actions": [{"type": "set_checklist_item", "brand": brand, "item": item, "done": done}],
                }

    if brand and "note" in normalized.split() and any(word in normalized.split() for word in ("add", "append", "write", "replace", "set")):
        note_match = re.search(r"(?:\bthat\b|:)\s*(.+)$", message, re.IGNORECASE)
        if note_match and note_match.group(1).strip():
            mode = "replace" if any(word in normalized.split() for word in ("replace", "set")) else "append"
            return {
                "reply": f"{'Updating' if mode == 'replace' else 'Adding to'} the brand note for {brand}.",
                "actions": [{
                    "type": "set_brand_note",
                    "brand": brand,
                    "text": note_match.group(1).strip(),
                    "mode": mode,
                }],
            }

    if brand and "cycle" in normalized.split() and any(word in normalized.split() for word in ("set", "change", "update")):
        start_match = re.search(r"\bstart\s*(?:to|is|=)?\s*([a-z0-9/-]+)", message, re.IGNORECASE)
        end_match = re.search(r"\bend\s*(?:to|is|=)?\s*([a-z0-9/-]+)", message, re.IGNORECASE)
        if start_match or end_match:
            action = {"type": "set_cycle", "brand": brand}
            if start_match:
                action["start"] = start_match.group(1)
            if end_match:
                action["end"] = end_match.group(1)
            return {"reply": f"Updating the monthly cycle for {brand}.", "actions": [action]}

    add_brand_match = re.search(
        r"\b(?:add|create)\s+(?:a\s+)?(?:new\s+)?brand(?:\s+called)?\s+(.+?)[.!]?$",
        message,
        re.IGNORECASE,
    )
    if add_brand_match:
        new_brand = add_brand_match.group(1).strip()
        return {
            "reply": f"Adding {new_brand} to Brand Cycles, Active Campaigns, and the management checklist.",
            "actions": [{"type": "add_brand", "brand": new_brand}],
        }

    return None


def as_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes", "on", "done", "active"}


def sanitize_action(action):
    if not isinstance(action, dict):
        return None
    action_type = str(action.get("type", "")).strip()
    text = str(action.get("text", "")).strip()[:500]
    brand = str(action.get("brand", "")).strip()[:160]

    if action_type == "add_todo" and text:
        return {"type": action_type, "text": text}
    if action_type in {"set_todo_status", "set_rule_status"} and text:
        return {"type": action_type, "text": text, "done": as_bool(action.get("done"))}
    if action_type == "delete_todo" and text:
        return {"type": action_type, "text": text}
    if action_type == "set_campaign_platform" and brand:
        platform = str(action.get("platform", "")).lower().strip()
        if platform in {"google", "meta", "tiktok"}:
            return {"type": action_type, "brand": brand, "platform": platform, "active": as_bool(action.get("active"))}
    if action_type == "set_brand_note" and brand and text:
        mode = "replace" if str(action.get("mode", "append")).lower() == "replace" else "append"
        return {"type": action_type, "brand": brand, "text": text, "mode": mode}
    if action_type == "set_checklist_item" and brand:
        item = str(action.get("item", "")).strip()
        allowed_items = {"contentCalendar", "caption", "campaignSetup", "creatives16", "videos4", "designerCoordination", "report"}
        if item in allowed_items:
            return {"type": action_type, "brand": brand, "item": item, "done": as_bool(action.get("done"))}
    if action_type == "set_cycle" and brand:
        return {
            "type": action_type,
            "brand": brand,
            "start": str(action.get("start", "")).strip()[:20],
            "end": str(action.get("end", "")).strip()[:20],
        }
    if action_type == "timer":
        operation = str(action.get("operation", "")).lower().strip()
        if operation in {"start", "pause", "reset"}:
            return {"type": action_type, "operation": operation}
    if action_type == "add_brand" and brand:
        return {"type": action_type, "brand": brand}
    if action_type == "create_note_page":
        title = str(action.get("title", "New page")).strip()[:100] or "New page"
        return {"type": action_type, "title": title, "content": str(action.get("content", ""))[:4000]}
    return None


def chat_with_command_center(context):
    direct = direct_dashboard_action(context)
    if direct:
        return direct

    role = str(context.get("role", "Command Center assistant"))[:800]
    message = str(context.get("message", ""))[:4000]
    instant = instant_chat_reply(message, context.get("dashboard", {}))
    if instant:
        return instant
    history = context.get("history", [])
    if history and history[-1].get("role") == "user" and history[-1].get("content") == message:
        history = history[:-1]
    history = history[-2:]
    history_text = "\n".join(
        f"{item.get('role', 'user')}: {str(item.get('content', ''))[:450]}"
        for item in history
    )
    dashboard = json.dumps(context.get("dashboard", {}), ensure_ascii=False)[:2800]
    memory_context = get_memory_context(message)[:1200]
    prompt = f"""MODE: CHAT
You are Desk AI, the agent inside Command Center. Follow this temporary chat role: {role}
{CREATOR_IDENTITY}
You know the dashboard and may operate it with the allowed actions below. Help plan, write, explain, prioritise, or perform the requested dashboard change.

CORE VOICE THAT NEVER CHANGES, EVEN WHEN A CHAT HAS A SPECIAL ROLE
- Be sarcastic, cheeky, lightly roasting, and brutally honest.
- Keep the humor clever and short. Accuracy and useful action come before jokes.
- Roast the situation or the bad process, never the user's identity, intelligence, appearance, or vulnerability.
- Do not become cruel, abusive, humiliating, or exhausting. Be a sharp ally, not a bully.
- If the user's idea is weak, say so plainly and immediately offer the better move.
- The temporary role changes your expertise, not this core voice.

{COMMAND_CENTER_FEATURES}

Return JSON only in this envelope: {{"reply":"short useful response","actions":[]}}.

LIVE DASHBOARD STATE: {dashboard}
LONG-TERM PERSONAL MEMORY: {memory_context}
Conversation so far:
{history_text}
User: {message}
"""
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "keep_alive": "1h",
        "options": {"temperature": 0.25, "num_ctx": 1024, "num_predict": 80}
    }).encode("utf-8")
    request = Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})

    try:
        with urlopen(request, timeout=32) as response:
            result = json.loads(response.read())
            answer = parse_model_json(result.get("response", ""), {"reply": "I understood the request, but my tiny local brain mangled the action format. Try the command once more.", "actions": []})
            safe_actions = []
            for action in answer.get("actions", []):
                clean_action = sanitize_action(action)
                if clean_action:
                    if "brand" in clean_action and clean_action["type"] != "add_brand":
                        canonical_brand = find_dashboard_brand(clean_action["brand"], context.get("dashboard", {}))
                        if canonical_brand:
                            clean_action["brand"] = canonical_brand
                    safe_actions.append(clean_action)
            return {"reply": str(answer.get("reply", ""))[:3000], "actions": safe_actions}
    except Exception:
        dashboard_state = context.get("dashboard", {})
        todos = [str(item.get("text", "")).strip() for item in dashboard_state.get("todos", [])
                 if not item.get("done") and str(item.get("text", "")).strip()]
        if todos:
            return {"reply": f"Start with: {todos[0]}. Llama is taking the scenic route, so I used the live dashboard instead of making you wait.", "actions": []}
        cycles = [item for item in dashboard_state.get("cycles", []) if str(item.get("note", "")).strip()]
        if cycles:
            cycle = cycles[0]
            return {"reply": f"Start with {cycle.get('brand', 'the noted brand')}: {str(cycle.get('note', '')).strip()}. The local model is slow, but the dashboard context is clear.", "actions": []}
        return {"reply": "I’m online, but the local model is slow on this larger prompt. Give me a direct dashboard command or add the pending work to To-do and I’ll act on it immediately.", "actions": []}


def warm_ollama():
    """Load the local model in the background before the first real chat."""
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": 'MODE: CHAT\nReturn JSON only: {"reply":"ready","actions":[]}',
        "format": "json",
        "stream": False,
        "keep_alive": "30m",
        "options": {"num_ctx": 1024, "num_predict": 16},
    }).encode("utf-8")
    request = Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=120) as response:
            response.read()
    except Exception:
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8766), CommandCenterHandler)
    print("Command Center is running at http://127.0.0.1:8766")
    Thread(target=warm_ollama, daemon=True).start()
    server.serve_forever()
