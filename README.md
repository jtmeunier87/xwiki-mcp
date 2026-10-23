# xwiki-mcp

A Model Context Protocol (MCP) server for [XWiki](https://www.xwiki.org/), giving AI agents full read/write access to an XWiki instance via its REST API.

**Fork of [vitos73/xwiki-mcp](https://github.com/vitos73/xwiki-mcp)** — extended to cover writes, attachments, tags, XObject CRUD, page history and rollback, advanced queries, rendering, Streamable HTTP transport, wiki-wide tag and page navigation, PDF export, and single-property object reads.

All tool names start with `xwiki_` so they do not clash with other MCP servers. Write and delete tools can be switched off (see [Access modes](#access-modes)).

---

## 52 tools across 11 categories

| Category | Count | Tools |
|---|---|---|
| **Pages (Read)** | 7 | `xwiki_list_spaces`, `xwiki_list_pages`, `xwiki_get_page`, `xwiki_list_page_children`, `xwiki_get_page_tree`, `xwiki_find_pages`, `xwiki_get_required_rights` |
| **Pages (Write)** | 5 | `xwiki_create_page`, `xwiki_update_page`, `xwiki_move_page`, `xwiki_copy_page`, `xwiki_delete_page` |
| **Recycle Bin** | 2 | `xwiki_list_deleted_pages`, `xwiki_restore_deleted_page` |
| **Comments** | 4 | `xwiki_list_comments`, `xwiki_add_comment`, `xwiki_update_comment`, `xwiki_delete_comment` |
| **Attachments** | 7 | `xwiki_list_attachments`, `xwiki_search_attachments`, `xwiki_list_attachment_versions`, `xwiki_upload_attachment`, `xwiki_download_attachment`, `xwiki_move_attachment`, `xwiki_delete_attachment` |
| **Tags** | 5 | `xwiki_get_page_tags`, `xwiki_add_tags`, `xwiki_remove_tags`, `xwiki_list_tags`, `xwiki_list_pages_by_tag` |
| **Classes** | 6 | `xwiki_list_classes`, `xwiki_get_class`, `xwiki_list_class_property_values`, `xwiki_update_class_properties`, `xwiki_add_class_property`, `xwiki_set_class_property_enabled` |
| **Objects** | 7 | `xwiki_list_page_objects`, `xwiki_get_object`, `xwiki_get_object_property`, `xwiki_list_class_objects`, `xwiki_create_object`, `xwiki_update_object`, `xwiki_delete_object` |
| **History** | 5 | `xwiki_list_page_versions`, `xwiki_get_page_version`, `xwiki_compare_page_versions`, `xwiki_rollback_page`, `xwiki_list_recent_changes` |
| **Search & Query** | 2 | `xwiki_search_pages`, `xwiki_query` |
| **Render & Export** | 2 | `xwiki_render_page`, `xwiki_export_page` |

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

**Protect the HTTP mode.** Without `XWIKI_MCP_HTTP_TOKEN`, anyone who can reach the port can use every enabled tool with the configured xWiki account. Put it behind an authenticating proxy (an access gateway, a reverse proxy with auth, or similar) or on a private network, and use `XWIKI_MCP_HOST=127.0.0.1` when only local clients need it. `XWIKI_MCP_HTTP_TOKEN` adds a shared bearer token that `POST /mcp` requires (`Authorization: Bearer <token>`; `GET /health` stays open); treat it as a second lock, not a replacement for the proxy. Use the access-mode settings below to limit what a reachable server can do.

Against DNS rebinding, a request that carries an `Origin` header (browsers send one) is refused with 403 unless the origin is listed in `XWIKI_MCP_ALLOWED_ORIGINS`; set `XWIKI_MCP_ALLOWED_HOSTS` to also require a known `Host` header. Non-browser MCP clients send no `Origin` and are unaffected. `GET` and `DELETE` on `/mcp` return 405: the server is stateless, with no standalone event stream and no sessions.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `XWIKI_BASE_URL` | Yes | — | Base URL (e.g. `https://wiki.example.com`) |
| `XWIKI_AUTH_TYPE` | No | `basic` | `basic`, `token` or `none` |
| `XWIKI_USERNAME` | If basic | — | xWiki username |
| `XWIKI_PASSWORD` | If basic | — | xWiki password (or `XWIKI_PASSWORD_FILE`: a file holding it, for Docker / Kubernetes secrets) |
| `XWIKI_TOKEN` | If token | — | Bearer token (requires xWiki 15.4+; or `XWIKI_TOKEN_FILE`) |
| `XWIKI_WIKI_NAME` | No | `xwiki` | Wiki name |
| `XWIKI_REST_PATH` | No | `/rest` | REST path |
| `XWIKI_PAGE_LIMIT` | No | `50` | Default page size |
| `XWIKI_TIMEOUT_MS` | No | `30000` | Timeout for one xWiki request; writes, downloads, exports and refactoring jobs get 4× this |
| `XWIKI_MCP_PORT` | No | — | Set to enable Streamable HTTP mode |
| `XWIKI_MCP_HOST` | No | all interfaces | HTTP mode: interface to listen on, e.g. `127.0.0.1` |
| `XWIKI_MCP_HTTP_TOKEN` | No | — | HTTP mode: bearer token required on `POST /mcp` (or `XWIKI_MCP_HTTP_TOKEN_FILE`) |
| `XWIKI_MCP_ALLOWED_ORIGINS` | No | — | HTTP mode: comma-separated origins allowed on requests that send `Origin`; any other origin gets 403 |
| `XWIKI_MCP_ALLOWED_HOSTS` | No | any | HTTP mode: comma-separated `Host` header values to accept, e.g. `mcp.example.com,localhost:3001` |
| `XWIKI_MCP_READ_ONLY` | No | `false` | `true` registers only read tools |
| `XWIKI_MCP_ALLOW_DELETE` | No | `false` | `true` also registers the delete tools |
| `XWIKI_MCP_TOOLSETS` | No | all | Comma-separated toolsets to register: `pages`, `recycle_bin`, `comments`, `attachments`, `tags`, `classes`, `objects`, `history`, `search`, `export`. An unknown name stops the server at startup |
| `XWIKI_MCP_RATE_LIMIT` | No | `120` | Tool calls allowed per minute across all clients; over it a call returns a tool error. `0` turns the limit off |
| `XWIKI_MCP_MAX_FILE_BYTES` | No | `10485760` | Largest file `xwiki_download_attachment` / `xwiki_export_page` return (10 MB); larger files are refused with their URL |
| `XWIKI_MCP_LOG_CALLS` | No | `true` | One JSON line per tool call on stderr: time, tool, ok, ms (no arguments or results) |
| `XWIKI_MCP_DISABLED_TOOLS` | No | — | Comma-separated tool names to leave unregistered, e.g. `xwiki_move_page,xwiki_update_class_properties`. An unknown name stops the server at startup |

### Access modes

Tools a mode leaves out are not registered, so clients never see them. The xWiki account's own rights still apply on top.

| Mode | Settings | Tools |
|---|---|---|
| Read/write, no delete (default) | — | 48: everything except `xwiki_delete_page`, `xwiki_delete_object`, `xwiki_delete_attachment`, `xwiki_delete_comment` |
| Read/write/delete | `XWIKI_MCP_ALLOW_DELETE=true` | All 52 |
| Read-only | `XWIKI_MCP_READ_ONLY=true` (overrides `XWIKI_MCP_ALLOW_DELETE`) | 31 read tools |

Write tools: `xwiki_create_page`, `xwiki_update_page`, `xwiki_move_page`, `xwiki_copy_page`, `xwiki_restore_deleted_page`, `xwiki_add_comment`, `xwiki_update_comment`, `xwiki_upload_attachment`, `xwiki_move_attachment`, `xwiki_add_tags`, `xwiki_remove_tags`, `xwiki_set_class_property_enabled`, `xwiki_create_object`, `xwiki_update_object`, `xwiki_update_class_properties`, `xwiki_add_class_property`, `xwiki_rollback_page`.

`XWIKI_MCP_TOOLSETS` and `XWIKI_MCP_DISABLED_TOOLS` remove further tools from whichever mode is set; they never add any. Fewer tools help a model pick the right one, so register only the toolsets a deployment needs.

Every tool carries MCP annotations, so clients can tell reads from writes: read tools are `readOnlyHint: true`; writes that only add (comments, tags, new objects, copy, restore) are `destructiveHint: false`; every other write and every delete is `destructiveHint: true`, with `idempotentHint` where repeating the call changes nothing more.

> **Changed in 0.15.0:** 14 tools were renamed for consistency (see Roadmap); the old names are gone.

> **Changed in 0.10.0:** delete tools are off unless `XWIKI_MCP_ALLOW_DELETE=true`.

---

## Tool Reference

### Pages (Read)

#### `xwiki_list_spaces`
List all spaces in the wiki.

#### `xwiki_list_pages`
List pages in a space with pagination (`start`, `limit`). Space names use dot notation for nested spaces.

#### `xwiki_get_page`
Get page content, title, syntax, author, version and parent. Long content comes in windows of `max_chars` (default 40,000 characters, about 10k tokens): when `content_truncated` is true, call again with `offset` = `next_offset`.

#### `xwiki_list_page_children`
Get immediate child pages of a given page.

#### `xwiki_get_page_tree`
Report the whole page tree under a root page in one call. Each descendant comes back with its reference, title, level (1 = direct child), parent, direct child count, URL and the object classes attached to it with a count per class; `class_totals` counts the pages carrying each class. Rows are depth-first. `hierarchy` is `parentchild` (the page's parent field, xWiki's REST default) or `nestedpages` (page/space nesting). `max_depth` (default 50) and `max_pages` (default 500, `truncated: true` when reached) bound the walk; `include_objects: false` skips the class listing. Costs one REST request per page for children plus one per page for objects, a few in parallel.

#### `xwiki_find_pages`
Find pages wiki-wide by name, space, and/or author — without needing to know the exact space. Deduplicates results automatically. At least one filter required.

#### `xwiki_get_required_rights`
Analyse which rights a page's content needs (script or programming right for Velocity/Groovy, admin right for some macros) and compare them with the rights the page declares. Returns `declared`, `needed` (with whether the MCP account has each right) and plain-text `findings`. xWiki 17.4+; needs edit right on the page.

### Pages (Write)

#### `xwiki_create_page`
Create a new page with title, content, optional parent, and optional syntax.

#### `xwiki_update_page`
Update an existing page. Fetches current version first to preserve fields not specified.

#### `xwiki_move_page`
Move or rename a page, as the wiki's Rename action does: history, objects, attachments and comments go with it. The target is given as its final reference (`Docs.Manuals` + `WebHome` for a nested page, `Docs.Guides` + `Install` for a terminal one). `children` (default true) moves child pages, `update_links` (default true) rewrites links across the wiki, `auto_redirect` (default false) leaves a redirect at the old reference, `new_title` sets a new title. Fails if the target exists. Needs delete right on the source and edit right on the target. A write tool: it removes nothing but the page no longer exists at its old reference.

#### `xwiki_copy_page`
Copy a page to a new reference, as the wiki's Copy action does; the original is unchanged. Same target form as `xwiki_move_page` (`Docs.Manuals` + `WebHome` for a nested page, `Docs.Guides` + `SetupCopy` for a terminal one). `children` (default true) copies child pages of a nested page; `new_title` sets the copy's title. Fails if the target exists. Needs view right on the source and edit right on the target.

#### `xwiki_delete_page`
Permanently delete a page. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### Recycle Bin

#### `xwiki_list_deleted_pages`
List the recycle bin, newest first: each entry's recycle-bin `id`, page, title, deleter, date, batch id and whether it can be restored. `name` filters by part of the page reference. xWiki has no REST endpoint for the recycle bin; this reads `XWiki.DeletedDocumentsJSON`, the service page behind the wiki's Deleted Documents view.

#### `xwiki_restore_deleted_page`
Restore a page from the recycle bin by its `id` from `xwiki_list_deleted_pages`, using the `/bin/undelete/` action. Restores that one entry, not the rest of its batch. Refused if a page exists at that reference again. Needs the right to restore it (usually the deleter or an admin).

### Comments

#### `xwiki_list_comments`
List all comments on a page.

#### `xwiki_add_comment`
Add a comment to a page. Supports threaded replies via `reply_to`.

#### `xwiki_update_comment`
Edit a comment's text (its `XWiki.XWikiComments` object). The comment's author and date stay; it is read back to confirm.

#### `xwiki_delete_comment`
Permanently delete a comment; replies to it are kept. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### Attachments

#### `xwiki_list_attachments`
List attachments on a page with name, size, MIME type, and download URL.

#### `xwiki_search_attachments`
Find attachments across the wiki, or within one space and its subspaces. Filters match part of the value: `name`, `page`, `author`; `types` is a comma-separated list of media types or parts (`image`, `application/pdf`). Paged with `start` / `limit` (default 25).

#### `xwiki_list_attachment_versions`
List the versions of one attachment with size, media type, author, date and a download URL per version.

#### `xwiki_upload_attachment`
Upload a file (base64-encoded) to a page.

#### `xwiki_download_attachment`
Download an attachment. PNG, JPEG, GIF and WebP images up to 5 MB come back as MCP image content (the model can see them) plus a text block with name, type and size; other files as an MCP embedded resource (a binary blob, not base64 text in the model's context), with the file's URL. Files over `XWIKI_MCP_MAX_FILE_BYTES` are refused with the URL to open instead.

#### `xwiki_move_attachment`
Move or rename an attachment, on the same page or to another page, using the attachment Move form (`?xpage=attachment/move`). It starts a background job; the tool polls it until it finishes and reads the target back. `update_references` (default true) rewrites links and images to it; `auto_redirect` (default false) leaves a redirect. Needs edit right on both pages.

#### `xwiki_delete_attachment`
Delete an attachment from a page. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### Tags

#### `xwiki_get_page_tags`
Get tags on a specific page.

#### `xwiki_add_tags`
Add tags to a page (additive — preserves existing tags, no duplicates).

#### `xwiki_remove_tags`
Remove tags from a page, keeping the others. Returns the tags removed, any that were not on the page, and the remaining tags.

#### `xwiki_list_tags`
List every tag used anywhere in the wiki. Use this before `xwiki_list_pages_by_tag` to discover available tags.

#### `xwiki_list_pages_by_tag`
Get all pages that have a specific tag (e.g. `howto`).

### Classes

#### `xwiki_list_classes`
List all XWiki classes defined in the wiki.

#### `xwiki_get_class`
Get a class definition: each property's name, type and non-empty attributes (`prettyName`, and for StaticList properties the allowed `values` and `multiSelect`). Use before `xwiki_create_object` to know which fields and values a class accepts.

#### `xwiki_list_class_property_values`
List the allowed values of a property whose values come from elsewhere (DBList, DBTreeList, page, user or group pickers), with labels; `filter` narrows them. StaticList values are in `xwiki_get_class`.

#### `xwiki_update_class_properties`
Change attributes of existing class properties, e.g. `{"status": {"hint": "Current state"}}` or a StaticList's `values`. Only the attributes given change, and the class is read back to confirm. Renaming a property is refused, because xWiki would rewrite every object of the class. xWiki has no REST endpoint for editing classes, so this posts the class editor's `/bin/propupdate/` action with the CSRF token (`{property}_{attribute}=value` fields). The account needs edit rights on the class page.

#### `xwiki_add_class_property`
Add a property to a class by type name (`String`, `TextArea`, `Number`, `Boolean`, `Date`, `StaticList`, `DBList`, `Page`, `Users`, …), with optional attributes such as `prettyName` and `hint`. Uses the `/bin/propadd/` action, then reads the class back. There is no delete or rename tool for class properties: those change existing objects.

#### `xwiki_set_class_property_enabled`
Disable or enable a class property (`/bin/propdisable/`, `/bin/propenable/`). A disabled property is hidden from the object editor and new objects but keeps its values, so it is a reversible alternative to deleting a field. Needs edit right on the class page.

### Objects

#### `xwiki_list_page_objects`
List all XObjects on a page. Optionally filter by `class_name`.

#### `xwiki_get_object`
Get a single object by class name and object number (0-based).

#### `xwiki_get_object_property`
Read a single named property from an XObject — more efficient than `xwiki_get_object` when only one field is needed. Useful for status checks and conditional logic.

#### `xwiki_list_class_objects`
List the objects of one class across the whole wiki with the page each one is on, ordered by page (or by page date with `order: "date"`). `include_properties` (default true) adds every property value, one request per object. Paged with `start` / `limit` (default 50); pages the account cannot view are left out, so keep paging while `has_more` is true.

#### `xwiki_create_object`
Create a new XObject on a page with class name and property key-value map.

#### `xwiki_update_object`
Update properties of an existing object. Only specified properties are changed.

#### `xwiki_delete_object`
Delete an object by class name and number. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### History

#### `xwiki_list_page_versions`
List all revisions of a page — version string, timestamp, author, edit comment.

#### `xwiki_get_page_version`
Retrieve full page content at a specific historical version (e.g. `3.1`).

#### `xwiki_compare_page_versions`
Compare two versions of a page (or one version with the current page): a unified diff of the content, lines added and removed, and any title or syntax change, with each version's author and date. The diff is computed by the server; xWiki's REST API has none.

#### `xwiki_rollback_page`
Roll a page back to an earlier version (content and objects). xWiki saves the old version as a new version, so history is kept. Uses the `/bin/rollback/` action URL with the CSRF token.

#### `xwiki_list_recent_changes`
Get the most recent modifications across the entire wiki.

### Search & Query

#### `xwiki_search_pages`
Full-text search across the wiki. Supports `content`, `title`, or `name` scope with optional space filter.

#### `xwiki_query`
Run HQL, XWQL, or Solr queries against the wiki. For HQL/XWQL supply only the WHERE clause — xWiki prepends the SELECT. Example: `where doc.space = 'Main' order by doc.date desc`.

### Render & Export

#### `xwiki_render_page`
Render a page through the xWiki macro engine to plain text or HTML. Useful for pages with macros, velocity, or include blocks. Uses the action URL (`/bin/get/`) — not the REST API.

#### `xwiki_export_page`
Export a page as a file, returned as an MCP embedded resource (binary) with name, type, size and URL; over `XWIKI_MCP_MAX_FILE_BYTES` it is refused. `format`: `pdf` (default, needs the PDF export extension), `xar` (a wiki package with objects and attachments that can be imported elsewhere; needs wiki admin rights; `history: true` includes page history) or `html` (a zip of the rendered page as static HTML). For `xar` and `html`, `children: true` adds every page under a nested page.

---

## Implementation Notes

- **CSRF tokens**: Cached from GET response headers (`XWiki-Form-Token`), auto-refreshed on 403. Required for xWiki 14.10.8+.
- **Write bodies**: Page writes use `application/xml` bodies; object properties are sent as a form body (`property#name=value`), which is what xWiki actually saves.
- **Nested spaces**: Dot notation (`Space.SubSpace`) converts to xWiki's `/spaces/X/spaces/Y/` URL format.
- **xWiki API typo**: Classes endpoint returns `clazzs` (not `classes`) — handled transparently.
- **History timestamps**: History endpoints return Unix milliseconds — automatically converted to ISO strings.
- **Modifier prefix**: `xwiki:XWiki.` prefix stripped from all user references in display output.
- **Render URL**: `xwiki_render_page` and `xwiki_export_page` use `/bin/get/` and `/bin/export/` action URLs, not the REST API.
- **Registration** (`src/registry.ts`): every tool gets a display `title` and annotations; each call is rate-limited (`XWIKI_MCP_RATE_LIMIT`), logged (`XWIKI_MCP_LOG_CALLS`), and any thrown exception becomes an `isError` result. A JSON object result is also returned as `structuredContent`.
- **Server instructions**: the server sends MCP `instructions` describing how the tools fit together (finding pages, paging, objects, version numbers, read-back after writes).
- **Output**: compact JSON (no indentation). List tools take `start` / `limit` and return `_pagination: { total, start, limit, has_more }`.
- **Refactoring forms**: `xwiki_copy_page` (`?xpage=copy`), `xwiki_move_attachment` (`?xpage=attachment/move`, a background job the tool polls) and `xwiki_restore_deleted_page` (`/bin/undelete/`) post the wiki's own forms with `form_token`, like move. `xwiki_list_deleted_pages` reads `XWiki.DeletedDocumentsJSON`.
- **Move**: `xwiki_move_page` posts the wiki's own rename form (`/bin/view/{page}?xpage=rename&step=2` with `form_token`), which runs the rename job and waits for it; the REST jobs API would need programming rights. The tool then reads the target back.
- **`xwiki_get_object_property`**: Single-property endpoint returns the property at root level (not in a `properties` array) — confirmed against xWiki 18.x.
- **`xwiki_find_pages`**: The wiki-wide pages endpoint can return duplicates — automatically deduplicated by `fullName`.

---

## Development

```bash
git clone https://github.com/jtmeunier87/xwiki-mcp
cd xwiki-mcp
npm install
npm run build
npm test        # 126 unit tests (mocked fetch)
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
- [x] v0.16.0 — Origin / Host checks and 405 in HTTP mode, rate limit, toolsets, call log, titles and server instructions, files as embedded resources with a size cap, paging on every list tool, page content windows, compact JSON, `structuredContent`, secrets from files, clean shutdown
- [x] v0.15.0 — Consistent tool names (breaking): `list_` for collections, `get_` for one item:
  - `xwiki_get_attachments` → `xwiki_list_attachments`
  - `xwiki_get_comments` → `xwiki_list_comments`
  - `xwiki_get_page_children` → `xwiki_list_page_children`
  - `xwiki_get_page_history` → `xwiki_list_page_versions`
  - `xwiki_get_attachment_history` → `xwiki_list_attachment_versions`
  - `xwiki_get_recent_changes` → `xwiki_list_recent_changes`
  - `xwiki_get_class_property_values` → `xwiki_list_class_property_values`
  - `xwiki_get_pages_by_tag` → `xwiki_list_pages_by_tag`
  - `xwiki_get_tags` → `xwiki_get_page_tags`
  - `xwiki_get_all_wiki_tags` → `xwiki_list_tags`
  - `xwiki_search` → `xwiki_search_pages`
  - `xwiki_advanced_search` → `xwiki_query`
  - `xwiki_list_objects` → `xwiki_list_page_objects`
  - `xwiki_restore_page` → `xwiki_restore_deleted_page`
- [x] v0.14.1 — Dependencies current (zod 4, TypeScript 7, Vitest 5); Docker image on Node 24 LTS; Node 22+ required
- [x] v0.14.0 — Tool annotations, `XWIKI_MCP_DISABLED_TOOLS`, `XWIKI_MCP_HTTP_TOKEN`, `XWIKI_MCP_HOST`, `XWIKI_TIMEOUT_MS`, images returned as images; copy page, recycle bin list/restore, property disable/enable and values, attachment move and history, version compare, comment edit/delete, XAR/HTML export
- [x] v0.13.0 — `xwiki_list_class_objects`, `xwiki_remove_tags`, `xwiki_search_attachments`, `xwiki_move_page`, `xwiki_get_required_rights`
- [ ] Future — Translation management, attachment versioning, jobs API (when genuinely needed)

---

## License

MIT — see [LICENSE](./LICENSE)

Original work by [vitos73](https://github.com/vitos73/xwiki-mcp). Extended by [jtmeunier87](https://github.com/jtmeunier87).
