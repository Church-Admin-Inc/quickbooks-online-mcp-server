#!/usr/bin/env node

import { createStreamableHttpServer, MCP_HTTP_PATH } from "./http/create-streamable-http-server.js";
import { registerAllTools } from "./server/register-all-tools.js";

// `??` only falls through on null/undefined, not on "" — a process manager
// that exports an unset PORT as an empty string would otherwise silently
// resolve to Number("") === 0 and listen on a random ephemeral port.
function readPort(): number {
  for (const raw of [process.env.PORT, process.env.MCP_HTTP_PORT]) {
    if (raw) return Number(raw);
  }
  return 3000;
}

const port = readPort();

const server = createStreamableHttpServer(registerAllTools);

server.listen(port, () => {
  console.error(`QuickBooks Online MCP Server listening on streamable HTTP at :${port}${MCP_HTTP_PATH}`);
});
