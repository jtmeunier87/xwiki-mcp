# xwiki-mcp

[![npm version](https://img.shields.io/npm/v/xwiki-mcp)](https://www.npmjs.com/package/xwiki-mcp)
[![npm downloads](https://img.shields.io/npm/dm/xwiki-mcp)](https://www.npmjs.com/package/xwiki-mcp)
[![license](https://img.shields.io/npm/l/xwiki-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/xwiki-mcp)](package.json)

MCP server for [XWiki](https://www.xwiki.org/) REST API. Lets AI agents (Claude Code, Claude Desktop, etc.) read your wiki — search pages, browse spaces, fetch content and attachments.

## Tools

| Tool | Description |
|------|-------------|
| `list_spaces` | List all spaces in the wiki |
| `list_pages` | List pages in a space |
| `get_page` | Get page content and metadata |
| `get_page_children` | List child pages |
| `get_attachments` | List attachments on a page |
| `search` | Full-text search across the wiki |

## Installation

Via npm:

```bash
npm install -g xwiki-mcp
```

Or use directly with npx (no install needed):

```bash
npx xwiki-mcp
```

Or from source:

```bash
git clone https://github.com/vitos73/xwiki-mcp
cd xwiki-mcp
npm install
npm run build
```

## Configuration

Set environment variables before running:

```
XWIKI_BASE_URL      # Required. Base URL without /rest (e.g. https://wiki.example.com)
XWIKI_AUTH_TYPE     # basic | token | none  (default: basic)
XWIKI_USERNAME      # For basic auth
XWIKI_PASSWORD      # For basic auth
XWIKI_TOKEN         # For token auth (Bearer)
XWIKI_WIKI_NAME     # Wiki name (default: xwiki)
XWIKI_REST_PATH     # REST path (default: /rest)
XWIKI_PAGE_LIMIT    # Default page size (default: 50)
```

## Usage with Claude Code

Add to your `.mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xwiki": {
      "command": "npx",
      "args": ["xwiki-mcp"],
      "env": {
        "XWIKI_BASE_URL": "https://wiki.example.com",
        "XWIKI_AUTH_TYPE": "basic",
        "XWIKI_USERNAME": "your-username",
        "XWIKI_PASSWORD": "your-password"
      }
    }
  }
}
```

## Development

```bash
npm run dev    # Run with tsx (no build step)
npm run build  # Compile TypeScript to dist/
```

## License

MIT
