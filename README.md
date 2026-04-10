# xwiki-mcp

[![npm version](https://img.shields.io/npm/v/xwiki-mcp)](https://www.npmjs.com/package/xwiki-mcp)
[![npm downloads](https://img.shields.io/npm/dm/xwiki-mcp)](https://www.npmjs.com/package/xwiki-mcp)
[![license](https://img.shields.io/npm/l/xwiki-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/xwiki-mcp)](package.json)

MCP server for [XWiki](https://www.xwiki.org/) REST API. Lets AI agents (Claude Code, Claude Desktop, Cursor, etc.) read **and write** your wiki — search pages, browse spaces, create and update content, manage comments, and fetch attachments.

> **v0.2.0** — Adds write operations: create/update/delete pages, add/get comments, and CSRF token handling.

## Tools

### Read Tools

| Tool | Description |
|------|-------------|
| `list_spaces` | List all spaces in the wiki |
| `list_pages` | List pages in a space (paginated) |
| `get_page` | Get page content and metadata |
| `get_page_children` | List child pages |
| `get_attachments` | List attachments on a page |
| `search` | Full-text search across the wiki |

### Write Tools (New in v0.2.0)

| Tool | Description |
|------|-------------|
| `create_page` | Create a new wiki page with title, content, and optional parent |
| `update_page` | Update an existing page's content, title, or both (preserves unchanged fields) |
| `delete_page` | Delete a wiki page permanently |
| `add_comment` | Add a comment to a page (supports threaded replies) |
| `get_comments` | Get all comments on a page |

### CSRF Token Handling

Write operations automatically handle XWiki's CSRF protection (required since xWiki 14.10.8+):
- Tokens are cached from GET response headers and included in all mutating requests
- On 403 (stale token), the server automatically refreshes the token and retries once

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

## Usage with Claude Code / Claude Desktop

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

## Usage with Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

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
npm test       # Run tests
```

## Roadmap

- [ ] **Phase 2**: Attachment upload/download/delete, tag management
- [ ] **Phase 3**: XObject CRUD (structured data), class listing
- [ ] **Phase 4**: Page history, advanced search (HQL/XWQL/Solr), HTTP/SSE transport

## License

MIT
