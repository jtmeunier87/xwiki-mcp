import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_export_page',
    `Export a wiki page as a file. pdf and xar return it base64-encoded with its size and content type; html returns the page HTML as text.

Formats:
- pdf (default): the rendered page, from xWiki's PDF export (needs the PDF export extension).
- xar: a wiki package (zip of page XML with objects and attachments) that can be imported into another wiki; a backup. Needs wiki admin rights. history: true includes page history.
- html: the rendered page(s) as static HTML, returned as text in pages (path, html). The export's skin, script and image files are left out (files_omitted counts them). For one page's HTML alone, xwiki_render_page with output html is lighter.

For xar and html, children: true also exports every page under a nested (WebHome) page.`,
    {
      space: z.string().describe("Space name, dot notation for nested spaces (e.g. 'Main', 'Docs.Guides')"),
      page: z.string().describe("Page name (e.g. 'WebHome')"),
      format: z.enum(['pdf', 'xar', 'html']).default('pdf').describe('pdf (default), xar or html'),
      children: z.boolean().default(false).describe('xar / html: include every page under a nested page (default false)'),
      history: z.boolean().default(false).describe('xar: include page history (default false)'),
    },
    async ({ space, page, format, children, history }) => {
      try {
        const result = await client.exportPage(space, page, format, { children, history });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              space: result.space,
              page: result.page,
              format: result.format,
              content_type: result.content_type,
              size_bytes: result.size_bytes,
              size_kb: Math.round(result.size_bytes / 1024),
              ...(result.pages ? { pages: result.pages, files_omitted: result.files_omitted } : { content_base64: result.content_base64 }),
            }, null, 2),
          }],
        };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Page not found: ${space}/${page}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
