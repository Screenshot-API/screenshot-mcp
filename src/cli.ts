#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is reserved for the MCP protocol stream.
  console.error("screenshotapi-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting screenshotapi-mcp server:", err);
  process.exit(1);
});
