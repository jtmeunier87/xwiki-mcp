#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';
import { config } from './config.js';
import { VERSION } from './version.js';
import { XWikiClient } from './client.js';

// Read tools (original)
import { register as registerListSpaces } from './tools/list-spaces.js';
import { register as registerListPages } from './tools/list-pages.js';
import { register as registerGetPage } from './tools/get-page.js';
import { register as registerSearch } from './tools/search.js';
import { register as registerGetAttachments } from './tools/get-attachments.js';
import { register as registerGetPageChildren } from './tools/get-page-children.js';
import { register as registerGetPageTree } from './tools/get-page-tree.js';

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
import { register as registerUpdateClassProperties } from './tools/update-class-properties.js';
import { register as registerAddClassProperty } from './tools/add-class-property.js';

// Object tools (Phase 3)
import { register as registerListObjects } from './tools/list-objects.js';
import { register as registerGetObject } from './tools/get-object.js';
import { register as registerCreateObject } from './tools/create-object.js';
import { register as registerUpdateObject } from './tools/update-object.js';
import { register as registerDeleteObject } from './tools/delete-object.js';

// Phase 4: History, Query, Render, Recent Changes
import { register as registerGetPageHistory } from './tools/get-page-history.js';
import { register as registerGetPageVersion } from './tools/get-page-version.js';
import { register as registerRollbackPage } from './tools/rollback-page.js';
import { register as registerAdvancedSearch } from './tools/advanced-search.js';
import { register as registerRenderPage } from './tools/render-page.js';
import { register as registerGetRecentChanges } from './tools/get-recent-changes.js';

// Phase 5: Wiki tags, page finder, export, object property
import { register as registerGetAllWikiTags } from './tools/get-all-wiki-tags.js';
import { register as registerGetPagesByTag } from './tools/get-pages-by-tag.js';
import { register as registerFindPages } from './tools/find-pages.js';
import { register as registerExportPage } from './tools/export-page.js';
import { register as registerGetObjectProperty } from './tools/get-object-property.js';

// v0.13: objects by class, tag removal, attachment search, move, required rights
import { register as registerListClassObjects } from './tools/list-class-objects.js';
import { register as registerRemoveTags } from './tools/remove-tags.js';
import { register as registerSearchAttachments } from './tools/search-attachments.js';
import { register as registerMovePage } from './tools/move-page.js';
import { register as registerGetRequiredRights } from './tools/get-required-rights.js';

type Access = 'read' | 'write' | 'delete';
type Register = (server: McpServer, client: XWikiClient) => void;

// Every tool with the access it needs. XWIKI_MCP_READ_ONLY keeps only 'read';
// 'delete' tools also need XWIKI_MCP_ALLOW_DELETE.
const TOOLS: Array<[Access, Register]> = [
  // Pages
  ['read', registerListSpaces],
  ['read', registerListPages],
  ['read', registerGetPage],
  ['read', registerSearch],
  ['read', registerGetPageChildren],
  ['read', registerGetPageTree],
  ['write', registerCreatePage],
  ['write', registerUpdatePage],
  ['write', registerMovePage],
  ['delete', registerDeletePage],
  ['read', registerGetRequiredRights],
  ['read', registerGetComments],
  ['write', registerAddComment],

  // Attachments
  ['read', registerGetAttachments],
  ['read', registerSearchAttachments],
  ['read', registerDownloadAttachment],
  ['write', registerUploadAttachment],
  ['delete', registerDeleteAttachment],

  // Tags
  ['read', registerGetTags],
  ['write', registerAddTags],
  ['write', registerRemoveTags],

  // Classes and objects
  ['read', registerListClasses],
  ['read', registerGetClass],
  ['write', registerUpdateClassProperties],
  ['write', registerAddClassProperty],
  ['read', registerListObjects],
  ['read', registerGetObject],
  ['read', registerListClassObjects],
  ['write', registerCreateObject],
  ['write', registerUpdateObject],
  ['delete', registerDeleteObject],

  // History, query, render
  ['read', registerGetPageHistory],
  ['read', registerGetPageVersion],
  ['write', registerRollbackPage],
  ['read', registerAdvancedSearch],
  ['read', registerRenderPage],
  ['read', registerGetRecentChanges],

  // Wiki-level
  ['read', registerGetAllWikiTags],
  ['read', registerGetPagesByTag],
  ['read', registerFindPages],
  ['read', registerExportPage],
  ['read', registerGetObjectProperty],
];

function allowed(access: Access): boolean {
  if (access === 'read') return true;
  if (config.readOnly) return false;
  return access === 'write' || config.allowDelete;
}

const ENABLED_TOOLS = TOOLS.filter(([access]) => allowed(access));
const MODE = config.readOnly ? 'read-only' : config.allowDelete ? 'read/write/delete' : 'read/write, no delete';

async function buildServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'xwiki-mcp',
    version: VERSION,
  });

  const client = new XWikiClient();
  for (const [, register] of ENABLED_TOOLS) register(server, client);
  return server;
}

async function main() {
  const httpPort = process.env['XWIKI_MCP_PORT'] ? parseInt(process.env['XWIKI_MCP_PORT'], 10) : undefined;

  if (httpPort) {
    // Streamable HTTP transport mode (stateless — one transport per request)
    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${httpPort}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: VERSION, tools: ENABLED_TOOLS.length, mode: MODE }));
        return;
      }

      if (url.pathname === '/mcp') {
        // One transport + server instance per request (stateless)
        const server = await buildServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Available endpoints: POST /mcp, GET /health');
    });

    httpServer.listen(httpPort, () => {
      process.stderr.write(`xwiki-mcp v${VERSION} started in Streamable HTTP mode on port ${httpPort}\n`);
      process.stderr.write(`Wiki: ${config.baseUrl} (${config.wikiName})\n`);
      process.stderr.write(`Registered ${ENABLED_TOOLS.length} of ${TOOLS.length} tools (${MODE})\n`);
      process.stderr.write(`MCP endpoint: http://localhost:${httpPort}/mcp\n`);
    });

  } else {
    // Default stdio transport mode
    const server = await buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.stderr.write(`xwiki-mcp v${VERSION} started (stdio). Wiki: ${config.baseUrl} (${config.wikiName})\n`);
    process.stderr.write(`Registered ${ENABLED_TOOLS.length} of ${TOOLS.length} tools (${MODE})\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
