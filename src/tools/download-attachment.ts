import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';
import { fileContent } from './files.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_download_attachment',
    {
      description:
        'Download an attachment from a page. PNG, JPEG, GIF and WebP images up to 5 MB come back as an image the model can see; other files as an embedded resource (binary). A text block gives name, MIME type, size and URL. Files over XWIKI_MCP_MAX_FILE_BYTES (default 10 MB) are refused with the URL to open instead. To list files without downloading, use xwiki_list_attachments.',
      inputSchema: z.object({
        space: z.string().describe('Space name in dot notation (e.g. "Main" or "Docs.Guides")'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        filename: z.string().describe('Filename of the attachment to download (e.g. "report.pdf")'),
      }),
    },
    async ({ space, page, filename }) => {
      try {
        const result = await client.downloadAttachment(space, page, filename);
        return { content: fileContent({ ...result, uri: result.download_url }) };
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
