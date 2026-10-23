#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { config } from './config.js';
import { VERSION } from './version.js';
import { XWikiClient } from './client.js';
import { registerTools, type Access, type Register } from './registry.js';

// Read tools (original)
import { register as registerListSpaces } from './tools/list-spaces.js';
import { register as registerListPages } from './tools/list-pages.js';
import { register as registerGetPage } from './tools/get-page.js';
import { register as registerSearchPages } from './tools/search-pages.js';
import { register as registerListAttachments } from './tools/list-attachments.js';
import { register as registerListPageChildren } from './tools/list-page-children.js';
import { register as registerGetPageTree } from './tools/get-page-tree.js';

// Write tools (Phase 1)
import { register as registerCreatePage } from './tools/create-page.js';
import { register as registerUpdatePage } from './tools/update-page.js';
import { register as registerDeletePage } from './tools/delete-page.js';
import { register as registerAddComment } from './tools/add-comment.js';
import { register as registerListComments } from './tools/list-comments.js';

// Attachment tools (Phase 2)
import { register as registerUploadAttachment } from './tools/upload-attachment.js';
import { register as registerDownloadAttachment } from './tools/download-attachment.js';
import { register as registerDeleteAttachment } from './tools/delete-attachment.js';

// Tag tools (Phase 2)
import { register as registerGetPageTags } from './tools/get-page-tags.js';
import { register as registerAddTags } from './tools/add-tags.js';

// Class tools (Phase 3)
import { register as registerListClasses } from './tools/list-classes.js';
import { register as registerGetClass } from './tools/get-class.js';
import { register as registerUpdateClassProperties } from './tools/update-class-properties.js';
import { register as registerAddClassProperty } from './tools/add-class-property.js';

// Object tools (Phase 3)
import { register as registerListPageObjects } from './tools/list-page-objects.js';
import { register as registerGetObject } from './tools/get-object.js';
import { register as registerCreateObject } from './tools/create-object.js';
import { register as registerUpdateObject } from './tools/update-object.js';
import { register as registerDeleteObject } from './tools/delete-object.js';

// Phase 4: History, Query, Render, Recent Changes
import { register as registerListPageVersions } from './tools/list-page-versions.js';
import { register as registerGetPageVersion } from './tools/get-page-version.js';
import { register as registerRollbackPage } from './tools/rollback-page.js';
import { register as registerQuery } from './tools/query.js';
import { register as registerRenderPage } from './tools/render-page.js';
import { register as registerListRecentChanges } from './tools/list-recent-changes.js';

// Phase 5: Wiki tags, page finder, export, object property
import { register as registerListTags } from './tools/list-tags.js';
import { register as registerListPagesByTag } from './tools/list-pages-by-tag.js';
import { register as registerFindPages } from './tools/find-pages.js';
import { register as registerExportPage } from './tools/export-page.js';
import { register as registerGetObjectProperty } from './tools/get-object-property.js';

// v0.13: objects by class, tag removal, attachment search, move, required rights
import { register as registerListClassObjects } from './tools/list-class-objects.js';
import { register as registerRemoveTags } from './tools/remove-tags.js';
import { register as registerSearchAttachments } from './tools/search-attachments.js';
import { register as registerMovePage } from './tools/move-page.js';
import { register as registerGetRequiredRights } from './tools/get-required-rights.js';

// v0.14: copy, recycle bin, property state, attachment move/history, values, compare, comments
import { register as registerCopyPage } from './tools/copy-page.js';
import { register as registerListDeletedPages } from './tools/list-deleted-pages.js';
import { register as registerRestoreDeletedPage } from './tools/restore-deleted-page.js';
import { register as registerSetClassPropertyEnabled } from './tools/set-class-property-enabled.js';
import { register as registerMoveAttachment } from './tools/move-attachment.js';
import { register as registerListAttachmentVersions } from './tools/list-attachment-versions.js';
import { register as registerListClassPropertyValues } from './tools/list-class-property-values.js';
import { register as registerComparePageVersions } from './tools/compare-page-versions.js';
import { register as registerUpdateComment } from './tools/update-comment.js';
import { register as registerDeleteComment } from './tools/delete-comment.js';

