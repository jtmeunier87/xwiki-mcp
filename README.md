# xwiki-mcp

A Model Context Protocol (MCP) server for [XWiki](https://www.xwiki.org/), giving AI agents full read/write access to an XWiki instance via its REST API.

**Fork of [vitos73/xwiki-mcp](https://github.com/vitos73/xwiki-mcp)** — extended to cover writes, attachments, tags, XObject CRUD, page history and rollback, advanced queries, rendering, Streamable HTTP transport, wiki-wide tag and page navigation, PDF export, and single-property object reads.

Built on the MCP TypeScript SDK v2: it speaks protocol revision **2026-07-28** and still serves clients on 2025 revisions that open with `initialize`, over stdio and Streamable HTTP.

All tool names start with `xwiki_` so they do not clash with other MCP servers. Write and delete tools can be switched off (see [Access modes](#access-modes)).

---

## 55 tools across 11 categories

| Category | Count | Tools |
|---|---|---|
| **Pages (Read)** | 8 | `xwiki_list_spaces`, `xwiki_list_pages`, `xwiki_get_page`, `xwiki_list_page_children`, `xwiki_get_page_tree`, `xwiki_get_links`, `xwiki_find_pages`, `xwiki_get_required_rights` |
| **Pages (Write)** | 6 | `xwiki_create_page`, `xwiki_update_page`, `xwiki_replace_in_page`, `xwiki_move_page`, `xwiki_copy_page`, `xwiki_delete_page` |
| **Recycle Bin** | 2 | `xwiki_list_deleted_pages`, `xwiki_restore_deleted_page` |
| **Comments** | 4 | `xwiki_list_comments`, `xwiki_add_comment`, `xwiki_update_comment`, `xwiki_delete_comment` |
| **Attachments** | 7 | `xwiki_list_attachments`, `xwiki_search_attachments`, `xwiki_list_attachment_versions`, `xwiki_upload_attachment`, `xwiki_download_attachment`, `xwiki_move_attachment`, `xwiki_delete_attachment` |
| **Tags** | 5 | `xwiki_get_page_tags`, `xwiki_add_tags`, `xwiki_remove_tags`, `xwiki_list_tags`, `xwiki_list_pages_by_tag` |
| **Classes** | 6 | `xwiki_list_classes`, `xwiki_get_class`, `xwiki_list_class_property_values`, `xwiki_update_class_properties`, `xwiki_add_class_property`, `xwiki_set_class_property_enabled` |
| **Objects** | 8 | `xwiki_list_page_objects`, `xwiki_get_object`, `xwiki_get_object_property`, `xwiki_list_class_objects`, `xwiki_search_objects`, `xwiki_create_object`, `xwiki_update_object`, `xwiki_delete_object` |
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

### Docker

Images are published to `ghcr.io/jtmeunier87/xwiki-mcp` (linux/amd64 and linux/arm64, with build provenance and an SBOM). The image runs the server over stdio as a non-root user and also contains [supergateway](https://github.com/supercorp-ai/supergateway) (pinned) to serve it over Streamable HTTP:

```yaml
services:
  xwiki-mcp:
    image: ghcr.io/jtmeunier87/xwiki-mcp:0.22.0
    entrypoint: ["supergateway", "--stdio", "node dist/index.js", "--outputTransport", "streamableHttp",
                 "--port", "8000", "--healthEndpoint", "/healthz"]
    environment:
      XWIKI_BASE_URL: https://wiki.example.com
      XWIKI_USERNAME: mcp-agent
      XWIKI_PASSWORD_FILE: /run/secrets/xwiki_password
    secrets: [xwiki_password]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
secrets:
  xwiki_password:
    file: ./xwiki_password.txt
```

Or set `XWIKI_MCP_PORT` and use the built-in HTTP mode, whose `GET /health` serves the same purpose.

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
| Read/write, no delete (default) | — | 50: everything except `xwiki_delete_page`, `xwiki_delete_object`, `xwiki_delete_attachment`, `xwiki_delete_comment` |
| Read/write/delete | `XWIKI_MCP_ALLOW_DELETE=true` | All 55 |
| Read-only | `XWIKI_MCP_READ_ONLY=true` (overrides `XWIKI_MCP_ALLOW_DELETE`) | 32 read tools |

Write tools: `xwiki_create_page`, `xwiki_update_page`, `xwiki_replace_in_page`, `xwiki_move_page`, `xwiki_copy_page`, `xwiki_restore_deleted_page`, `xwiki_add_comment`, `xwiki_update_comment`, `xwiki_upload_attachment`, `xwiki_move_attachment`, `xwiki_add_tags`, `xwiki_remove_tags`, `xwiki_set_class_property_enabled`, `xwiki_create_object`, `xwiki_update_object`, `xwiki_update_class_properties`, `xwiki_add_class_property`, `xwiki_rollback_page`.

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
Get page content, title, syntax, author, version and parent. `title` is rendered; when the stored title differs (e.g. Velocity code in a sheet's title, which gives each record of the class its own name) it is also returned as `raw_title`. Long content comes in windows of `max_chars` (default 40,000 characters, about 10k tokens): when `content_truncated` is true, call again with `offset` = `next_offset`. For a long page, `outline: true` returns its headings instead of the content (each with its number `n`, level, title, `line`, `end_line` and `chars`, the section's size with its subsections), and `section: n` returns only that section, windowed the same way. xwiki/2.x and Markdown headings are read; headings inside code blocks are not counted.

#### `xwiki_list_page_children`
Get immediate child pages of a given page. Hidden pages (e.g. class, sheet and template pages) are listed only when the xWiki account's Display Hidden Pages preference is on; xWiki's REST API has no option to include them otherwise.

#### `xwiki_get_page_tree`
Report the whole page tree under a root page in one call. `root_page` is the root's own row (level 0) with its object classes, so a root carrying an object (e.g. an SOP page) is never missed. Each descendant comes back with its reference, title, level (1 = direct child), parent, direct child count, URL and the object classes attached to it with a count per class; `class_totals` counts the pages carrying each class, the root included. Rows are depth-first. `hierarchy` is `parentchild` (the page's parent field, xWiki's REST default) or `nestedpages` (page/space nesting). `max_depth` (default 50) and `max_pages` (default 500, `truncated: true` when reached) bound the walk; `include_objects: false` skips the class listing. Hidden pages (e.g. class, sheet and template pages) are listed only when the xWiki account's Display Hidden Pages preference is on; xWiki's REST API has no option to include them otherwise. Costs one REST request per page for children plus one per page for objects, a few in parallel.

Without `space` and `page` it returns a wiki overview instead: one row per top-level space with `pages` (in it and its nested spaces), `nested_spaces`, and `last_modified` / `last_modified_page` (the latest change to a non-hidden page). It reads the whole page list (one request per 1000 pages, counting at most 20,000, `truncated: true` past that) and makes one Solr query per top-level space.

#### `xwiki_get_links`
The links around a page. `direction: in` lists the pages linking to it (backlinks) from the wiki's link index, as XWiki's rename finds them, paged with `start` / `limit`; the page does not need to exist, so it also finds pages still linking to a deleted or moved page. The index lags a few seconds behind saves; at most 1000 are read (`backlinks_truncated`). `direction: out` lists the links written in the page's raw content (wiki links, images, `include` / `display` macros, Markdown links), each with its reference as written (relative references are not resolved), its type (`doc`, `page`, `space`, `attach`, `url`, `mailto`, `image`, `include`, `display`, or `untyped`), its line and where it is (`content` or `Class[number].property`); links in code blocks are left out, and `include_objects` (default true, one request per object) also reads the page's object properties. `both` is the default.

#### `xwiki_find_pages`
Find pages wiki-wide by name, space, and/or author — without needing to know the exact space. Deduplicates results automatically. At least one filter required.

#### `xwiki_get_required_rights`
Analyse which rights a page's content needs (script or programming right for Velocity/Groovy, admin right for some macros) and compare them with the rights the page declares. Returns `declared`, `needed` (with whether the MCP account has each right) and plain-text `findings`. xWiki 17.4+; needs edit right on the page.

### Pages (Write)

#### `xwiki_create_page`
Create a new page with title, content, optional parent, and optional syntax.

#### `xwiki_update_page`
Update an existing page by replacing its whole content, its title, or both. Fetches current version first to preserve fields not specified; `expected_version` refuses the update if the page has changed since that version was read; an omitted title keeps the stored title, Velocity code included (so does `xwiki_replace_in_page`). To change only part of the content, use `xwiki_replace_in_page`.

#### `xwiki_replace_in_page`
Targeted edit: replace exact pieces of text in a page's content, or in one object property (`class_name`, `object_number`, `property`, e.g. the `code` of a `XWiki.JavaScriptExtension`), without sending the whole text. Made for code on long pages, such as Velocity or Groovy sheets. `edits` is a list of `{old_text, new_text}` applied in order; each `old_text` must occur exactly once (whitespace and line breaks included), and nothing is saved unless every edit matches. `expected_version` refuses the edit if the page has changed since that version was read. The saved text is read back and compared; the result gives the old and new version, the size before and after, and the line of each change. Saving script content still needs the rights the scripts need (`xwiki_get_required_rights`).

#### `xwiki_move_page`
Move or rename a page, as the wiki's Rename action does: history, objects, attachments and comments go with it. The target is given as its final reference (`Docs.Manuals` + `WebHome` for a nested page, `Docs.Guides` + `Install` for a terminal one). `children` (default true) moves child pages, `update_links` (default true) rewrites links across the wiki and checks the result, `auto_redirect` (default false) leaves a redirect at the old reference, `new_title` sets a new title. Omitting `new_title` keeps the current title. Fails if the target exists. Needs delete right on the source and edit right on the target. A write tool: it removes nothing but the page no longer exists at its old reference.

XWiki rewrites only the pages its search index lists as linking to the page (Solr `links_extended`), and skips any page it has not indexed yet, such as one saved moments before. The tool runs the same lookup before the move and checks each listed page afterwards: `backlinks_found` counts them, `links_updated` is true only when every one was rewritten, and `links_not_updated` names pages that still point to the old reference. Object properties of type Page (page pickers) are not in the link index, so the result does not check them; some XWiki versions rewrite them and others leave them, so read them back.

#### `xwiki_copy_page`
Copy a page to a new reference, as the wiki's Copy action does; the original is unchanged. Same target form as `xwiki_move_page` (`Docs.Manuals` + `WebHome` for a nested page, `Docs.Guides` + `SetupCopy` for a terminal one). `children` (default true) copies child pages of a nested page; `new_title` sets the copy's title; without it the copy keeps the source's title (XWiki would otherwise retitle a page whose title equals its name). Fails if the target exists. Needs view right on the source and edit right on the target.

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
List the versions of one attachment, newest first, with size, media type, author, date and a download URL per version.

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
List the XWiki classes defined in the wiki, paged with `start` / `limit`.

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
List the XObjects on a page with their property values. Optionally filter by `class_name`. `include_properties` (default true) reads each listed object in full, one request per object; set it to false for just class and number. Paged with `start` / `limit`.

#### `xwiki_get_object`
Get a single object by class name and object number (0-based).

#### `xwiki_get_object_property`
Read a single named property from an XObject — more efficient than `xwiki_get_object` when only one field is needed. Useful for status checks and conditional logic.

#### `xwiki_list_class_objects`
List the objects of one class across the whole wiki with the page each one is on, ordered by page (or by page date with `order: "date"`). `include_properties` (default true) adds every property value, one request per object; without it each row carries XWiki's `headline` (the first property's value) only when that is not empty. Paged with `start` / `limit` (default 50); pages the account cannot view are left out, so keep paging while `has_more` is true.

#### `xwiki_search_objects`
Find the objects of one class whose property values contain a string (`mode: "contains"`, the default) or match a JavaScript regular expression (`mode: "regex"`), case-sensitive unless `ignore_case` is true. Use it for exact matches that full-text search cannot give: Solr search is tokenized (searching for `{{code` finds every page with the word "code"), and recent XWiki versions refuse XWQL / HQL on the REST query endpoint unless an administrator allows them. The server pages through the class's objects with their properties and returns only the matches, one per object field: page, object number, field, match count and (with `include_snippet`, the default) up to 160 characters around the first match, never the whole value. `fields` limits the search to named properties (default: every string-valued property).

A call scans at most `scan_limit` objects (default 500, max 2000) from `start` and stops once `max_results` matches are found (default 100); it reports `objects_read`, `scanned`, and `next_start` with `has_more` to continue. Objects that fail to load are listed in `skipped` (by page and number, or by list position when the listing itself failed; failing batches are retried in smaller batches) instead of failing the call. An invalid regex returns an error; patterns are limited to 500 characters.

#### `xwiki_create_object`
Create a new XObject on a page with class name and property key-value map.

#### `xwiki_update_object`
Update properties of an existing object. Only specified properties are changed, each to the whole value given. `expected_version` refuses the update if the page has changed since that version was read. To change only part of a long value (e.g. a few lines of code), use `xwiki_replace_in_page`.

#### `xwiki_delete_object`
Delete an object by class name and number. Only registered with `XWIKI_MCP_ALLOW_DELETE=true`.

### History

#### `xwiki_list_page_versions`
List all revisions of a page — version string, timestamp, author, edit comment.

#### `xwiki_get_page_version`
Retrieve full page content at a specific historical version (e.g. `3.1`).

#### `xwiki_compare_page_versions`
Compare two versions of a page (or one version with the current version): a unified diff of the content, lines added and removed, and any title or syntax change, with each version's author and date as the page history shows them. The diff is computed by the server; xWiki's REST API has none.

#### `xwiki_rollback_page`
Roll a page back to an earlier version (content and objects). xWiki saves the old version as a new version, so history is kept. Uses the `/bin/rollback/` action URL with the CSRF token.

#### `xwiki_list_recent_changes`
Get the most recent modifications across the entire wiki: page, version, date, author and edit comment.

### Search & Query

#### `xwiki_search_pages`
Full-text search across the wiki. Supports `content`, `title`, or `name` scope. `space` limits it to pages directly in that space (its subspaces are not searched).

#### `xwiki_query`
Run HQL, XWQL, or Solr queries against the wiki. For HQL/XWQL supply only the WHERE clause — xWiki prepends the SELECT. Example: `where doc.space = 'Main' order by doc.date desc`. Recent XWiki versions accept only Solr on this endpoint unless `xwiki.properties` sets `rest.allowedQueryTypes` (e.g. `xwql,hql,solr`); a refused type returns XWiki's message naming the allowed types.

### Render & Export

#### `xwiki_render_page`
Render a page through the xWiki macro engine to plain text or HTML, as a reader sees it: a record page displayed by its sheet (class or document sheet binding) renders through the sheet. Plain text is converted from the rendered HTML (one line per block, `- ` for list items, scripts and styles dropped). Useful for pages with macros, velocity, include blocks or sheets. Uses the action URL (`/bin/get/`) — not the REST API.

#### `xwiki_export_page`
Export a page as a file. `pdf` and `xar` come back as an MCP embedded resource (binary) with name, type, size and URL; over `XWIKI_MCP_MAX_FILE_BYTES` they are refused. `format`: `pdf` (default, needs the PDF export extension), `xar` (a wiki package with objects and attachments that can be imported elsewhere; needs wiki admin rights; `history: true` includes page history) or `html` (the rendered page as static HTML, returned as text in `pages`: each page's content area only, without the skin's menus, scripts and footer; the export's skin, script and image files, several MB, are left out and counted in `files_omitted`). For `xar` and `html`, `children: true` adds every page under a nested page.

---

## Implementation Notes

- **CSRF tokens**: Cached from GET response headers (`XWiki-Form-Token`), auto-refreshed on 403. Required for xWiki 14.10.8+.
- **Write bodies**: Page writes use `application/xml` bodies; object properties are sent as a form body (`property#name=value`), which is what xWiki actually saves.
- **Nested spaces**: Dot notation (`Space.SubSpace`) converts to xWiki's `/spaces/X/spaces/Y/` URL format. A dot that is part of a space name is escaped with a backslash, as XWiki writes references (`Docs.1\.2 Notes` is the space `1.2 Notes` inside `Docs`; `\\` is a backslash); the `space` that list tools return is already in this form, so it can be passed back as is.
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
npm test        # 140 unit tests (mocked fetch)
```

Integration tests run the built server against a real XWiki. CI does this on every push against the official Docker images (current LTS and stable); locally:

```bash
XWIKI_IT_PASSWORD=admin scripts/start-xwiki.sh lts-postgres-tomcat 8080   # throwaway XWiki + Postgres
npm run build
XWIKI_IT_URL=http://127.0.0.1:8080 XWIKI_IT_USER=superadmin XWIKI_IT_PASSWORD=admin npm run test:integration
docker rm -f xwiki-it xwiki-it-db && docker network rm xwiki-it
```

They write only under a fresh `IT.Run<timestamp>` space. Point them at a disposable wiki, never a production one.

After deploying a release, test it against your own wiki with the live test plan in [TESTING.md](TESTING.md). That file also has the rules (stop if the deployment is not current; write only in an empty throwaway space; create pages only as the plan says), the test order, how to fix a failure, and where issues go.

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
- [x] v0.23.1 — The wiki overview (`xwiki_get_page_tree` without a root) and `xwiki_list_spaces` read every space and page; they stopped at about 1000 spaces when XWiki returned a short batch
- [x] v0.23.0 — `xwiki_get_links`: backlinks and the links written in a page and its objects. `xwiki_get_page` reads a long page by its heading `outline` and one `section`. `xwiki_get_page_tree` without a root gives a wiki overview of the top-level spaces. `xwiki_update_page` and `xwiki_update_object` take `expected_version` and refuse to overwrite a newer version
- [x] v0.22.0 — `xwiki_search_objects`: exact substring or regex search in the property values of a class's objects, returning compact matches
- [x] v0.21.1 — `xwiki_update_page`, `xwiki_replace_in_page`, `xwiki_move_page` and `xwiki_copy_page` keep a page's stored title. Before, they wrote back the rendered title, so saving a sheet whose title is Velocity code replaced that code with its output and every record of the class showed the sheet's name. `xwiki_get_page` returns `raw_title` when it differs from the rendered title
- [x] v0.21.0 — `xwiki_get_page_tree` returns `root_page`: the root page's own row with its object classes (before, only descendants were reported, so the root's objects were never listed); `class_totals` includes the root. `xwiki_render_page` renders a page as a reader sees it, through its sheet (plain text came back empty for a page whose sheet draws its view inside an html macro, because xWiki's plain renderer drops html macro output). Tree and children docs say hidden pages need the account's Display Hidden Pages preference
- [x] v0.20.1 — `xwiki_replace_in_page` (first released version; a `v0.20.0` tag was pushed early on the 0.19.0 code and is not a release): targeted find-and-replace edits to page content or one object property, each match unique, all or nothing, optional version check, read back after saving
- [x] v0.19.0 — Fixes from a second live test: `xwiki_search_pages` honours `space` (the wiki-wide search ignored it); `xwiki_compare_page_versions` gives the current version its own date and author; `xwiki_list_page_objects` returns property values (`include_properties`); HTML export returns each page's content area, not the whole skin page; a missing page's history says "Page not found"; `xwiki_move_page` no longer says Page properties are never rewritten (it depends on the XWiki version)
- [x] v0.18.0 — Fixes from a live test: `xwiki_move_page` checks that links were rewritten (`backlinks_found`, `links_not_updated`); copy and move keep the title; HTML export returns the page HTML, not a multi-MB zip; attachment versions newest first; history of a missing page is not found; dates are ISO strings everywhere; empty headline and empty required-right entries left out; upload URL without a stale `rev`; a rejected request (400) carries XWiki's reason; `xwiki_list_classes` honours `start` / `limit` (XWiki returns every class); `xwiki_list_recent_changes` names the page of each change
- [x] v0.17.0 — MCP TypeScript SDK v2: protocol 2026-07-28 (no handshake or sessions, header-validated HTTP requests, cacheable tool list), with 2025-era clients that open with `initialize` (e.g. supergateway) still served
- [x] v0.16.0 — Live integration tests against XWiki LTS and stable in CI; recycle-bin listing falls back to the core template on wikis without the standard flavor; `xwiki_query` defaults to Solr (XWiki 17.10.5 / 18.2+ allow only Solr through REST unless `rest.allowedQueryTypes` says otherwise); errors include XWiki's own message; CI (build and tests on Node 22 and 24, image build), release only after tests pass, actions pinned by commit, image base and supergateway pinned, Dependabot, provenance and SBOM, `SECURITY.md`, `server.json` for the MCP Registry; Origin / Host checks and 405 in HTTP mode, rate limit, toolsets, call log, titles and server instructions, files as embedded resources with a size cap, paging on every list tool, page content windows, compact JSON, `structuredContent`, secrets from files, clean shutdown
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
