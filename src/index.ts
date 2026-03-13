#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { XWikiClient } from './client.js';
import { register as registerListSpaces } from './tools/list-spaces.js';
import { register as registerListPages } from './tools/list-pages.js';
import { register as registerGetPage } from './tools/get-page.js';
import { register as registerSearch } from './tools/search.js';
import { register as registerGetAttachments } from './tools/get-attachments.js';
import { register as registerGetPageChildren } from './tools/get-page-children.js';

// Phase 2 stubs (write operations) — not implemented
// TODO: create_page   — PUT /wikis/{wiki}/spaces/{space}/pages/{page}
// TODO: update_page   — PUT /wikis/{wiki}/spaces/{space}/pages/{page} (with content body)
// TODO: add_comment   — POST /wikis/{wiki}/spaces/{space}/pages/{page}/comments

async function main() {
  const server = new McpServer({
    name: 'xwiki-mcp',
    version: '0.1.0',
  });

  const client = new XWikiClient();

  registerListSpaces(server, client);
  registerListPages(server, client);
  registerGetPage(server, client);
  registerSearch(server, client);
  registerGetAttachments(server, client);
  registerGetPageChildren(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the stdio MCP protocol stream
  process.stderr.write(`xwiki-mcp started. Wiki: ${config.baseUrl} (${config.wikiName})\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