// Every tool with the access it needs. XWIKI_MCP_READ_ONLY keeps only 'read';
// 'delete' tools also need XWIKI_MCP_ALLOW_DELETE.
const TOOLS: Array<[Access, Register]> = [
  // Pages (read)
  ['read', registerListSpaces],
  ['read', registerListPages],
  ['read', registerGetPage],
  ['read', registerListPageChildren],
  ['read', registerGetPageTree],
  ['read', registerFindPages],
  ['read', registerGetRequiredRights],

  // Pages (write)
  ['write', registerCreatePage],
  ['write', registerUpdatePage],
  ['write', registerMovePage],
  ['write', registerCopyPage],
  ['delete', registerDeletePage],

  // Recycle bin
  ['read', registerListDeletedPages],
  ['write', registerRestoreDeletedPage],

  // Comments
  ['read', registerListComments],
  ['write', registerAddComment],
  ['write', registerUpdateComment],
  ['delete', registerDeleteComment],

  // Attachments
  ['read', registerListAttachments],
  ['read', registerSearchAttachments],
  ['read', registerListAttachmentVersions],
  ['write', registerUploadAttachment],
  ['read', registerDownloadAttachment],
  ['write', registerMoveAttachment],
  ['delete', registerDeleteAttachment],

  // Tags
  ['read', registerGetPageTags],
  ['write', registerAddTags],
  ['write', registerRemoveTags],
  ['read', registerListTags],
  ['read', registerListPagesByTag],

  // Classes
  ['read', registerListClasses],
  ['read', registerGetClass],
  ['read', registerListClassPropertyValues],
  ['write', registerUpdateClassProperties],
  ['write', registerAddClassProperty],
  ['write', registerSetClassPropertyEnabled],

  // Objects
  ['read', registerListPageObjects],
  ['read', registerGetObject],
  ['read', registerGetObjectProperty],
  ['read', registerListClassObjects],
  ['write', registerCreateObject],
  ['write', registerUpdateObject],
  ['delete', registerDeleteObject],

  // History
  ['read', registerListPageVersions],
  ['read', registerGetPageVersion],
  ['read', registerComparePageVersions],
  ['write', registerRollbackPage],
  ['read', registerListRecentChanges],

  // Search and query
  ['read', registerSearchPages],
  ['read', registerQuery],

  // Render and export
  ['read', registerRenderPage],
  ['read', registerExportPage],
];

function allowed(access: Access): boolean {
  if (access === 'read') return true;
  if (config.readOnly) return false;
  return access === 'write' || config.allowDelete;
}

const MODE_TOOLS = TOOLS.filter(([access]) => allowed(access));
const MODE = config.readOnly ? 'read-only' : config.allowDelete ? 'read/write/delete' : 'read/write, no delete';
const DISABLED = new Set(config.disabledTools);

function buildServer(seen?: Set<string>): { server: McpServer; tools: string[] } {
  const server = new McpServer({
    name: 'xwiki-mcp',
    version: VERSION,
  });
  const tools = registerTools(server, new XWikiClient(), MODE_TOOLS, DISABLED, seen);
  return { server, tools };
}

// Build once at startup to count the tools and check XWIKI_MCP_DISABLED_TOOLS names.
const allNames = new Set<string>();
registerTools(new McpServer({ name: 'xwiki-mcp', version: VERSION }), new XWikiClient(), TOOLS, new Set(), allNames);
const unknown = config.disabledTools.filter(t => !allNames.has(t));
if (unknown.length > 0) {
  process.stderr.write(`Fatal: XWIKI_MCP_DISABLED_TOOLS names unknown tools: ${unknown.join(', ')}\n`);
  process.exit(1);
}
const ENABLED_COUNT = buildServer().tools.length;
const SUMMARY = `Registered ${ENABLED_COUNT} of ${TOOLS.length} tools (${MODE}${DISABLED.size ? `, ${DISABLED.size} disabled` : ''})`;

/** True when no token is configured, or the request carries "Authorization: Bearer <token>". */
function authorized(header: string | undefined): boolean {
  if (!config.httpToken) return true;
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(config.httpToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function main() {
  const httpPort = process.env['XWIKI_MCP_PORT'] ? parseInt(process.env['XWIKI_MCP_PORT'], 10) : undefined;

  if (httpPort) {
    // Streamable HTTP transport mode (stateless — one transport per request)
    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${httpPort}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: VERSION, tools: ENABLED_COUNT, mode: MODE }));
        return;
      }

      if (url.pathname === '/mcp') {
        if (!authorized(req.headers.authorization)) {
          res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' });
          res.end('Unauthorized');
          return;
        }
        // One transport + server instance per request (stateless)
        const { server } = buildServer();
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

    httpServer.listen(httpPort, config.httpHost || undefined, () => {
      process.stderr.write(`xwiki-mcp v${VERSION} started in Streamable HTTP mode on ${config.httpHost || 'all interfaces'}, port ${httpPort}${config.httpToken ? ' (bearer token required)' : ''}\n`);
      process.stderr.write(`Wiki: ${config.baseUrl} (${config.wikiName})\n`);
      process.stderr.write(`${SUMMARY}\n`);
      process.stderr.write(`MCP endpoint: http://localhost:${httpPort}/mcp\n`);
    });

  } else {
    // Default stdio transport mode
    const { server } = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.stderr.write(`xwiki-mcp v${VERSION} started (stdio). Wiki: ${config.baseUrl} (${config.wikiName})\n`);
    process.stderr.write(`${SUMMARY}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
