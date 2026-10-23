import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_delete_comment',
    {
      description: `Permanently delete a comment from a page. Replies to it are kept. The comment id is the id from xwiki_get_comments. Only registered with XWIKI_MCP_ALLOW_DELETE=true.`,
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        id: z.number().int().min(0).describe('Comment id from xwiki_get_comments'),
      },
    },
    async ({ space, page, id }) => {
      try {
        const result = await client.deleteComment(space, page, id);
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
