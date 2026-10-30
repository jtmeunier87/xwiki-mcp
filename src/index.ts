#!/usr/bin/env node
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
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
import { register as registerGetLinks } from './tools/get-links.js';

// Write tools (Phase 1)
import { register as registerCreatePage } from './tools/create-page.js';
import { register as registerUpdatePage } from './tools/update-page.js';
import { register as registerReplaceInPage } from './tools/replace-in-page.js';
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

// v0.22: exact search in object property values
import { register as registerSearchObjects } from './tools/search-objects.js';

// Toolsets group tools so a deployment can register only what it needs (XWIKI_MCP_TOOLSETS).
const TOOLSETS = ['pages', 'recycle_bin', 'comments', 'attachments', 'tags', 'classes', 'objects', 'history', 'search', 'export'] as const;
type Toolset = (typeof TOOLSETS)[number];

// Every tool with its toolset and the access it needs. XWIKI_MCP_READ_ONLY keeps only 'read';
// 'delete' tools also need XWIKI_MCP_ALLOW_DELETE.
const TOOLS: Array<[Toolset, Access, Register]> = [
  // Pages (read)
  ['pages', 'read', registerListSpaces],
  ['pages', 'read', registerListPages],
  ['pages', 'read', registerGetPage],
  ['pages', 'read', registerListPageChildren],
  ['pages', 'read', registerGetPageTree],
  ['pages', 'read', registerGetLinks],
  ['pages', 'read', registerFindPages],
  ['pages', 'read', registerGetRequiredRights],

  // Pages (write)
  ['pages', 'write', registerCreatePage],
  ['pages', 'write', registerUpdatePage],
  ['pages', 'write', registerReplaceInPage],
  ['pages', 'write', registerMovePage],
  ['pages', 'write', registerCopyPage],
  ['pages', 'delete', registerDeletePage],

  // Recycle bin
  ['recycle_bin', 'read', registerListDeletedPages],
  ['recycle_bin', 'write', registerRestoreDeletedPage],

  // Comments
  ['comments', 'read', registerListComments],
  ['comments', 'write', registerAddComment],
  ['comments', 'write', registerUpdateComment],
  ['comments', 'delete', registerDeleteComment],

  // Attachments
  ['attachments', 'read', registerListAttachments],
  ['attachments', 'read', registerSearchAttachments],
  ['attachments', 'read', registerListAttachmentVersions],
  ['attachments', 'write', registerUploadAttachment],
  ['attachments', 'read', registerDownloadAttachment],
  ['attachments', 'write', registerMoveAttachment],
  ['attachments', 'delete', registerDeleteAttachment],

  // Tags
  ['tags', 'read', registerGetPageTags],
  ['tags', 'write', registerAddTags],
  ['tags', 'write', registerRemoveTags],
  ['tags', 'read', registerListTags],
  ['tags', 'read', registerListPagesByTag],

  // Classes
  ['classes', 'read', registerListClasses],
  ['classes', 'read', registerGetClass],
  ['classes', 'read', registerListClassPropertyValues],
  ['classes', 'write', registerUpdateClassProperties],
  ['classes', 'write', registerAddClassProperty],
  ['classes', 'write', registerSetClassPropertyEnabled],

  // Objects
  ['objects', 'read', registerListPageObjects],
  ['objects', 'read', registerGetObject],
  ['objects', 'read', registerGetObjectProperty],
  ['objects', 'read', registerListClassObjects],
  ['objects', 'read', registerSearchObjects],
  ['objects', 'write', registerCreateObject],
  ['objects', 'write', registerUpdateObject],
  ['objects', 'delete', registerDeleteObject],

  // History
  ['history', 'read', registerListPageVersions],
  ['history', 'read', registerGetPageVersion],
  ['history', 'read', registerComparePageVersions],
  ['history', 'write', registerRollbackPage],
  ['history', 'read', registerListRecentChanges],

  // Search and query
  ['search', 'read', registerSearchPages],
  ['search', 'read', registerQuery],

  // Render and export
  ['export', 'read', registerRenderPage],
  ['export', 'read', registerExportPage],
];

function allowed(access: Access): boolean {
  if (access === 'read') return true;
  if (config.readOnly) return false;
  return access === 'write' || config.allowDelete;
}

const unknownToolsets = config.toolsets.filter(t => !(TOOLSETS as readonly string[]).includes(t));
if (unknownToolsets.length > 0) {
  process.stderr.write(`Fatal: XWIKI_MCP_TOOLSETS names unknown toolsets: ${unknownToolsets.join(', ')} (known: ${TOOLSETS.join(', ')})\n`);
  process.exit(1);
}
const inToolsets = (t: Toolset) => config.toolsets.length === 0 || config.toolsets.includes(t);
const ALL_TOOLS: Array<[Access, Register]> = TOOLS.map(([, access, register]) => [access, register]);
const MODE_TOOLS: Array<[Access, Register]> = TOOLS.filter(([toolset, access]) => inToolsets(toolset) && allowed(access)).map(
  ([, access, register]) => [access, register],
);

