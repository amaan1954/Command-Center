#!/usr/bin/env node
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCommandCenterServer } from "./command-center-tools.mjs";

const HOST = process.env.COMMAND_CENTER_MCP_HOST || "127.0.0.1";
const PORT = Number(process.env.COMMAND_CENTER_MCP_PORT || 8787);
const PATHNAME = process.env.COMMAND_CENTER_MCP_PATH || "/mcp";

async function handleMcpRequest(req, res) {
  const server = createCommandCenterServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    transport.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mcp: `http://${HOST}:${PORT}${PATHNAME}` }));
    return;
  }

  if (url.pathname !== PATHNAME) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Use ${PATHNAME} for MCP or /health for status.` }));
    return;
  }

  try {
    await handleMcpRequest(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: error.message || "MCP HTTP request failed" }));
  }
});

httpServer.listen(PORT, HOST, () => {
  console.error(`Command Center MCP HTTP ready: http://${HOST}:${PORT}${PATHNAME}`);
  console.error(`Health check: http://${HOST}:${PORT}/health`);
});
