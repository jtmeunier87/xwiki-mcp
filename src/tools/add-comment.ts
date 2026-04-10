import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_add_comment',
    {
      description:
        'Add a comment to a wiki page. Optionally reply to an existing comment by providing its ID.',
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "WebHome", "MyPage")'),
        text: z.string().describe('Comment text content'),
        reply_to: z
          .number()
          .int()
          .optional()
          .describe('ID of the comment to reply to (for threaded comments). Use get_comments to find IDs.'),
      },
    },
    async ({ space, page, text, reply_to }) => {
      try {
        const result = await client.addComment(space, page, text, reply_to);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Page not found: ${space}/${page}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
