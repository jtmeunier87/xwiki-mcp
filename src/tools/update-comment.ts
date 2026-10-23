import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_update_comment',
    {
      description: `Edit the text of a comment. The comment id is the id from xwiki_list_comments. The comment's author and date stay as they were; the page gets a new version. Reads the comment back to confirm.`,
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        id: z.number().int().min(0).describe('Comment id from xwiki_list_comments'),
        text: z.string().describe('New comment text'),
      },
    },
    async ({ space, page, id, text }) => {
      try {
        const result = await client.updateComment(space, page, id, text);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Comment not found: ${space}/${page} #${id}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
