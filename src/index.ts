#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { XWikiClient } from './client.js';

// Read tools (existing)
import { register as registerListSpaces } from './tools/list-spaces.js';
import { register as registerListPages } from './tools/list-pages.js';
import { register as registerGetPage } from './tools/get-page.js';
import { register as registerSearch } from './tools/search.js';
import { register as registerGetAttachments } from './tools/get-attachments.js';
import { register as registerGetPageChildren } from './tools/get-page-children.js';

// Write tools (Phase 1)
import { register as registerCreatePage } from './tools/create-page.js';
import { register as registerUpdatePage } from './tools/update-page.js';
import { register as registerDeletePage } from './tools/delete-page.js';
import { register as registerAddComment } from './tools/add-comment.js';
import { register as registerGetComments } from './tools/get-comments.js';

async function main() {
  const server = new McpServer({
    name: 'xwiki-mcp',
    version: '0.2.0',
  });

  const client = new XWikiClient();

  // Read tools
  registerListSpaces(server, client);
  registerListPages(server, client);
  registerGetPage(server, client);
  registerSearch(server, client);
  registerGetAttachments(server, client);
  registerGetPageChildren(server, client);

  // Write tools
  registerCreatePage(server, client);
  registerUpdatePage(server, client);
  registerDeletePage(server, client);
  registerAddComment(server, client);
  registerGetComments(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't pollute the stdio MCP protocol stream
  process.stderr.write(`xwiki-mcp started (v0.2.0). Wiki: ${config.baseUrl} (${config.wikiName})\n`);
  process.stderr.write(`Registered 11 tools (6 read, 5 write)\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
