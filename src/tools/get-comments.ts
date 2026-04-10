import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'get_comments',
    {
      description:
        'Get all comments on a wiki page. Returns comment IDs, authors, dates, text, and reply-to references. ' +
        'Use the comment IDs with add_comment to post threaded replies.',
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "WebHome", "MyPage")'),
      },
    },
    async ({ space, page }) => {
      try {
        const comments = await client.getComments(space, page);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ comments, count: comments.length }, null, 2),
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
