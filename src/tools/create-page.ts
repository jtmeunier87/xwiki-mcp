import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'create_page',
    {
      description:
        'Create a new wiki page. The page will be created in the specified space with the given name. ' +
        'If a page with the same name already exists in the space, it will be overwritten. ' +
        'Content should be in xwiki/2.1 syntax by default.',
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "MyNewPage"). This becomes the URL slug.'),
        title: z.string().describe('Display title of the page'),
        content: z.string().describe('Page content in wiki markup (xwiki/2.1 syntax by default)'),
        syntax: z
          .string()
          .optional()
          .default('xwiki/2.1')
          .describe('Content syntax. Default: "xwiki/2.1". Other options: "markdown/1.2", "plain/1.0", "html/5.0"'),
        parent: z
          .string()
          .optional()
          .describe('Parent page reference (e.g. "Main.WebHome") for hierarchy'),
      },
    },
    async ({ space, page, title, content, syntax, parent }) => {
      try {
        const result = await client.createPage(space, page, title, content, syntax, parent);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
