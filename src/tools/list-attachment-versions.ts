import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_attachment_versions',
    {
      description: `List the versions of one attachment, newest first, with size, media type, author, date and a download URL for each version.`,
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        filename: z.string().describe('Attachment file name (e.g. "diagram.png")'),
      },
    },
    async ({ space, page, filename }) => {
      try {
        const result = await client.getAttachmentHistory(space, page, filename).then(versions => ({ filename, count: versions.length, versions }));
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Attachment not found: ${space}/${page}@${filename}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
