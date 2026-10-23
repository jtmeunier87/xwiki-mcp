import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_required_rights',
    {
      description: `Analyse which rights a page's content needs to run, such as script or programming right for Velocity or Groovy, or admin right for some macros, and compare them with the rights the page declares.

Returns declared (the page's required-rights setting and whether XWiki enforces it), needed (rights the analysis says the content needs, definitely or maybe, and whether the MCP account has each), and findings (what in the page or its objects needs which right, as plain text). Useful before writing script content, or to see why a page's scripts do not run. Requires XWiki 17.4 or later and edit right on the page. Some deployments (seen on the official 17.10 and 18.8 Docker images) answer every page with "Malformed URL: the spaces section is invalid"; that is XWiki's own endpoint failing, not the request.`,
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
      },
    },
    async ({ space, page }) => {
      try {
        const report = await client.getRequiredRights(space, page);
        return { content: [{ type: 'text', text: JSON.stringify(report) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Page not found (or required rights analysis unavailable before XWiki 17.4): ${space}/${page}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
