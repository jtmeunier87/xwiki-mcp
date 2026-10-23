import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';
import { fileContent } from './files.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_export_page',
    {
      description: `Export a wiki page as a file. pdf and xar come back as an embedded resource (binary) plus a text block with name, type, size and URL; html returns the page HTML as text. Exports over XWIKI_MCP_MAX_FILE_BYTES (default 10 MB) are refused.

Formats:
- pdf (default): the rendered page, from xWiki's PDF export (needs the PDF export extension).
- xar: a wiki package (zip of page XML with objects and attachments) that can be imported into another wiki; a backup. Needs wiki admin rights. history: true includes page history.
- html: the rendered page(s) as static HTML, returned as text in pages (path, html). Each page's html is its content area only, without the skin's menus, scripts and footer; the export's skin, script and image files are left out (files_omitted counts them). For one page's HTML alone, xwiki_render_page with output html is lighter.

For xar and html, children: true also exports every page under a nested (WebHome) page.`,
      inputSchema: z.object({
        space: z.string().describe("Space name, dot notation for nested spaces (e.g. 'Main', 'Docs.Guides')"),
        page: z.string().describe("Page name (e.g. 'WebHome')"),
        format: z.enum(['pdf', 'xar', 'html']).default('pdf').describe('pdf (default), xar or html'),
        children: z.boolean().default(false).describe('xar / html: include every page under a nested page (default false)'),
        history: z.boolean().default(false).describe('xar: include page history (default false)'),
      }),
    },
    async ({ space, page, format, children, history }) => {
      try {
        const result = await client.exportPage(space, page, format, { children, history });
        const ext = { pdf: 'pdf', xar: 'xar', html: 'zip' }[result.format as 'pdf' | 'xar' | 'html'];
        return {
          content: result.pages
            ? [{
                type: 'text',
                text: JSON.stringify({ space, page, format: result.format, size_bytes: result.size_bytes, pages: result.pages, files_omitted: result.files_omitted }),
              }]
            : fileContent({
                name: `${space}.${page}.${ext}`,
                uri: result.url ?? '',
                mime_type: result.content_type,
                size_bytes: result.size_bytes,
                content_base64: result.content_base64 ?? '',
              }),
        };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
