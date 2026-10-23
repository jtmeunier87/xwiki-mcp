import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_copy_page',
    {
      description: `Copy a page to a new reference, as the wiki's Copy action does. The copy gets the content, objects, attachments and tags; the original is unchanged.

Give the target as its final reference, in the same form as the source:
- Nested page: target_space "Docs.Manuals", target_page "WebHome" (copies Docs.Guides.WebHome and, with children: true, everything under it).
- Terminal page: target_space "Docs.Guides", target_page "SetupCopy".

Fails if the target exists. Needs view right on the source and edit right on the target. Read the copy back to confirm.`,
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        target_space: z.string().describe('Space of the new reference (e.g. "Docs.Manuals")'),
        target_page: z.string().describe('Page name of the new reference: "WebHome" for a nested page, otherwise the new page name'),
        children: z.boolean().default(true).describe('Copy child pages with a nested page (default true)'),
        new_title: z.string().optional().describe('Title for the copy. Omit to keep the source title'),
      }),
    },
    async ({ space, page, target_space, target_page, children, new_title }) => {
      try {
        const result = await client.copyPage(space, page, target_space, target_page, { children, newTitle: new_title });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
