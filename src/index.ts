#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from 'http';
import { config } from './config.js';
import { XWikiClient } from './client.js';

// Read tools (original)
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

// Attachment tools (Phase 2)
import { register as registerUploadAttachment } from './tools/upload-attachment.js';
import { register as registerDownloadAttachment } from './tools/download-attachment.js';
import { register as registerDeleteAttachment } from './tools/delete-attachment.js';

// Tag tools (Phase 2)
import { register as registerGetTags } from './tools/get-tags.js';
import { register as registerAddTags } from './tools/add-tags.js';

// Class tools (Phase 3)
import { register as registerListClasses } from './tools/list-classes.js';
import { register as registerGetClass } from './tools/get-class.js';

// Object tools (Phase 3)
import { register as registerListObjects } from './tools/list-objects.js';
import { register as registerGetObject } from './tools/get-object.js';
import { register as registerCreateObject } from './tools/create-object.js';
import { register as registerUpdateObject } from './tools/update-object.js';
import { register as registerDeleteObject } from './tools/delete-object.js';

// Phase 4: History, Query, Render, Recent Changes
import { register as registerGetPageHistory } from './tools/get-page-history.js';
import { register as registerGetPageVersion } from './tools/get-page-version.js';
import { register as registerAdvancedSearch } from './tools/advanced-search.js';
import { register as registerRenderPage } from './tools/render-page.js';
import { register as registerGetRecentChanges } from './tools/get-recent-changes.js';

const TOOL_COUNT = 28;
const TOOL_SUMMARY = '6 read, 5 write, 3 attachment, 2 tag, 2 class, 5 object, 5 history/query/render';

async function buildServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'xwiki-mcp',
    version: '0.4.0',
  });

  const client = new XWikiClient();

  // Read tools (6)
  registerListSpaces(server, client);
  registerListPages(server, client);
  registerGetPage(server, client);
  registerSearch(server, client);
  registerGetAttachments(server, client);
  registerGetPageChildren(server, client);

  // Write tools (5)
  registerCreatePage(server, client);
  registerUpdatePage(server, client);
  registerDeletePage(server, client);
  registerAddComment(server, client);
  registerGetComments(server, client);

  // Attachment tools (3)
  registerUploadAttachment(server, client);
  registerDownloadAttachment(server, client);
  registerDeleteAttachment(server, client);

  // Tag tools (2)
  registerGetTags(server, client);
  registerAddTags(server, client);

  // Class tools (2)
  registerListClasses(server, client);
  registerGetClass(server, client);

  // Object tools (5)
  registerListObjects(server, client);
  registerGetObject(server, client);
  registerCreateObject(server, client);
  registerUpdateObject(server, client);
  registerDeleteObject(server, client);

  // Phase 4 tools (5)
  registerGetPageHistory(server, client);
  registerGetPageVersion(server, client);
  registerAdvancedSearch(server, client);
  registerRenderPage(server, client);
  registerGetRecentChanges(server, client);

  return server;
}

async function main() {
  const httpPort = process.env['XWIKI_MCP_PORT'] ? parseInt(process.env['XWIKI_MCP_PORT'], 10) : undefined;

  if (httpPort) {
    // HTTP/SSE transport mode
    const server = await buildServer();

    // Map of session ID -> SSEServerTransport for multi-client support
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${httpPort}`);

      if (req.method === 'GET' && url.pathname === '/sse') {
        // SSE connection endpoint — establish a new MCP session
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };

        await server.connect(transport);

      } else if (req.method === 'POST' && url.pathname === '/message') {
        // Client message endpoint
        const sessionId = url.searchParams.get('sessionId');
        const transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Session not found');
          return;
        }

        await transport.handlePostMessage(req, res);

      } else if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.4.0', tools: TOOL_COUNT }));

      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found. Available endpoints: GET /sse, POST /message, GET /health');
      }
    });

    httpServer.listen(httpPort, () => {
      process.stderr.write(`xwiki-mcp v0.4.0 started in HTTP/SSE mode on port ${httpPort}\n`);
      process.stderr.write(`Wiki: ${config.baseUrl} (${config.wikiName})\n`);
      process.stderr.write(`Registered ${TOOL_COUNT} tools (${TOOL_SUMMARY})\n`);
      process.stderr.write(`SSE endpoint: http://localhost:${httpPort}/sse\n`);
    });

  } else {
    // Default stdio transport mode
    const server = await buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.stderr.write(`xwiki-mcp started (v0.4.0). Wiki: ${config.baseUrl} (${config.wikiName})\n`);
    process.stderr.write(`Registered ${TOOL_COUNT} tools (${TOOL_SUMMARY})\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
