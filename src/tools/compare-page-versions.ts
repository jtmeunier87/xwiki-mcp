import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_compare_page_versions',
    {
      description: `Compare two versions of a page: a unified diff of the content (- removed, + added lines, with context), the number of lines added and removed, and any title or syntax change, with each version's author and date. Omit to_version to compare with the current version. Version numbers come from xwiki_list_page_versions (e.g. "3.1").`,
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        from_version: z.string().describe('Older version, e.g. "3.1"'),
        to_version: z.string().optional().describe('Newer version; omit for the current version'),
        context: z.number().int().min(0).max(20).default(3).describe('Unchanged lines shown around each change (default 3)'),
      }),
    },
    async ({ space, page, from_version, to_version, context }) => {
      try {
        const result = await client.comparePageVersions(space, page, from_version, to_version, context);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404
            ? `Page or version not found: ${space}/${page}`
            : e instanceof Error
              ? e.message
              : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
