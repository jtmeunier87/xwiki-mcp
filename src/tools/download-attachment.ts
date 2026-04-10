import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_download_attachment',
    'Download an attachment from a page. Returns the file content as a base64-encoded string along with MIME type and size.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Finance")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      filename: z.string().describe('Filename of the attachment to download (e.g. "report.pdf")'),
    },
    async ({ space, page, filename }) => {
      try {
        const result = await client.downloadAttachment(space, page, filename);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: result.name,
              mime_type: result.mime_type,
              size_bytes: result.size_bytes,
              content_base64: result.content_base64,
            }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error downloading attachment: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
