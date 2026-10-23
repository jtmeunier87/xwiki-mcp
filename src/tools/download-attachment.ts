import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

// Image types MCP clients can show the model, and the size above which a file is returned as base64 text.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_download_attachment',
    'Download an attachment from a page. PNG, JPEG, GIF and WebP images up to 5 MB come back as an image the model can see, plus a text block with name, MIME type and size. Other files come back as a base64-encoded string with MIME type and size.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Docs.Guides")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      filename: z.string().describe('Filename of the attachment to download (e.g. "report.pdf")'),
    },
    async ({ space, page, filename }) => {
      try {
        const result = await client.downloadAttachment(space, page, filename);
        const mime = (result.mime_type ?? '').split(';')[0].trim().toLowerCase();
        if (IMAGE_TYPES.has(mime) && result.size_bytes <= MAX_IMAGE_BYTES) {
          return {
            content: [
              { type: 'image', data: result.content_base64, mimeType: mime },
              { type: 'text', text: JSON.stringify({ name: result.name, mime_type: mime, size_bytes: result.size_bytes }, null, 2) },
            ],
          };
        }
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
