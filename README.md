# xwiki-mcp

A Model Context Protocol (MCP) server for [XWiki](https://www.xwiki.org/), providing AI agents with full read/write access to an XWiki instance via its REST API.

**Fork of [vitos73/xwiki-mcp](https://github.com/vitos73/xwiki-mcp)** — extended with write operations, attachment management, tag management, XObject/class CRUD, page history, advanced query (HQL/XWQL/Solr), page rendering, recent changes tracking, and HTTP/SSE transport.

---

## Features

### 28 Tools across 6 categories

| Category | Tools |
|---|---|
| **Pages (Read)** | `list_spaces`, `list_pages`, `get_page`, `get_page_children`, `search` |
| **Pages (Write)** | `create_page`, `update_page`, `delete_page`, `add_comment`, `get_comments` |
| **Attachments** | `get_attachments`, `upload_attachment`, `download_attachment`, `delete_attachment` |
| **Tags** | `get_tags`, `add_tags` |
| **Classes** | `list_classes`, `get_class` |
| **Objects (XObjects)** | `list_objects`, `get_object`, `create_object`, `update_object`, `delete_object` |
| **History & Query** | `get_page_history`, `get_page_version`, `advanced_search`, `render_page`, `get_recent_changes` |

### Key implementation notes

- **CSRF token handling**: Tokens are cached from GET response headers (`XWiki-Form-Token`) and automatically refreshed on 403 — required for xWiki 14.10.8+ (always for xWiki 18.x)
- **XML request bodies**: Write operations use `application/xml` bodies (more reliable than JSON for xWiki REST mutations)
- **Nested space support**: Space names use dot notation (`Space.SubSpace.Child`) which the client converts to xWiki's `/spaces/X/spaces/Y/` URL path format
- **xWiki API typo**: The classes endpoint returns `clazzs` (not `classes`) — the client handles this transparently
- **Binary attachments**: Upload/download uses `Buffer` for binary content, with base64 encoding at the tool boundary
- **Render endpoint**: Uses the xWiki action URL (`/bin/get/`) rather than the REST API — required for proper macro/template rendering
- **HTTP/SSE transport**: Set `XWIKI_MCP_PORT` to expose a server-sent events endpoint (for multi-client HTTP usage)

---

## Installation

### With Cursor / Claude Desktop

Add to your MCP config (`.cursor/mcp.json` or Claude Desktop `config.json`):

```json
{
  "mcpServers": {
    "xwiki": {
      "command": "npx",
      "args": ["github:jtmeunier87/xwiki-mcp"],
      "env": {
        "XWIKI_BASE_URL": "https://your-wiki-url.com",
        "XWIKI_AUTH_TYPE": "basic",
        "XWIKI_USERNAME": "YourUser",
        "XWIKI_PASSWORD": "YourPassword"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XWIKI_BASE_URL` | Yes | — | Base URL of your xWiki instance (e.g. `https://wiki.example.com`) |
| `XWIKI_AUTH_TYPE` | No | `basic` | Auth method: `basic` or `token` |
| `XWIKI_USERNAME` | If basic | — | xWiki username |
| `XWIKI_PASSWORD` | If basic | — | xWiki password |
| `XWIKI_TOKEN` | If token | — | Bearer token (xWiki API tokens require 15.4+) |
| `XWIKI_WIKI_NAME` | No | `xwiki` | Wiki name (default wiki is always `xwiki`) |
| `XWIKI_MCP_PORT` | No | — | If set, starts HTTP/SSE transport on this port instead of stdio |

---

## HTTP/SSE Transport

By default the server runs in stdio mode (for use with Claude Desktop / Cursor). To expose an HTTP server for multi-client or remote usage:

```bash
XWIKI_MCP_PORT=3001 \
XWIKI_BASE_URL=https://your-wiki.com \
XWIKI_USERNAME=YourUser \
XWIKI_PASSWORD=YourPassword \
node dist/index.js
```

Endpoints:
- `GET /sse` — SSE connection endpoint (MCP clients connect here)
- `POST /message?sessionId=...` — Message send endpoint
- `GET /health` — Health check (returns version and tool count)

---

## Tool Reference

### Page Tools

#### `list_spaces`
List all spaces in the wiki. Returns id, name, and home URL.

#### `list_pages`
List pages in a space. Supports pagination via `start`/`limit`.
- `space`: dot notation (e.g. `Administration Hub.Finance`)
- `start`: zero-based offset (default 0)
- `limit`: max results (default 20)

#### `get_page`
Get full page content including syntax, author, version, and parent.
- `space`: space name
- `page`: page name (e.g. `WebHome`)

#### `get_page_children`
Get immediate children of a page.

#### `search`
Full-text search across the wiki.
- `query`: search terms
- `scope`: `content` | `title` | `name`
- `space`: optional space to limit search

#### `create_page`
Create a new page with title, content, and optional parent/syntax.

#### `update_page`
Update an existing page's title, content, or syntax. Fetches current page first to preserve unspecified fields.

#### `delete_page`
Permanently delete a page.

#### `add_comment`
Add a comment to a page. Supports `reply_to` for threaded comments.

#### `get_comments`
Get all comments on a page.

### Attachment Tools

#### `get_attachments`
List all attachments on a page with name, size, MIME type, and download URL.

#### `upload_attachment`
Upload a file to a page. Content must be base64-encoded.
- `filename`: name including extension
- `content_base64`: base64 file bytes
- `mime_type`: e.g. `image/png`, `application/pdf`

#### `download_attachment`
Download a file from a page. Returns base64-encoded content + MIME type + size.

#### `delete_attachment`
Delete an attachment from a page.

### Tag Tools

#### `get_tags`
Get all tags on a page.

#### `add_tags`
Add tags to a page. Additive — preserves existing tags, no duplicates.
- `tags`: array of tag name strings

### Class Tools (XObject Schema)

#### `list_classes`
List all XWiki classes defined in the wiki (paginated).

#### `get_class`
Get full class definition including all property names and types.
- Use this before `create_object` to know what properties are available.

### Object Tools (XObjects)

#### `list_objects`
List all XObjects on a page. Optionally filter by `class_name`.

#### `get_object`
Get a single object by class name and object number (0-based index).

#### `create_object`
Create a new XObject on a page.
- `class_name`: fully qualified class (e.g. `Administration Hub.Sales.Customer Profile.Code.ClientClass`)
- `properties`: key-value map of property names to values

#### `update_object`
Update properties of an existing object. Only specified properties are modified.

#### `delete_object`
Delete an object by class name and number.

### History & Query Tools (Phase 4)

#### `get_page_history`
Get the revision history of a page — versions, timestamps, authors, and edit comments.
- `space`: space name
- `page`: page name
- `limit`: max entries (default 20)

#### `get_page_version`
Retrieve the full content of a page at a specific historical version.
- `version`: version string, e.g. `3.1` or `1.1` (use `get_page_history` to find available versions)

#### `advanced_search`
Run a structured HQL, XWQL, or Solr query against the wiki.
- `query`: For `hql`/`xwql`: the WHERE clause only (e.g. `where doc.space = 'Main'`). For `solr`: full Solr expression.
- `type`: `hql` | `xwql` (default) | `solr`
- `limit`: max results (default 20)
- `start`: pagination offset (default 0)

#### `render_page`
Render a wiki page through the xWiki rendering engine to plain text or HTML. Especially useful for pages with macros.
- `output`: `plain` (default) | `html`

#### `get_recent_changes`
Get the most recent page modifications across the entire wiki. Useful for activity monitoring and change audits.
- `limit`: number of changes (default 20)

---

## Development

```bash
git clone https://github.com/jtmeunier87/xwiki-mcp
cd xwiki-mcp
npm install
npm run build
npm test   # 53 tests
```

### Running Locally

```bash
XWIKI_BASE_URL=https://your-wiki.com \
XWIKI_USERNAME=YourUser \
XWIKI_PASSWORD=YourPassword \
node dist/index.js
```

---

## Roadmap

- [x] Phase 1: Core write operations (create/update/delete page, comments)
- [x] Phase 1.5: Docker secrets management, live validation
- [x] Phase 2: Attachments (upload/download/delete), tags
- [x] Phase 3: XObject CRUD, class listing
- [x] Phase 4: Page history, advanced search (HQL/XWQL/Solr), render_page, recent changes, HTTP/SSE transport

---

## License

MIT — see [LICENSE](./LICENSE)

Original work by [vitos73](https://github.com/vitos73/xwiki-mcp). Extensions by [jtmeunier87](https://github.com/jtmeunier87).
