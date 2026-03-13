import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'list_spaces',
    { description: 'Get list of all spaces (top-level sections) in the wiki' },
    async () => {
      try {
        const spaces = await client.listSpaces();
        return { content: [{ type: 'text', text: JSON.stringify(spaces, null, 2) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
