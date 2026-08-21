import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCloudStoreReady, readCloudDashboard, writeCloudDashboard } from "./supabase-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DATA_PATH = path.join(PROJECT_ROOT, "data", "command-center-data.json");
const API_URL = (process.env.COMMAND_CENTER_API_URL || "").trim();
let lastStorageSource = "local-json";

const checklistKeys = [
  "contentCalendar",
  "caption",
  "designerCoordination",
  "creatives16",
  "videos4",
  "campaignSetup",
  "report"
];

const brandPresets = [
  ["KL Mobile Events", "13th", "12th"],
  ["CMD", "22nd", "23rd"],
  ["Streat Motor Tyre", "3rd", "4th"],
  ["G Lounge", "24th", "25th"],
  ["CARE LUGAGGE", "1st", "30th"],
  ["HERAVIS", "8th", "7th"],
  ["DM EDU", "3rd", "4th"],
  ["Platform Daddy", "1st", "30th"],
  ["Tool Genie IO + Meme", "15th", "16th"],
  ["EMINDS", "25th", "24th"],
  ["Anchor Brand", "1st", "30th"],
  ["Recova", "9th", "10th"],
  ["BEON", "1st", "31st"]
];

const activeCampaignBrands = [
  "KL Mobile Events",
  "CARE LUGAGGE",
  "DM EDU",
  "Streat Motor Tyre",
  "HERAVIS",
  "Tool Genie IO + Meme",
  "Recova"
];

function cycle(name, start, end) {
  return { name, start, end, notes: "", open: false };
}

function checklist(name) {
  return Object.fromEntries([["name", name], ...checklistKeys.map((key) => [key, false])]);
}

function campaign(brand) {
  return { brand, google: false, meta: false, tiktok: false };
}

export function defaultDashboard() {
  return {
    notes: "",
    notePages: [{ id: "page-1", title: "Page 1", content: "" }],
    activeNotePageId: "page-1",
    aiChats: [],
    activeAiChatId: "",
    todos: [],
    rules: [
      { text: "Morning check all brand campaigns.", done: false },
      { text: "Check content calendar and creation progress.", done: false },
      { text: "Check client replies and pending approvals.", done: false },
      { text: "Evening check and set next action.", done: false }
    ],
    brandChecklist: brandPresets.map(([name]) => checklist(name)),
    cycles: brandPresets.map(([name, start, end]) => cycle(name, start, end)),
    campaigns: activeCampaignBrands.map(campaign),
    timerSeconds: 1500
  };
}

export async function readDashboard() {
  if (API_URL) {
    try {
      const apiDashboard = await readApiDashboard();
      if (apiDashboard) {
        lastStorageSource = "command-center-api";
        return normalizeDashboard(apiDashboard);
      }
    } catch {
      // Keep Iris useful even if the live dashboard API is temporarily unavailable.
    }
  }

  if (isCloudStoreReady()) {
    try {
      const cloudDashboard = await readCloudDashboard();
      if (cloudDashboard) {
        lastStorageSource = "supabase";
        return normalizeDashboard(cloudDashboard);
      }
    } catch {
      // Keep Iris useful even if cloud sync is temporarily unavailable.
    }
  }

  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    lastStorageSource = "local-json";
    return normalizeDashboard(parsed);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const dashboard = defaultDashboard();
    await writeDashboard(dashboard);
    lastStorageSource = "local-json";
    return dashboard;
  }
}

export async function writeDashboard(dashboard) {
  const normalized = normalizeDashboard(dashboard);
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(normalized, null, 2), "utf8");

  if (API_URL) {
    try {
      await writeApiDashboard(normalized);
      lastStorageSource = "command-center-api";
      return;
    } catch {
      // Fall through to direct Supabase or local JSON fallback.
    }
  }

  if (isCloudStoreReady()) {
    try {
      await writeCloudDashboard(normalized);
      lastStorageSource = "supabase";
    } catch {
      // Local JSON remains the fallback source if Supabase is unreachable.
    }
  }
}

async function readApiDashboard() {
  const response = await fetch(API_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Command Center API read failed: ${response.status} ${detail}`);
  }
  const payload = await response.json();
  return payload?.dashboard || null;
}

async function writeApiDashboard(dashboard) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ dashboard })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Command Center API write failed: ${response.status} ${detail}`);
  }
  return response.json();
}

export function normalizeDashboard(input) {
  const base = defaultDashboard();
  const dashboard = { ...base, ...(input || {}) };
  dashboard.todos = Array.isArray(dashboard.todos) ? dashboard.todos : [];
  dashboard.rules = Array.isArray(dashboard.rules) && dashboard.rules.length ? dashboard.rules : base.rules;
  dashboard.cycles = Array.isArray(dashboard.cycles) && dashboard.cycles.length ? dashboard.cycles : base.cycles;
  dashboard.campaigns = Array.isArray(dashboard.campaigns) ? dashboard.campaigns : base.campaigns;
  dashboard.brandChecklist = Array.isArray(dashboard.brandChecklist) && dashboard.brandChecklist.length ? dashboard.brandChecklist : base.brandChecklist;
  dashboard.notePages = Array.isArray(dashboard.notePages) && dashboard.notePages.length ? dashboard.notePages : base.notePages;
  return dashboard;
}

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findMatch(items, field, value) {
  const target = norm(value);
  if (!target) return null;
  return items.find((item) => norm(item[field]) === target)
    || items.find((item) => {
      const candidate = norm(item[field]);
      return candidate.includes(target) || target.includes(candidate);
    })
    || null;
}

