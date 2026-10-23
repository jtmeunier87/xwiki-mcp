# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that gives AI agents read/write access to an XWiki instance through its REST API. TypeScript, `@modelcontextprotocol/sdk`, stdio or Streamable HTTP transport. 52 tools, all prefixed `xwiki_`; README.md is the tool reference.

**This is a public, generic tool.** Never add anything specific to one organisation or wiki: no real space, page, class, user, tag or host names, and no description of how a particular wiki uses its pages or objects. Examples in tool descriptions, tests and docs use neutral names (`Main`, `Sandbox`, `Docs.Guides`, `Sandbox.Code.ExampleClass`, `XWiki.Admin`, `XWiki.JaneDoe`, `wiki.example.com`).

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Run with tsx (development)
npm test             # Vitest unit tests (mocked fetch, no live wiki)
```

Without `XWIKI_MCP_PORT` the server speaks MCP over stdio. With it, it serves stateless Streamable HTTP on `POST /mcp` plus `GET /health`.

## Architecture

```
src/
├── index.ts          # Entry point: tool list with access levels, transports, HTTP token check
├── registry.ts       # Registers tools: annotations from access level, disabled tools, error guard
├── diff.ts           # Line diff for xwiki_compare_page_versions
├── tools/paging.ts   # start/limit inputs and _pagination for list tools
├── tools/files.ts    # File bytes as image or embedded-resource content
├── config.ts         # Env var parsing/validation
├── version.ts        # Single source of the server version (keep in step with package.json)
├── client.ts         # XWiki REST/action-URL HTTP client (auth, CSRF token, mapping)
├── client.test.ts    # Unit tests for the client
├── registry.test.ts  # Unit tests for registration
├── types.ts          # Raw XWiki shapes and compact tool output shapes
└── tools/            # One file per tool, each exports register(server, client)
```

To add a tool: create `src/tools/<name>.ts`, add the client method and types, add it to `TOOLS` in `index.ts` with its access level (`read`, `write` or `delete`; annotations follow from it, and a write that only adds or is idempotent goes in `ADDITIVE` / `IDEMPOTENT` in `registry.ts`), add a test, and update README.md.

## Configuration (Environment Variables)

```
XWIKI_BASE_URL          # Required. Base URL without /rest (e.g. https://wiki.example.com)
XWIKI_AUTH_TYPE         # basic|token|none (default: basic)
XWIKI_USERNAME          # For basic auth
XWIKI_PASSWORD          # For basic auth
XWIKI_TOKEN             # For token auth (Bearer)
XWIKI_WIKI_NAME         # Wiki name (default: xwiki)
XWIKI_REST_PATH         # REST path (default: /rest)
XWIKI_PAGE_LIMIT        # Default page size (default: 50)
XWIKI_TIMEOUT_MS        # Per-request timeout (default: 30000; long operations get 4x)
XWIKI_MCP_PORT          # Set to serve Streamable HTTP instead of stdio
XWIKI_MCP_HOST          # HTTP mode: interface to listen on (default: all)
XWIKI_MCP_HTTP_TOKEN    # HTTP mode: bearer token required on POST /mcp (default: none)
XWIKI_MCP_READ_ONLY     # true: register read tools only (default: false)
XWIKI_MCP_ALLOW_DELETE  # true: also register delete tools (default: false)
XWIKI_MCP_DISABLED_TOOLS # Comma-separated tools to leave unregistered (unknown names fail at startup)
XWIKI_MCP_TOOLSETS      # Comma-separated toolsets to register (default: all; unknown names fail at startup)
XWIKI_MCP_ALLOWED_ORIGINS # HTTP mode: origins allowed when a request sends Origin (others get 403)
XWIKI_MCP_ALLOWED_HOSTS # HTTP mode: Host header values to accept (default: any)
XWIKI_MCP_RATE_LIMIT    # Tool calls per minute, all clients (default: 120; 0 = off)
XWIKI_MCP_MAX_FILE_BYTES # Largest file download/export returns (default: 10 MB)
XWIKI_MCP_LOG_CALLS     # One JSON line per call on stderr (default: true)
# XWIKI_PASSWORD, XWIKI_TOKEN and XWIKI_MCP_HTTP_TOKEN can be read from a file: set NAME_FILE instead
```

## Access modes and security

- Tools a mode excludes are not registered at all. `XWIKI_MCP_READ_ONLY` overrides `XWIKI_MCP_ALLOW_DELETE`.
- Delete tools (`xwiki_delete_page`, `xwiki_delete_object`, `xwiki_delete_attachment`, `xwiki_delete_comment`) are off by default.
- `XWIKI_MCP_DISABLED_TOOLS` only removes tools from the mode's set.
- HTTP mode refuses a request whose `Origin` is not in `XWIKI_MCP_ALLOWED_ORIGINS` (403, DNS rebinding) and, if set, a `Host` not in `XWIKI_MCP_ALLOWED_HOSTS`; `GET` / `DELETE` on `/mcp` return 405.
- The HTTP mode's only authentication is the optional `XWIKI_MCP_HTTP_TOKEN`. It must still sit behind an authenticating proxy or on a private network; document this wherever HTTP deployment is described.

## XWiki REST API Specifics

- **JSON mode:** Use `?media=json` or `Accept: application/json`
- **Pagination params:** `start` and `number` (NOT `limit`) — map tool's `limit` → `number`
- **Nested spaces:** Dot notation in params (`Space1.SubSpace`) → path `/spaces/Space1/spaces/SubSpace`
- **Default limit:** 50 (XWiki max is 1000; keep low to save tokens)
- **CSRF:** Writes need the `XWiki-Form-Token` header (cached from GET responses, refreshed on 403)
- **Object properties:** Write them as a form body (`property#name=value`); XML property bodies are accepted but not saved
- **Classes:** The list endpoint returns `clazzs`; property attributes (e.g. StaticList `values`) come as `[{name, value}]`
- **Action URLs:** `render_page`, `export_page`, `rollback_page`, `move_page` (`?xpage=rename&step=2`), `copy_page` (`?xpage=copy`), `move_attachment` (`?xpage=attachment/move`), `restore_deleted_page` (`/bin/undelete/`), `list_deleted_pages` (`XWiki.DeletedDocumentsJSON`) and the class editing tools (`/bin/propupdate`, `/bin/propadd`, `/bin/propdisable`, `/bin/propenable`; fields `{property}_{attribute}` and `form_token`) use `/bin/…` action URLs, not REST

