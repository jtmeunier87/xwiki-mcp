# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that bridges AI agents (Claude Code, OpenClaw, etc.) with a corporate XWiki instance via REST API. Built in TypeScript using `@modelcontextprotocol/sdk` with stdio transport.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Run with tsx (development)
npm test             # Run tests (if configured)
```

The server is invoked as a stdio MCP server — it reads JSON-RPC from stdin and writes to stdout.

## Architecture

```
src/
├── index.ts          # Entry point: MCP Server init, tool registration
├── config.ts         # Env var parsing/validation
├── client.ts         # XWiki REST API HTTP client (fetch wrapper with auth)
├── types.ts          # Shared TypeScript interfaces
└── tools/            # One file per tool
    ├── list-spaces.ts
    ├── list-pages.ts
    ├── get-page.ts
    ├── search.ts
    ├── get-attachments.ts
    └── get-page-children.ts
```

## Configuration (Environment Variables)

```
XWIKI_BASE_URL      # Required. Base URL without /rest (e.g. https://wiki.example.com)
XWIKI_AUTH_TYPE     # basic|token|none (default: basic)
XWIKI_USERNAME      # For basic auth
XWIKI_PASSWORD      # For basic auth
XWIKI_TOKEN         # For token auth (Bearer)
XWIKI_WIKI_NAME     # Wiki name (default: xwiki)
XWIKI_REST_PATH     # REST path (default: /rest)
XWIKI_PAGE_LIMIT    # Default page size (default: 50)
```

## XWiki REST API Specifics

- **JSON mode:** Use `?media=json` or `Accept: application/json`
- **Pagination params:** `start` and `number` (NOT `limit`) — map tool's `limit` → `number`
- **Nested spaces:** Dot notation in params (`Space1.SubSpace`) → path `/spaces/Space1/spaces/SubSpace`
- **Default limit:** 50 (XWiki max is 1000; keep low to save tokens)

## Tool Response Format

- Return compact JSON with only useful fields (strip XWiki XML wrappers)
- Paginated results include `_pagination: { total, start, limit, has_more }`
- Page URLs as full web URLs, not REST endpoints

## Error Handling Convention

| HTTP Status | Message |
|---|---|
| 404 | `"Page not found: {space}/{page}"` |
| 401/403 | `"Authentication failed. Check XWIKI_AUTH_TYPE and credentials."` |
| 500 | `"XWiki server error: {status}. URL: {url}"` |
| Network | `"Cannot connect to XWiki at {baseUrl}. Check XWIKI_BASE_URL."` |

Errors must be handled gracefully — never crash the MCP server process.

## Phase 2 (Not Implemented)

Write operations (`create_page`, `update_page`, `add_comment`) are stubs only — add TODO comments with REST endpoints but no implementation.

## References

- Spec: `doc/xwiki-mcp-0.md` (Russian, full technical spec)
- XWiki REST API: https://www.xwiki.org/xwiki/bin/view/Documentation/UserGuide/Features/XWikiRESTfulAPI
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
