# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/jtmeunier87/xwiki-mcp/security/advisories/new),
not in a public issue. Include the version, how the server was run (stdio or HTTP, access mode)
and steps to reproduce. You should get a reply within a week.

## Supported versions

Only the latest release gets fixes.

## Deploying safely

- The server acts with the rights of the configured xWiki account: give that account only the
  rights the agents need, and keep delete tools off (`XWIKI_MCP_ALLOW_DELETE` unset) unless needed.
- HTTP mode must sit behind an authenticating proxy or on a private network. `XWIKI_MCP_HTTP_TOKEN`
  adds a shared token; `XWIKI_MCP_ALLOWED_ORIGINS` / `XWIKI_MCP_ALLOWED_HOSTS` protect against
  DNS rebinding.
- Pass secrets with `XWIKI_PASSWORD_FILE` / `XWIKI_TOKEN_FILE` (Docker or Kubernetes secrets)
  rather than plain environment variables where you can.
- Wiki content returned by the tools is untrusted input to the model: pages can contain text
  written to steer an agent. Keep a person in the loop for writes.
