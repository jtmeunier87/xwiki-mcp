import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_attachment_versions',
    {
      description: `List the versions of one attachment, newest first, with size, media type, author, date and a download URL for each version. Paged with start / limit.`,
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        filename: z.string().describe('Attachment file name (e.g. "diagram.png")'),
        ...pagingShape,
      },
    },
    async ({ space, page, filename, start, limit }) => {
      try {
        const { items, _pagination } = pageOf(await client.getAttachmentHistory(space, page, filename), start, limit);
        const result = { filename, versions: items, _pagination };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Attachment not found: ${space}/${page}@${filename}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
