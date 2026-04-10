import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_get_all_wiki_tags',
    'List all tags used anywhere in the wiki. Use this to discover available tags before calling get_pages_by_tag.',
    {},
    async (_args: Record<string, never>) => {
      const tags = await client.getAllWikiTags();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ count: tags.length, tags }, null, 2),
        }],
      };
    },
  );
}
