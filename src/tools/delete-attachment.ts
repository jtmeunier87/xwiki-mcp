import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'delete_attachment',
    'Delete an attachment from a page. This action is permanent and cannot be undone.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Finance")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      filename: z.string().describe('Filename of the attachment to delete (e.g. "old-report.pdf")'),
    },
    async ({ space, page, filename }) => {
      try {
        const result = await client.deleteAttachment(space, page, filename);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ filename, ...result }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error deleting attachment: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