export function summarizeDashboard(dashboard) {
  const keys = checklistKeys;
  const total = dashboard.brandChecklist.length * keys.length;
  const done = dashboard.brandChecklist.reduce((sum, brand) => {
    return sum + keys.reduce((inner, key) => inner + (brand[key] ? 1 : 0), 0);
  }, 0);
  const activeCampaigns = dashboard.campaigns
    .filter((item) => item.google || item.meta || item.tiktok)
    .map((item) => ({
      brand: item.brand,
      platforms: ["google", "meta", "tiktok"].filter((platform) => item[platform])
    }));

  return {
    storageSource: lastStorageSource,
    apiUrl: API_URL || null,
    cloudSync: isCloudStoreReady(),
    dataPath: DATA_PATH,
    todoCount: dashboard.todos.length,
    openTodoCount: dashboard.todos.filter((todo) => !todo.done).length,
    brandCount: dashboard.cycles.length,
    activeCampaigns,
    checklist: { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
  };
}

export function dashboardContext(dashboard) {
  return {
    summary: summarizeDashboard(dashboard),
    todos: dashboard.todos,
    rules: dashboard.rules,
    cycles: dashboard.cycles.map((item) => ({ brand: item.name, start: item.start, end: item.end, notes: item.notes || "" })),
    campaigns: dashboard.campaigns,
    checklist: dashboard.brandChecklist
  };
}

export function applyAction(dashboard, action) {
  const type = action?.type;

  if (type === "add_todo") {
    const text = String(action.text || "").trim();
    if (!text) return "No task text supplied.";
    const exists = dashboard.todos.some((todo) => norm(todo.text) === norm(text));
    if (!exists) dashboard.todos.push({ text, done: false });
    return exists ? `Task already exists: ${text}` : `Added task: ${text}`;
  }

  if (type === "set_todo_status") {
    const todo = findMatch(dashboard.todos, "text", action.text);
    if (!todo) return `Could not find task: ${action.text}`;
    todo.done = Boolean(action.done);
    return `${todo.done ? "Completed" : "Reopened"} task: ${todo.text}`;
  }

  if (type === "delete_todo") {
    const todo = findMatch(dashboard.todos, "text", action.text);
    if (!todo) return `Could not find task: ${action.text}`;
    dashboard.todos.splice(dashboard.todos.indexOf(todo), 1);
    return `Removed task: ${todo.text}`;
  }

  if (type === "set_campaign_platform") {
    const platform = norm(action.platform);
    if (!["google", "meta", "tiktok"].includes(platform)) return `Unsupported platform: ${action.platform}`;
    let item = findMatch(dashboard.campaigns, "brand", action.brand);
    if (!item) {
      item = campaign(String(action.brand || "").trim());
      dashboard.campaigns.push(item);
    }
    item[platform] = Boolean(action.active);
    return `${platform} is ${item[platform] ? "on" : "off"} for ${item.brand}`;
  }

  if (type === "set_brand_note") {
    const item = findMatch(dashboard.cycles, "name", action.brand);
    if (!item) return `Could not find brand cycle: ${action.brand}`;
    const text = String(action.text || "").trim();
    item.notes = action.mode === "replace" || !item.notes ? text : `${item.notes.trim()}\n${text}`;
    item.open = true;
    return `Updated note for ${item.name}`;
  }

  if (type === "set_checklist_item") {
    const item = findMatch(dashboard.brandChecklist, "name", action.brand);
    if (!item) return `Could not find checklist brand: ${action.brand}`;
    if (!checklistKeys.includes(action.item)) return `Unsupported checklist item: ${action.item}`;
    item[action.item] = Boolean(action.done);
    return `${action.item} is ${item[action.item] ? "done" : "pending"} for ${item.name}`;
  }

  if (type === "set_cycle") {
    const item = findMatch(dashboard.cycles, "name", action.brand);
    if (!item) return `Could not find brand cycle: ${action.brand}`;
    if (action.start) item.start = String(action.start).trim();
    if (action.end) item.end = String(action.end).trim();
    return `Updated cycle for ${item.name}: ${item.start}-${item.end}`;
  }

  if (type === "create_note_page") {
    const title = String(action.title || "New page").trim();
    const page = { id: `page-${Date.now()}`, title, content: String(action.content || "") };
    dashboard.notePages.push(page);
    dashboard.activeNotePageId = page.id;
    return `Created note page: ${title}`;
  }

  if (type === "add_brand") {
    const name = String(action.brand || "").trim();
    if (!name) return "No brand supplied.";
    if (!findMatch(dashboard.cycles, "name", name)) dashboard.cycles.push(cycle(name, "1st", "31st"));
    if (!findMatch(dashboard.brandChecklist, "name", name)) dashboard.brandChecklist.push(checklist(name));
    if (!findMatch(dashboard.campaigns, "brand", name)) dashboard.campaigns.push(campaign(name));
    return `Added brand: ${name}`;
  }

  return `Unsupported action: ${type || "unknown"}`;
}

export async function applyAndSave(action) {
  const dashboard = await readDashboard();
  const result = applyAction(dashboard, action);
  await writeDashboard(dashboard);
  return { result, dashboard };
}
