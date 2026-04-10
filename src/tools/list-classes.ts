import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_list_classes',
    'List all XWiki classes (XObject schemas) defined in the wiki. Classes define structured data types used by XObjects attached to pages.',
    {
      start: z.number().int().min(0).default(0).describe('Zero-based offset for pagination'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of classes to return'),
    },
    async ({ start, limit }) => {
      try {
        const { classes, pagination } = await client.listClasses(start, limit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ classes, pagination }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing classes: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
