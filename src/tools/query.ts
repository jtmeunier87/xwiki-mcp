import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_query',
    `Run a structured query against the wiki and get the matching pages.

Query types:
- solr (default): Solr query. Example: "type:DOCUMENT AND space:Main AND title:Release"
- xwql: XWiki Query Language WHERE clause. Example: "where doc.author = 'XWiki.Admin' order by doc.date desc"
- hql: Hibernate Query Language WHERE clause. Example: "where doc.space = 'Main' and doc.author = 'XWiki.Admin'"

For XWQL and HQL give ONLY the WHERE clause; xWiki prepends "select doc.fullName from XWikiDocument as doc". Since XWiki 17.10.5 / 18.2 the REST API allows only solr unless an admin adds the type to rest.allowedQueryTypes in xwiki.properties; a refused type returns that message. To read every object of a class, xwiki_list_class_objects needs no query.`,
    {
      query: z.string().describe('The query string — for hql/xwql: just the WHERE clause (e.g. "where doc.space = \'Sandbox\'"); for solr: full Solr expression'),
      type: z.enum(['hql', 'xwql', 'solr']).default('solr').describe('Query language: solr (default), xwql or hql'),
      limit: z.number().int().min(1).max(200).default(20).describe('Maximum results to return (default 20)'),
      start: z.number().int().min(0).default(0).describe('Offset for pagination (default 0)'),
    },
    async ({ query, type, limit, start }) => {
      const results = await client.advancedSearch(query, type, limit, start);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ query, type, count: results.length, results }),
        }],
      };
    },
  );
}
