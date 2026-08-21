# Command Center Integrations

Command Center now has a local MCP server for agents that need structured access to the dashboard.

## MCP Server

Run locally:

```powershell
npm run mcp
```

Client config example:

```json
{
  "mcpServers": {
    "command-center": {
      "command": "node",
      "args": ["D:\\Amaan AshifCommand Center\\mcp\\command-center-mcp.mjs"]
    }
  }
}
```

## Tools

- `get_dashboard_context`: reads todos, cycles, campaigns, monthly content workflow checklist, rules, and notes metadata.
- `get_dashboard_summary`: reads a compact planning summary.
- `apply_dashboard_action`: applies one action from the shared Command Center action contract.
- `add_todo`: adds a task.
- `set_todo_status`: completes or reopens a task.
- `delete_todo`: removes a task.
- `set_campaign_platform`: toggles Google, Meta, or TikTok for a brand.
- `set_brand_note`: appends or replaces a brand-cycle note.
- `set_checklist_item`: marks content workflow steps done or pending.
- `set_cycle`: updates monthly cycle dates.
- `create_note_page`: creates a notes page.
- `replace_dashboard_state`: replaces the local dashboard JSON after preserving user data.
- `list_allowed_folders`: shows folders the MCP server can access.
- `list_folder`: lists files/folders inside an approved folder.
- `read_folder_file`: reads an approved text file.
- `write_folder_file`: writes or appends an approved text file.
- `search_folder_text`: searches approved folders.

## Folder Access

By default, the MCP server can access only the Command Center project folder. Add more folders with `COMMAND_CENTER_ALLOWED_FOLDERS`.

```json
{
  "mcpServers": {
    "command-center": {
      "command": "node",
      "args": ["D:\\Amaan AshifCommand Center\\mcp\\command-center-mcp.mjs"],
      "env": {
        "COMMAND_CENTER_ALLOWED_FOLDERS": "brands=D:\\Tempest;assets=D:\\Brand Assets"
      }
    }
  }
}
```

Folder entries use this format:

```text
name=D:\Folder Path;another=D:\Another Folder
```

Blocked automatically: `.git`, `node_modules`, `__pycache__`, `.vercel`, `data/secrets.json`, and `data/desk-ai-memory.json`.

## Action Contract

Desk AI and the MCP server use the same action names:

```json
{ "type": "add_todo", "text": "KL Mobile Events: Get 1 video from editor" }
{ "type": "set_campaign_platform", "brand": "HERAVIS", "platform": "google", "active": true }
{ "type": "set_brand_note", "brand": "Recova", "text": "Report due 10th", "mode": "append" }
```

Checklist order:

```text
contentCalendar -> caption -> designerCoordination -> creatives16 -> videos4 -> campaignSetup -> report
```

## Current Storage

Command Center can now use Supabase as the shared dashboard storage.

When these environment variables are available, both Vercel and the MCP server read/write the same `command_center_state` row:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
```

Create the table by running `supabase-schema.sql` in Supabase SQL Editor.

If Supabase is not configured or temporarily unreachable, the local MCP server falls back to:

```text
D:\Amaan AshifCommand Center\data\command-center-data.json
```

The browser still saves to `localStorage` first for instant UI response, then syncs to `/api/dashboard`.

## Optional OmniRoute Provider

Desk AI uses Gemini on Vercel by default. To route Desk AI through an OpenAI-compatible OmniRoute gateway, set these environment variables:

```text
AI_PROVIDER=omniroute
OMNIROUTE_BASE_URL=https://your-reachable-omniroute-url/v1
OMNIROUTE_MODEL=auto
OMNIROUTE_API_KEY=optional-if-your-gateway-requires-it
```

Important: Vercel cannot call `http://127.0.0.1:20128` on your PC. For the deployed website, OmniRoute must be reachable from the internet through a hosted server or tunnel. Keep Gemini as fallback until OmniRoute is stable.
