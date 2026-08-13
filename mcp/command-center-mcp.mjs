#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DATA_PATH,
  applyAndSave,
  dashboardContext,
  readDashboard,
  summarizeDashboard,
  writeDashboard
} from "./dashboard-store.mjs";

function text(payload) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
      }
    ]
  };
}

const actionSchema = z.object({
  type: z.enum([
    "add_todo",
    "set_todo_status",
    "delete_todo",
    "set_campaign_platform",
    "set_brand_note",
    "set_checklist_item",
    "set_cycle",
    "create_note_page",
    "add_brand"
  ]),
  text: z.string().optional(),
  done: z.boolean().optional(),
  brand: z.string().optional(),
  platform: z.enum(["google", "meta", "tiktok"]).optional(),
  active: z.boolean().optional(),
  mode: z.enum(["append", "replace"]).optional(),
  item: z.enum([
    "contentCalendar",
    "caption",
    "campaignSetup",
    "creatives16",
    "videos4",
    "designerCoordination",
    "report"
  ]).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional()
});

const server = new McpServer({
  name: "command-center",
  version: "0.1.0"
});

server.registerTool(
  "get_dashboard_context",
  {
    title: "Get Dashboard Context",
    description: "Read Command Center state: todos, brand cycles, active campaigns, checklist progress, rules, and notes metadata.",
    inputSchema: {}
  },
  async () => {
    const dashboard = await readDashboard();
    return text(dashboardContext(dashboard));
  }
);

server.registerTool(
  "get_dashboard_summary",
  {
    title: "Get Dashboard Summary",
    description: "Read a compact operational summary for planning and prioritization.",
    inputSchema: {}
  },
  async () => {
    const dashboard = await readDashboard();
    return text(summarizeDashboard(dashboard));
  }
);

server.registerTool(
  "apply_dashboard_action",
  {
    title: "Apply Dashboard Action",
    description: "Apply one Command Center action such as add_todo, set_campaign_platform, set_brand_note, set_checklist_item, set_cycle, create_note_page, or add_brand.",
    inputSchema: { action: actionSchema }
  },
  async ({ action }) => {
    const { result, dashboard } = await applyAndSave(action);
    return text({ result, summary: summarizeDashboard(dashboard) });
  }
);

server.registerTool(
  "add_todo",
  {
    title: "Add To-do",
    description: "Add a clean task to the Command Center To-do List.",
    inputSchema: { text: z.string().min(1) }
  },
  async ({ text: taskText }) => {
    const { result, dashboard } = await applyAndSave({ type: "add_todo", text: taskText });
    return text({ result, summary: summarizeDashboard(dashboard) });
  }
);

server.registerTool(
  "set_campaign_platform",
  {
    title: "Set Campaign Platform",
    description: "Turn Google, Meta, or TikTok on/off for a brand.",
    inputSchema: {
      brand: z.string().min(1),
      platform: z.enum(["google", "meta", "tiktok"]),
      active: z.boolean()
    }
  },
  async ({ brand, platform, active }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_campaign_platform", brand, platform, active });
    return text({ result, summary: summarizeDashboard(dashboard) });
  }
);

server.registerTool(
  "set_brand_note",
  {
    title: "Set Brand Note",
    description: "Append or replace operational notes for a brand cycle.",
    inputSchema: {
      brand: z.string().min(1),
      note: z.string().min(1),
      mode: z.enum(["append", "replace"]).default("append")
    }
  },
  async ({ brand, note, mode }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_brand_note", brand, text: note, mode });
    return text({ result, summary: summarizeDashboard(dashboard) });
  }
);

server.registerTool(
  "replace_dashboard_state",
  {
    title: "Replace Dashboard State",
    description: "Replace the whole local Command Center dashboard JSON. Use only after reading current context and preserving existing user data.",
    inputSchema: { dashboard: z.record(z.string(), z.any()) }
  },
  async ({ dashboard }) => {
    await writeDashboard(dashboard);
    const saved = await readDashboard();
    return text({ result: `Saved dashboard state to ${DATA_PATH}`, summary: summarizeDashboard(saved) });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
