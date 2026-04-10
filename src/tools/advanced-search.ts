import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'advanced_search',
    `Run a structured HQL or XWQL query against the wiki.

Query types:
- hql: Hibernate Query Language WHERE clause. Example: "where doc.space = 'Main' and doc.author = 'XWiki.Admin'"
- xwql: XWiki Query Language WHERE clause (preferred). Example: "where doc.author = 'XWiki.PercyProcess' order by doc.date desc"
- solr: Full-text Solr query. Example: "type:DOCUMENT AND space:Main AND title:Meeting"

For HQL and XWQL, provide ONLY the WHERE clause — xWiki automatically prepends "select doc.fullName from XWikiDocument as doc".`,
    {
      query: z.string().describe('The query string — for hql/xwql: just the WHERE clause (e.g. "where doc.space = \'Sandbox\'"); for solr: full Solr expression'),
      type: z.enum(['hql', 'xwql', 'solr']).default('xwql').describe('Query language: hql, xwql (default), or solr'),
      limit: z.number().int().min(1).max(200).default(20).describe('Maximum results to return (default 20)'),
      start: z.number().int().min(0).default(0).describe('Offset for pagination (default 0)'),
    },
    async ({ query, type, limit, start }) => {
      const results = await client.advancedSearch(query, type, limit, start);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ query, type, count: results.length, results }, null, 2),
        }],
      };
    },
  );
}
