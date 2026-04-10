import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_upload_attachment',
    'Upload a file as an attachment to a page. The file content must be provided as a base64-encoded string. Returns the attachment metadata including URL.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Finance")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      filename: z.string().describe('Filename for the attachment including extension (e.g. "report.pdf")'),
      content_base64: z.string().describe('Base64-encoded file content'),
      mime_type: z.string().default('application/octet-stream').describe('MIME type of the file (e.g. "image/png", "application/pdf")'),
    },
    async ({ space, page, filename, content_base64, mime_type }) => {
      try {
        const result = await client.uploadAttachment(space, page, filename, content_base64, mime_type);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error uploading attachment: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
