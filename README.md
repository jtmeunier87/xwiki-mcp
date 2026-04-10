# xwiki-mcp

A Model Context Protocol (MCP) server for [XWiki](https://www.xwiki.org/), giving AI agents full read/write access to an XWiki instance via its REST API.

**Fork of [vitos73/xwiki-mcp](https://github.com/vitos73/xwiki-mcp)** — extended across 5 phases to cover writes, attachments, tags, XObject CRUD, page history, advanced queries, rendering, HTTP/SSE transport, wiki-wide tag and page navigation, PDF export, and single-property object reads.

---

## 33 Tools across 7 categories

| Category | Count | Tools |
|---|---|---|
| **Pages (Read)** | 5 | `list_spaces`, `list_pages`, `get_page`, `get_page_children`, `search` |
| **Pages (Write)** | 5 | `create_page`, `update_page`, `delete_page`, `add_comment`, `get_comments` |
| **Attachments** | 4 | `get_attachments`, `upload_attachment`, `download_attachment`, `delete_attachment` |
| **Tags** | 2 | `get_tags`, `add_tags` |
| **Classes & Objects** | 7 | `list_classes`, `get_class`, `list_objects`, `get_object`, `create_object`, `update_object`, `delete_object` |
| **History & Query** | 5 | `get_page_history`, `get_page_version`, `advanced_search`, `render_page`, `get_recent_changes` |
| **Wiki-Level** | 5 | `get_all_wiki_tags`, `get_pages_by_tag`, `find_pages`, `export_page`, `get_object_property` |

---

## Installation

### Cursor / Claude Desktop (stdio)

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

### HTTP/SSE server mode

Set `XWIKI_MCP_PORT` to run as an HTTP server with SSE transport (multi-client):

```bash
XWIKI_MCP_PORT=3001 \
XWIKI_BASE_URL=https://your-wiki.com \
XWIKI_USERNAME=YourUser \
XWIKI_PASSWORD=YourPassword \
node dist/index.js
```

Endpoints: `GET /sse` (connect), `POST /message` (send), `GET /health`

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XWIKI_BASE_URL` | Yes | — | Base URL (e.g. `https://wiki.example.com`) |
| `XWIKI_AUTH_TYPE` | No | `basic` | `basic` or `token` |
| `XWIKI_USERNAME` | If basic | — | xWiki username |
| `XWIKI_PASSWORD` | If basic | — | xWiki password |
| `XWIKI_TOKEN` | If token | — | Bearer token (requires xWiki 15.4+) |
| `XWIKI_WIKI_NAME` | No | `xwiki` | Wiki name |
| `XWIKI_MCP_PORT` | No | — | Set to enable HTTP/SSE mode |

---

## Tool Reference

### Page Read Tools

#### `list_spaces`
List all spaces in the wiki.

#### `list_pages`
List pages in a space with pagination (`start`, `limit`). Space names use dot notation for nested spaces.

#### `get_page`
Get full page content, syntax, author, version, and parent link.

#### `get_page_children`
Get immediate child pages of a given page.

#### `search`
Full-text search across the wiki. Supports `content`, `title`, or `name` scope with optional space filter.

### Page Write Tools

#### `create_page`
Create a new page with title, content, optional parent, and optional syntax.

#### `update_page`
Update an existing page. Fetches current version first to preserve fields not specified.

#### `delete_page`
Permanently delete a page.

#### `add_comment`
Add a comment to a page. Supports threaded replies via `reply_to`.

#### `get_comments`
List all comments on a page.

### Attachment Tools

#### `get_attachments`
List attachments on a page with name, size, MIME type, and download URL.

#### `upload_attachment`
Upload a file (base64-encoded) to a page.

#### `download_attachment`
Download a file — returns base64 content, MIME type, and size.

#### `delete_attachment`
Delete an attachment from a page.

### Tag Tools

#### `get_tags`
Get tags on a specific page.

#### `add_tags`
Add tags to a page (additive — preserves existing tags, no duplicates).

### Class & Object Tools

#### `list_classes`
List all XWiki classes defined in the wiki.

#### `get_class`
Get a class definition including all property names and types. Use before `create_object`.

#### `list_objects`
List all XObjects on a page. Optionally filter by `class_name`.

#### `get_object`
Get a single object by class name and object number (0-based).

#### `create_object`
Create a new XObject on a page with class name and property key-value map.

#### `update_object`
Update properties of an existing object. Only specified properties are changed.

#### `delete_object`
Delete an object by class name and number.

### History & Query Tools

#### `get_page_history`
List all revisions of a page — version string, timestamp, author, edit comment.

#### `get_page_version`
Retrieve full page content at a specific historical version (e.g. `3.1`).

#### `advanced_search`
Run HQL, XWQL, or Solr queries against the wiki. For HQL/XWQL supply only the WHERE clause — xWiki prepends the SELECT. Example: `where doc.space = 'Main' order by doc.date desc`.

#### `render_page`
Render a page through the xWiki macro engine to plain text or HTML. Useful for pages with macros, velocity, or include blocks. Uses the action URL (`/bin/get/`) — not the REST API.

#### `get_recent_changes`
Get the most recent modifications across the entire wiki.

### Wiki-Level Tools

#### `get_all_wiki_tags`
List every tag used anywhere in the wiki. Use this before `get_pages_by_tag` to discover available tags.

#### `get_pages_by_tag`
Get all pages that have a specific tag (e.g. `PM`, `AV`).

#### `find_pages`
Find pages wiki-wide by name, space, and/or author — without needing to know the exact space. Deduplicates results automatically. At least one filter required.

#### `export_page`
Export a page as a PDF file. Returns base64-encoded PDF content, content type, and size. Requires the xWiki PDF export extension.

#### `get_object_property`
Read a single named property from an XObject — more efficient than `get_object` when only one field is needed. Useful for status checks and conditional logic.

---

## Implementation Notes

- **CSRF tokens**: Cached from GET response headers (`XWiki-Form-Token`), auto-refreshed on 403. Required for xWiki 14.10.8+.
- **Write bodies**: All write operations use `application/xml` bodies (more reliable than JSON for xWiki REST mutations).
- **Nested spaces**: Dot notation (`Space.SubSpace`) converts to xWiki's `/spaces/X/spaces/Y/` URL format.
- **xWiki API typo**: Classes endpoint returns `clazzs` (not `classes`) — handled transparently.
- **History timestamps**: History endpoints return Unix milliseconds — automatically converted to ISO strings.
- **Modifier prefix**: `xwiki:XWiki.` prefix stripped from all user references in display output.
- **Render URL**: `render_page` and `export_page` use `/bin/get/` and `/bin/export/` action URLs, not the REST API.
- **`get_object_property`**: Single-property endpoint returns the property at root level (not in a `properties` array) — confirmed against xWiki 18.x.
- **`find_pages`**: The wiki-wide pages endpoint can return duplicates — automatically deduplicated by `fullName`.

---

## Development

```bash
git clone https://github.com/jtmeunier87/xwiki-mcp
cd xwiki-mcp
npm install
npm run build
npm test        # 74 tests, all phases
```

---

## Roadmap

- [x] Phase 1 (v0.2.0) — Core write ops: create/update/delete page, comments
- [x] Phase 1.5 (v0.2.1) — Docker secrets, live validation
- [x] Phase 2+3 (v0.3.0) — Attachments, tags, XObject CRUD, class listing
- [x] Phase 4 (v0.4.0) — Page history, advanced search (HQL/XWQL/Solr), render_page, recent changes, HTTP/SSE transport
- [x] Phase 5 (v0.5.0) — Wiki tags, tag-based navigation, wiki-wide page finder, PDF export, single-property reads
- [ ] Future — Translation management, attachment versioning, jobs API (when genuinely needed)

---

## License

MIT — see [LICENSE](./LICENSE)

Original work by [vitos73](https://github.com/vitos73/xwiki-mcp). Extended by [jtmeunier87](https://github.com/jtmeunier87).
