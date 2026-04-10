import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'render_page',
    `Render a wiki page to plain text or HTML by executing the page through the xWiki rendering engine.

Useful for:
- Extracting readable text from pages with complex wiki markup or macros
- Getting the rendered HTML output of a page
- Reading macro-generated content that is not visible in raw page source

Note: uses the xWiki action URL (/bin/get/...), not the REST API.`,
    {
      space: z.string().describe("Wiki space name (e.g. 'Main', 'Sandbox')"),
      page: z.string().describe("Page name (e.g. 'WebHome')"),
      output: z.enum(['plain', 'html']).default('plain').describe("Output format: 'plain' for readable plain text (default), 'html' for rendered HTML"),
    },
    async ({ space, page, output }) => {
      const result = await client.renderPage(space, page, output);
      return {
        content: [{
          type: 'text',
          text: result.content,
        }],
      };
    },
  );
}
