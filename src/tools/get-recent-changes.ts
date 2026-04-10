import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'get_recent_changes',
    'Get the most recent page modifications across the entire wiki. Shows who edited what and when, with optional edit comments. Useful for activity monitoring, change audits, and staying up to date with wiki activity.',
    {
      limit: z.number().int().min(1).max(100).default(20).describe('Number of recent changes to return (default 20)'),
    },
    async ({ limit }) => {
      const changes = await client.getRecentChanges(limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ count: changes.length, recent_changes: changes }, null, 2),
        }],
      };
    },
  );
}