Mocked tests cannot prove a write is saved. Verify write changes against a real XWiki before release.

## Tool Response Format

- Return compact JSON (`JSON.stringify(x)`, no indentation) with only useful fields (strip XWiki XML wrappers)
- List tools take `...pagingShape` and return `pageOf(items, start, limit)` (`src/tools/paging.ts`): `_pagination: { total, start, limit, has_more }`
- File bytes go out through `fileContent()` (`src/tools/files.ts`): images as image content, other files as embedded resources, never base64 in text; check sizes against `XWIKI_MCP_MAX_FILE_BYTES`
- Long text (page content) comes in windows with `offset` / `next_offset`
- New tools go in a toolset in `TOOLS` (`index.ts`); `registry.ts` adds the title (override in `TITLES` if the name reads badly)
- Page URLs as full web URLs, not REST endpoints

## Error Handling Convention

| HTTP Status | Message |
|---|---|
| 404 | `"Page not found: {space}/{page}"` |
| 401/403 | `"Authentication failed. Check XWIKI_AUTH_TYPE and credentials."` |
| 500 | `"XWiki server error: {status}. URL: {url}"` |
| Network | `"Cannot connect to XWiki at {baseUrl}. Check XWIKI_BASE_URL."` |

Tool errors must be returned as `isError` results, never crash the MCP server process (`registry.ts` turns any thrown error into one; tools still map 404s to their own messages). Invalid configuration fails at startup.

## References

- XWiki REST API: https://www.xwiki.org/xwiki/bin/view/Documentation/UserGuide/Features/XWikiRESTfulAPI
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
