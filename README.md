# xwiki-mcp

A Model Context Protocol (MCP) server for [XWiki](https://www.xwiki.org/), giving AI agents full read/write access to an XWiki instance via its REST API.

**Fork of [vitos73/xwiki-mcp](https://github.com/vitos73/xwiki-mcp)** — extended to cover writes, attachments, tags, XObject CRUD, page history and rollback, advanced queries, rendering, Streamable HTTP transport, wiki-wide tag and page navigation, PDF export, and single-property object reads.

All tool names start with `xwiki_` so they do not clash with other MCP servers. Write and delete tools can be switched off (see [Access modes](#access-modes)).

---

## 37 tools across 7 categories

| Category | Count | Tools |
|---|---|---|
| **Pages (Read)** | 6 | `xwiki_list_spaces`, `xwiki_list_pages`, `xwiki_get_page`, `xwiki_get_page_children`, `xwiki_get_page_tree`, `xwiki_search` |
| **Pages (Write) & Comments** | 5 | `xwiki_create_page`, `xwiki_update_page`, `xwiki_delete_page`, `xwiki_add_comment`, `xwiki_get_comments` |
| **Attachments** | 4 | `xwiki_get_attachments`, `xwiki_upload_attachment`, `xwiki_download_attachment`, `xwiki_delete_attachment` |
| **Tags** | 2 | `xwiki_get_tags`, `xwiki_add_tags` |
| **Classes & Objects** | 9 | `xwiki_list_classes`, `xwiki_get_class`, `xwiki_update_class_properties`, `xwiki_add_class_property`, `xwiki_list_objects`, `xwiki_get_object`, `xwiki_create_object`, `xwiki_update_object`, `xwiki_delete_object` |
| **History & Query** | 6 | `xwiki_get_page_history`, `xwiki_get_page_version`, `xwiki_rollback_page`, `xwiki_advanced_search`, `xwiki_render_page`, `xwiki_get_recent_changes` |
| **Wiki-Level** | 5 | `xwiki_get_all_wiki_tags`, `xwiki_get_pages_by_tag`, `xwiki_find_pages`, `xwiki_export_page`, `xwiki_get_object_property` |

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

### HTTP server mode (Streamable HTTP)

Set `XWIKI_MCP_PORT` to run as a stateless Streamable HTTP server (multi-client):

```bash
XWIKI_MCP_PORT=3001 \
XWIKI_BASE_URL=https://your-wiki.com \
XWIKI_USERNAME=YourUser \
XWIKI_PASSWORD=YourPassword \
node dist/index.js
```

Endpoints: `POST /mcp` (MCP), `GET /health` (version, enabled tool count, access mode).

**The HTTP mode has no authentication of its own.** Anyone who can reach the port can use every enabled tool with the configured xWiki account. Bind it to localhost or a private network, or put it behind an authenticating proxy (an access gateway, a reverse proxy with auth, or similar). Use the access-mode flags below to limit what a reachable server can do.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XWIKI_BASE_URL` | Yes | — | Base URL (e.g. `https://wiki.example.com`) |
| `XWIKI_AUTH_TYPE` | No | `basic` | `basic` or `token` |
| `XWIKI_USERNAME` | If basic | — | xWiki username |
| `XWIKI_PASSWORD` | If basic | — | xWiki password |
| `XWIKI_TOKEN` | If token | — | Bearer token (requires xWiki 15.4+) |
| `XWIKI_WIKI_NAME` | No | `xwiki` | Wiki name |
| `XWIKI_REST_PATH` | No | `/rest` | REST path |
| `XWIKI_PAGE_LIMIT` | No | `50` | Default page size |
| `XWIKI_MCP_PORT` | No | — | Set to enable Streamable HTTP mode |
| `XWIKI_MCP_READ_ONLY` | No | `false` | `true` registers only read tools |
| `XWIKI_MCP_ALLOW_DELETE` | No | `false` | `true` also registers the delete tools |

### Access modes

Tools a mode leaves out are not registered, so clients never see them. The xWiki account's own rights still apply on top.

| Mode | Settings | Tools |
|---|---|---|
| Read/write, no delete (default) | — | 34: everything except `xwiki_delete_page`, `xwiki_delete_object`, `xwiki_delete_attachment` |
| Read/write/delete | `XWIKI_MCP_ALLOW_DELETE=true` | All 37 |
| Read-only | `XWIKI_MCP_READ_ONLY=true` (overrides `XWIKI_MCP_ALLOW_DELETE`) | 24 read tools |

Write tools: `xwiki_create_page`, `xwiki_update_page`, `xwiki_add_comment`, `xwiki_upload_attachment`, `xwiki_add_tags`, `xwiki_create_object`, `xwiki_update_object`, `xwiki_update_class_properties`, `xwiki_add_class_property`, `xwiki_rollback_page`.

> **Changed in 0.10.0:** delete tools are off unless `XWIKI_MCP_ALLOW_DELETE=true`.

---

## Tool Reference

### Page Read Tools

#### `xwiki_list_spaces`
List all spaces in the wiki.

#### `xwiki_list_pages`
List pages in a space with pagination (`start`, `limit`). Space names use dot notation for nested spaces.

#### `xwiki_get_page`
Get full page content, syntax, author, version, and parent link.

#### `xwiki_get_page_children`
Get immediate child pages of a given page.

#### `xwiki_get_page_tree`
Report the whole page tree under a root page in one call. Each descendant comes back with its reference, title, level (1 = direct child), parent, direct child count, URL and the object classes attached to it with a count per class; `class_totals` counts the pages carrying each class. Rows are depth-first. `hierarchy` is `parentchild` (the page's parent field, xWiki's REST default) or `nestedpages` (page/space nesting). `max_depth` (default 50) and `max_pages` (default 500, `truncated: true` when reached) bound the walk; `include_objects: false` skips the class listing. Costs one REST request per page for children plus one per page for objects, a few in parallel.

#### `xwiki_search`
Full-text search across the wiki. Supports `content`, `title`, or `name` scope with optional space filter.

### Page Write Tools

#### `xwiki_create_page`
Create a new page with title, content, optional parent, and optional syntax.

#### `xwiki_update_page`
Update an existing page. Fetches current version first to preserve fields not specified.

#### `xwiki_delete_page`
Permanently delete a page. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

#### `xwiki_add_comment`
Add a comment to a page. Supports threaded replies via `reply_to`.

#### `xwiki_get_comments`
List all comments on a page.

### Attachment Tools

#### `xwiki_get_attachments`
List attachments on a page with name, size, MIME type, and download URL.

#### `xwiki_upload_attachment`
Upload a file (base64-encoded) to a page.

#### `xwiki_download_attachment`
Download a file — returns base64 content, MIME type, and size.

#### `xwiki_delete_attachment`
Delete an attachment from a page. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### Tag Tools

#### `xwiki_get_tags`
Get tags on a specific page.

#### `xwiki_add_tags`
Add tags to a page (additive — preserves existing tags, no duplicates).

### Class & Object Tools

#### `xwiki_list_classes`
List all XWiki classes defined in the wiki.

#### `xwiki_get_class`
Get a class definition: each property's name, type and non-empty attributes (`prettyName`, and for StaticList properties the allowed `values` and `multiSelect`). Use before `xwiki_create_object` to know which fields and values a class accepts.

#### `xwiki_update_class_properties`
Change attributes of existing class properties, e.g. `{"status": {"hint": "Current state"}}` or a StaticList's `values`. Only the attributes given change, and the class is read back to confirm. Renaming a property is refused, because xWiki would rewrite every object of the class. xWiki has no REST endpoint for editing classes, so this posts the class editor's `/bin/propupdate/` action with the CSRF token (`{property}_{attribute}=value` fields). The account needs edit rights on the class page.

#### `xwiki_add_class_property`
Add a property to a class by type name (`String`, `TextArea`, `Number`, `Boolean`, `Date`, `StaticList`, `DBList`, `Page`, `Users`, …), with optional attributes such as `prettyName` and `hint`. Uses the `/bin/propadd/` action, then reads the class back. There is no delete or rename tool for class properties: those change existing objects.

#### `xwiki_list_objects`
List all XObjects on a page. Optionally filter by `class_name`.

#### `xwiki_get_object`
Get a single object by class name and object number (0-based).

#### `xwiki_create_object`
Create a new XObject on a page with class name and property key-value map.

#### `xwiki_update_object`
Update properties of an existing object. Only specified properties are changed.

#### `xwiki_delete_object`
Delete an object by class name and number. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### History & Query Tools

#### `xwiki_get_page_history`
List all revisions of a page — version string, timestamp, author, edit comment.

#### `xwiki_get_page_version`
Retrieve full page content at a specific historical version (e.g. `3.1`).

#### `xwiki_rollback_page`
Roll a page back to an earlier version (content and objects). xWiki saves the old version as a new version, so history is kept. Uses the `/bin/rollback/` action URL with the CSRF token.

#### `xwiki_advanced_search`
Run HQL, XWQL, or Solr queries against the wiki. For HQL/XWQL supply only the WHERE clause — xWiki prepends the SELECT. Example: `where doc.space = 'Main' order by doc.date desc`.

#### `xwiki_render_page`
Render a page through the xWiki macro engine to plain text or HTML. Useful for pages with macros, velocity, or include blocks. Uses the action URL (`/bin/get/`) — not the REST API.

#### `xwiki_get_recent_changes`
Get the most recent modifications across the entire wiki.

### Wiki-Level Tools

#### `xwiki_get_all_wiki_tags`
List every tag used anywhere in the wiki. Use this before `xwiki_get_pages_by_tag` to discover available tags.

#### `xwiki_get_pages_by_tag`
Get all pages that have a specific tag (e.g. `howto`).

#### `xwiki_find_pages`
Find pages wiki-wide by name, space, and/or author — without needing to know the exact space. Deduplicates results automatically. At least one filter required.

#### `xwiki_export_page`
Export a page as a PDF file. Returns base64-encoded PDF content, content type, and size. Requires the xWiki PDF export extension.

#### `xwiki_get_object_property`
Read a single named property from an XObject — more efficient than `xwiki_get_object` when only one field is needed. Useful for status checks and conditional logic.

---

## Implementation Notes

- **CSRF tokens**: Cached from GET response headers (`XWiki-Form-Token`), auto-refreshed on 403. Required for xWiki 14.10.8+.
- **Write bodies**: Page writes use `application/xml` bodies; object properties are sent as a form body (`property#name=value`), which is what xWiki actually saves.
- **Nested spaces**: Dot notation (`Space.SubSpace`) converts to xWiki's `/spaces/X/spaces/Y/` URL format.
- **xWiki API typo**: Classes endpoint returns `clazzs` (not `classes`) — handled transparently.
- **History timestamps**: History endpoints return Unix milliseconds — automatically converted to ISO strings.
- **Modifier prefix**: `xwiki:XWiki.` prefix stripped from all user references in display output.
- **Render URL**: `xwiki_render_page` and `xwiki_export_page` use `/bin/get/` and `/bin/export/` action URLs, not the REST API.
- **`xwiki_get_object_property`**: Single-property endpoint returns the property at root level (not in a `properties` array) — confirmed against xWiki 18.x.
- **`xwiki_find_pages`**: The wiki-wide pages endpoint can return duplicates — automatically deduplicated by `fullName`.

---

## Development

```bash
git clone https://github.com/jtmeunier87/xwiki-mcp
cd xwiki-mcp
npm install
npm run build
npm test        # 86 unit tests (mocked fetch)
```

---

## Roadmap

- [x] Phase 1 (v0.2.0) — Core write ops: create/update/delete page, comments
- [x] Phase 1.5 (v0.2.1) — Docker secrets, live validation
- [x] Phase 2+3 (v0.3.0) — Attachments, tags, XObject CRUD, class listing
- [x] Phase 4 (v0.4.0) — Page history, advanced search (HQL/XWQL/Solr), render_page, recent changes, HTTP/SSE transport
- [x] Phase 5 (v0.5.0) — Wiki tags, tag-based navigation, wiki-wide page finder, PDF export, single-property reads
- [x] v0.6.0–v0.9.0 — Streamable HTTP transport, `xwiki_` tool prefix, Docker image, object write fix, page rollback
- [x] v0.10.0 — Read-only / no-delete access modes, class property attributes in `xwiki_get_class`
- [x] v0.11.0 — Class editing: `xwiki_update_class_properties`, `xwiki_add_class_property`
- [x] v0.12.0 — Page tree report: `xwiki_get_page_tree`
- [x] v0.12.1 — Docker build runs npm natively (fixes the arm64 build crash)
- [ ] Future — Translation management, attachment versioning, jobs API (when genuinely needed)

---

## License

MIT — see [LICENSE](./LICENSE)

Original work by [vitos73](https://github.com/vitos73/xwiki-mcp). Extended by [jtmeunier87](https://github.com/jtmeunier87).
