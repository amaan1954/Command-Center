#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCommandCenterServer } from "./command-center-tools.mjs";

const server = createCommandCenterServer();
const transport = new StdioServerTransport();
await server.connect(transport);
