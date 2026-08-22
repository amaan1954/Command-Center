import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DATA_PATH,
  applyAndSave,
  dashboardContext,
  readDashboard,
  summarizeDashboard,
  writeDashboard
} from "./dashboard-store.mjs";
import {
  listAllowedFolders,
  listFolder,
  readFolderFile,
  searchFolderText,
  writeFolderFile
} from "./folder-access.mjs";

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

export function createCommandCenterServer() {
  const server = new McpServer({
    name: "command-center",
    version: "0.1.0"
  });

  server.registerTool("get_dashboard_context", {
    title: "Get Dashboard Context",
    description: "Read Command Center state: todos, brand cycles, active campaigns, checklist progress, rules, and notes metadata.",
    inputSchema: {}
  }, async () => {
    const dashboard = await readDashboard();
    return text(dashboardContext(dashboard));
  });

  server.registerTool("get_dashboard_summary", {
    title: "Get Dashboard Summary",
    description: "Read a compact operational summary for planning and prioritization.",
    inputSchema: {}
  }, async () => {
    const dashboard = await readDashboard();
    return text(summarizeDashboard(dashboard));
  });

  server.registerTool("apply_dashboard_action", {
    title: "Apply Dashboard Action",
    description: "Apply one Command Center action such as add_todo, set_campaign_platform, set_brand_note, set_checklist_item, set_cycle, create_note_page, or add_brand.",
    inputSchema: { action: actionSchema }
  }, async ({ action }) => {
    const { result, dashboard } = await applyAndSave(action);
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("add_todo", {
    title: "Add To-do",
    description: "Add a clean task to the Command Center To-do List.",
    inputSchema: { text: z.string().min(1) }
  }, async ({ text: taskText }) => {
    const { result, dashboard } = await applyAndSave({ type: "add_todo", text: taskText });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("set_todo_status", {
    title: "Set To-do Status",
    description: "Mark a Command Center task complete or reopen it.",
    inputSchema: { text: z.string().min(1), done: z.boolean() }
  }, async ({ text: taskText, done }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_todo_status", text: taskText, done });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("delete_todo", {
    title: "Delete To-do",
    description: "Remove a Command Center task from the To-do List.",
    inputSchema: { text: z.string().min(1) }
  }, async ({ text: taskText }) => {
    const { result, dashboard } = await applyAndSave({ type: "delete_todo", text: taskText });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("set_campaign_platform", {
    title: "Set Campaign Platform",
    description: "Turn Google, Meta, or TikTok on/off for a brand.",
    inputSchema: {
      brand: z.string().min(1),
      platform: z.enum(["google", "meta", "tiktok"]),
      active: z.boolean()
    }
  }, async ({ brand, platform, active }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_campaign_platform", brand, platform, active });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("set_checklist_item", {
    title: "Set Checklist Item",
    description: "Mark a brand workflow step done or pending: plan, caption, design, 16 creatives, 4 videos, ads, or report.",
    inputSchema: {
      brand: z.string().min(1),
      item: z.enum([
        "contentCalendar",
        "caption",
        "designerCoordination",
        "creatives16",
        "videos4",
        "campaignSetup",
        "report"
      ]),
      done: z.boolean()
    }
  }, async ({ brand, item, done }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_checklist_item", brand, item, done });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("set_brand_note", {
    title: "Set Brand Note",
    description: "Append or replace operational notes for a brand cycle.",
    inputSchema: {
      brand: z.string().min(1),
      note: z.string().min(1),
      mode: z.enum(["append", "replace"]).default("append")
    }
  }, async ({ brand, note, mode }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_brand_note", brand, text: note, mode });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("set_cycle", {
    title: "Set Brand Cycle",
    description: "Update a brand's monthly cycle start and/or end day.",
    inputSchema: {
      brand: z.string().min(1),
      start: z.string().optional(),
      end: z.string().optional()
    }
  }, async ({ brand, start, end }) => {
    const { result, dashboard } = await applyAndSave({ type: "set_cycle", brand, start, end });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("create_note_page", {
    title: "Create Note Page",
    description: "Create a new Command Center notes page.",
    inputSchema: {
      title: z.string().min(1),
      content: z.string().default("")
    }
  }, async ({ title, content }) => {
    const { result, dashboard } = await applyAndSave({ type: "create_note_page", title, content });
    return text({ result, summary: summarizeDashboard(dashboard) });
  });

  server.registerTool("replace_dashboard_state", {
    title: "Replace Dashboard State",
    description: "Replace the whole local Command Center dashboard JSON. Use only after reading current context and preserving existing user data.",
    inputSchema: { dashboard: z.record(z.string(), z.any()) }
  }, async ({ dashboard }) => {
    await writeDashboard(dashboard);
    const saved = await readDashboard();
    return text({ result: `Saved dashboard state to ${DATA_PATH}`, summary: summarizeDashboard(saved) });
  });

  server.registerTool("list_allowed_folders", {
    title: "List Allowed Folders",
    description: "Show the folders this Command Center MCP server is allowed to access.",
    inputSchema: {}
  }, async () => text(await listAllowedFolders()));

  server.registerTool("list_folder", {
    title: "List Folder",
    description: "List files and folders inside an allowed folder.",
    inputSchema: {
      folder: z.string().default("command-center"),
      path: z.string().default(".")
    }
  }, async ({ folder, path: relativePath }) => text(await listFolder(folder, relativePath)));

  server.registerTool("read_folder_file", {
    title: "Read Folder File",
    description: "Read a UTF-8 text file inside an allowed folder. Secrets and system folders are blocked.",
    inputSchema: {
      folder: z.string().default("command-center"),
      path: z.string().min(1),
      maxBytes: z.number().int().positive().max(500000).default(80000)
    }
  }, async ({ folder, path: relativePath, maxBytes }) => text(await readFolderFile(folder, relativePath, maxBytes)));

  server.registerTool("write_folder_file", {
    title: "Write Folder File",
    description: "Write or append a UTF-8 text file inside an allowed folder. Use carefully; this changes files.",
    inputSchema: {
      folder: z.string().default("command-center"),
      path: z.string().min(1),
      content: z.string(),
      mode: z.enum(["overwrite", "append"]).default("overwrite")
    }
  }, async ({ folder, path: relativePath, content, mode }) => text(await writeFolderFile(folder, relativePath, content, mode)));

  server.registerTool("search_folder_text", {
    title: "Search Folder Text",
    description: "Search text inside allowed folder files. Large files, secrets, node_modules, and .git are skipped.",
    inputSchema: {
      folder: z.string().default("command-center"),
      query: z.string().min(1),
      path: z.string().default("."),
      limit: z.number().int().positive().max(200).default(50)
    }
  }, async ({ folder, query, path: relativePath, limit }) => text(await searchFolderText(folder, query, relativePath, limit)));

  return server;
}
