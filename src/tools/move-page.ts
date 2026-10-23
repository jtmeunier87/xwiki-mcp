import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_move_page',
    {
      description: `Move or rename a page, as the wiki's Rename action does. The page keeps its history, objects, attachments and comments; it no longer exists at the old reference.

Give the target as its final reference, in the same form as the source:
- Nested page: target_space "Docs.Manuals", target_page "WebHome" (moves Docs.Guides.WebHome and, with children: true, everything under it).
- Terminal page: target_space "Docs.Guides", target_page "Install" (renames Docs.Guides.Setup).

Options: children (default true) moves child pages of a nested page with it; update_links (default true) rewrites links to the page across the wiki; auto_redirect (default false) leaves a redirect at the old reference. Fails if the target exists. Needs delete right on the source and edit right on the target. Read the page back at its new reference to confirm.

Links: XWiki rewrites only the pages its search index lists as linking to the page, so a page saved moments before the move can be missed. The result checks this: backlinks_found is how many linking pages the index listed, links_updated is true only when each was rewritten, and links_not_updated names pages still pointing to the old reference (fix them by hand). Object properties of type Page (a page picker) are not in the link index, so pages that refer to it only that way are not rewritten.`,
      inputSchema: {
        space: z.string().describe('Space of the page to move (dot notation, e.g. "Docs.Guides")'),
        page: z.string().describe('Name of the page to move (e.g. "WebHome")'),
        target_space: z.string().describe('Space of the new reference (e.g. "Docs.Manuals")'),
        target_page: z.string().describe('Page name of the new reference: "WebHome" for a nested page, otherwise the new page name'),
        children: z.boolean().default(true).describe('Move child pages with a nested page (default true)'),
        update_links: z.boolean().default(true).describe('Update links to the page across the wiki (default true)'),
        auto_redirect: z.boolean().default(false).describe('Leave a redirect at the old reference (default false)'),
        new_title: z.string().optional().describe('New page title. Omit to keep the current title'),
      },
    },
    async ({ space, page, target_space, target_page, children, update_links, auto_redirect, new_title }) => {
      try {
        const result = await client.movePage(space, page, target_space, target_page, {
          children,
          updateLinks: update_links,
          autoRedirect: auto_redirect,
          newTitle: new_title,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Page not found: ${space}/${page}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
