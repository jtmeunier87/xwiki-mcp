import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_page_tree',
    {
      description: `Get every descendant of a page in one call: a report of the page tree under a root page.

root_page is the root page's own row (level 0), with its object classes; pages lists its descendants. Each row has its reference, title, level (1 = direct child of the root), parent, number of direct children, URL, and the object classes attached to it with a count per class (e.g. {"XWiki.TagClass": 1}). class_totals counts how many pages in the tree, the root included, carry each class. Rows in pages come in depth-first order, each page followed by its descendants.

hierarchy:
- parentchild (default): follows each page's parent field, as XWiki's REST children endpoint does by default.
- nestedpages: follows the page/space nesting (Docs.Guides.WebHome -> Docs.Guides.Setup.WebHome).

The walk makes one request per page (plus one per page for objects), so large trees are capped by max_pages; truncated: true means the cap was reached. For direct children only, use xwiki_list_page_children.`,
      inputSchema: z.object({
        space: z.string().describe('Space of the root page. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Root page name (e.g. "WebHome")'),
        hierarchy: z
          .enum(['parentchild', 'nestedpages'])
          .default('parentchild')
          .describe('Which hierarchy to follow (default parentchild)'),
        max_depth: z.number().int().min(1).max(50).default(50).describe('Levels below the root to include (default 50)'),
        max_pages: z.number().int().min(1).max(2000).default(500).describe('Stop after this many pages (default 500)'),
        include_objects: z
          .boolean()
          .default(true)
          .describe('List the object classes on each page (one extra request per page; default true)'),
      }),
    },
    async ({ space, page, hierarchy, max_depth, max_pages, include_objects }) => {
      try {
        const tree = await client.getPageTree(space, page, {
          hierarchy,
          maxDepth: max_depth,
          maxPages: max_pages,
          includeObjects: include_objects,
        });
        return { content: [{ type: 'text', text: JSON.stringify(tree) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
