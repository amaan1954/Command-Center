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
- `set_campaign_platform`: toggles Google, Meta, or TikTok for a brand.
- `set_brand_note`: appends or replaces a brand-cycle note.
- `replace_dashboard_state`: replaces the local dashboard JSON after preserving user data.

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

The local MCP server reads and writes:

```text
D:\Amaan AshifCommand Center\data\command-center-data.json
```

The Vercel website still stores dashboard state in the browser. For true cross-device memory, the next integration should add a database-backed state API.

## Optional OmniRoute Provider

Desk AI uses Gemini on Vercel by default. To route Desk AI through an OpenAI-compatible OmniRoute gateway, set these environment variables:

```text
AI_PROVIDER=omniroute
OMNIROUTE_BASE_URL=https://your-reachable-omniroute-url/v1
OMNIROUTE_MODEL=auto
OMNIROUTE_API_KEY=optional-if-your-gateway-requires-it
```

Important: Vercel cannot call `http://127.0.0.1:20128` on your PC. For the deployed website, OmniRoute must be reachable from the internet through a hosted server or tunnel. Keep Gemini as fallback until OmniRoute is stable.