// Sent to clients at connection; models read it to see how the tools fit together.
const INSTRUCTIONS = `Tools for one XWiki instance (${config.baseUrl}). Pages are addressed by space (dot notation for nested spaces, e.g. "Docs.Guides") and page name ("WebHome" for a space's home page).
- Find: xwiki_search_pages (full text), xwiki_find_pages (by name, space, author), xwiki_query (XWQL / HQL / Solr), xwiki_get_page_tree (every page under a root).
- Read a page with xwiki_get_page; long content comes in windows (offset / next_offset). List tools are paged with start / limit; keep paging while has_more is true.
- Structured data lives in objects of classes: xwiki_get_class shows a class's fields; xwiki_list_page_objects (one page) and xwiki_list_class_objects (every object of a class) read them; xwiki_search_objects finds the objects whose values contain exact text.
- Versions: xwiki_list_page_versions gives version numbers for xwiki_get_page_version, xwiki_compare_page_versions and xwiki_rollback_page.
- After any write, read the result back to confirm it. The wiki account's own rights apply to every call.`;
const MODE = config.readOnly ? 'read-only' : config.allowDelete ? 'read/write/delete' : 'read/write, no delete';
const DISABLED = new Set(config.disabledTools);

function buildServer(seen?: Set<string>): { server: McpServer; tools: string[] } {
  const server = new McpServer(
    { name: 'xwiki-mcp', version: VERSION },
    {
      instructions: INSTRUCTIONS,
      // The tool set is fixed for the life of the process, so clients may cache it.
      cacheHints: { 'tools/list': { ttlMs: 300_000, cacheScope: 'private' }, 'server/discover': { ttlMs: 300_000, cacheScope: 'private' } },
    },
  );
  const tools = registerTools(server, new XWikiClient(), MODE_TOOLS, DISABLED, seen);
  return { server, tools };
}

// Build once at startup to count the tools and check XWIKI_MCP_DISABLED_TOOLS names.
const allNames = new Set<string>();
registerTools(new McpServer({ name: 'xwiki-mcp', version: VERSION }), new XWikiClient(), ALL_TOOLS, new Set(), allNames);
const unknown = config.disabledTools.filter(t => !allNames.has(t));
if (unknown.length > 0) {
  process.stderr.write(`Fatal: XWIKI_MCP_DISABLED_TOOLS names unknown tools: ${unknown.join(', ')}\n`);
  process.exit(1);
}
const ENABLED_COUNT = buildServer().tools.length;
const SUMMARY = `Registered ${ENABLED_COUNT} of ${TOOLS.length} tools (${MODE}${config.toolsets.length ? `, toolsets ${config.toolsets.join(',')}` : ''}${DISABLED.size ? `, ${DISABLED.size} disabled` : ''})`;

/** True when no token is configured, or the request carries "Authorization: Bearer <token>". */
function authorized(header: string | undefined): boolean {
  if (!config.httpToken) return true;
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(config.httpToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * DNS rebinding protection for HTTP mode: a request that carries an Origin header must
 * name an allowed origin (XWIKI_MCP_ALLOWED_ORIGINS), and when XWIKI_MCP_ALLOWED_HOSTS is
 * set the Host header must be one of them. Clients that are not browsers send no Origin.
 */
function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (origin !== undefined && !config.allowedOrigins.includes(origin)) return false;
  if (config.allowedHosts.length > 0 && !config.allowedHosts.includes((host ?? '').toLowerCase())) return false;
  return true;
}

async function main() {
  const httpPort = process.env['XWIKI_MCP_PORT'] ? parseInt(process.env['XWIKI_MCP_PORT'], 10) : undefined;

  if (httpPort) {
    // Streamable HTTP transport mode (stateless)
    const mcpHttp = toNodeHandler(createMcpHandler(() => buildServer().server));
    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${httpPort}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: VERSION, tools: ENABLED_COUNT, mode: MODE }));
        return;
      }

      if (url.pathname === '/mcp') {
        if (!originAllowed(req.headers.origin, req.headers.host)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: Origin or Host not allowed');
          return;
        }
        if (req.method !== 'POST') {
          // Stateless server: no standalone SSE stream (GET) and no sessions to end (DELETE).
          res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'POST' });
          res.end('Method Not Allowed');
          return;
        }
        if (!authorized(req.headers.authorization)) {
          res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Bearer' });
          res.end('Unauthorized');
          return;
        }
        // A fresh server per request. Serves 2026-07-28 clients and, statelessly, 2025-era
        // clients that open with initialize.
        await mcpHttp(req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Available endpoints: POST /mcp, GET /health');
    });

    const shutdown = () => httpServer.close(() => process.exit(0));
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    httpServer.listen(httpPort, config.httpHost || undefined, () => {
      process.stderr.write(
        `xwiki-mcp v${VERSION} started in Streamable HTTP mode on ${config.httpHost || 'all interfaces'}, port ${httpPort}${config.httpToken ? ' (bearer token required)' : ''}\n`,
      );
      process.stderr.write(`Wiki: ${config.baseUrl} (${config.wikiName})\n`);
      process.stderr.write(`${SUMMARY}\n`);
      process.stderr.write(`MCP endpoint: http://localhost:${httpPort}/mcp\n`);
    });
  } else {
    // Default stdio transport mode
    // Answers 2026-07-28 clients and 2025-era clients (initialize), e.g. supergateway.
    const stdio = serveStdio(() => buildServer().server);
    process.once('SIGTERM', () => {
      void stdio.close().finally(() => process.exit(0));
    });

    process.stderr.write(`xwiki-mcp v${VERSION} started (stdio). Wiki: ${config.baseUrl} (${config.wikiName})\n`);
    process.stderr.write(`${SUMMARY}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
