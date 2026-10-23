import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { XWikiClient } from './client.js';
import { config } from './config.js';

export type Access = 'read' | 'write' | 'delete';
export type Register = (server: McpServer, client: XWikiClient) => void;

// Writes that only add (they never change or remove existing content).
const ADDITIVE = new Set([
  'xwiki_add_comment', 'xwiki_add_tags', 'xwiki_create_object', 'xwiki_add_class_property',
  'xwiki_copy_page', 'xwiki_restore_deleted_page',
]);

// Writes that leave the wiki the same when repeated with the same arguments.
const IDEMPOTENT = new Set([
  'xwiki_update_page', 'xwiki_update_object', 'xwiki_update_class_properties', 'xwiki_set_class_property_enabled',
  'xwiki_add_tags', 'xwiki_remove_tags', 'xwiki_update_comment',
]);

/** MCP tool annotations, so clients can tell reads from writes and destructive writes. */
export function annotationsFor(name: string, access: Access): ToolAnnotations {
  if (access === 'read') return { readOnlyHint: true, openWorldHint: false };
  return {
    readOnlyHint: false,
    destructiveHint: access === 'delete' || !ADDITIVE.has(name),
    idempotentHint: access === 'delete' || IDEMPOTENT.has(name),
    openWorldHint: false,
  };
}

// Display titles where the name read as words is not clear enough.
const TITLES: Record<string, string> = {
  xwiki_query: 'Query the wiki (XWQL / HQL / Solr)',
  xwiki_set_class_property_enabled: 'Enable or disable a class property',
  xwiki_get_required_rights: 'Get the rights a page needs',
};

/** Human-readable title: from TITLES, else the name without its prefix, as a sentence. */
export function titleFor(name: string): string {
  if (TITLES[name]) return TITLES[name];
  const words = name.replace(/^xwiki_/, '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Tool calls in the last minute, across every client of this process (XWIKI_MCP_RATE_LIMIT).
const recentCalls: number[] = [];

/** True if one more call fits in the per-minute limit; records it. */
export function takeCallSlot(now = Date.now()): boolean {
  if (!config.rateLimit) return true;
  while (recentCalls.length > 0 && now - recentCalls[0] >= 60_000) recentCalls.shift();
  if (recentCalls.length >= config.rateLimit) return false;
  recentCalls.push(now);
  return true;
}

/** For tests: forget recorded calls. */
export function resetCallSlots(): void {
  recentCalls.length = 0;
}

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };

const errorResult = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

/**
 * Wrap a tool callback: enforce the rate limit, turn a thrown error into an isError
 * result, add structuredContent when the text result is a JSON object, and log the call.
 */
function guard<T extends (...args: never[]) => unknown>(name: string, cb: T): T {
  return (async (...args: Parameters<T>) => {
    const started = Date.now();
    let result: ToolResult;
    if (!takeCallSlot(started)) {
      result = errorResult(`Rate limit reached: ${config.rateLimit} tool calls per minute (XWIKI_MCP_RATE_LIMIT). Wait a minute and retry.`);
    } else {
      try {
        result = (await cb(...args)) as ToolResult;
      } catch (e) {
        result = errorResult(e instanceof Error ? e.message : String(e));
      }
    }
    const first = result.content?.[0];
    if (!result.isError && result.structuredContent === undefined && result.content?.length === 1 && first?.type === 'text' && first.text?.startsWith('{')) {
      try {
        result.structuredContent = JSON.parse(first.text);
      } catch {
        // Not JSON: text only.
      }
    }
    if (config.logCalls) {
      process.stderr.write(`${JSON.stringify({ time: new Date(started).toISOString(), tool: name, ok: !result.isError, ms: Date.now() - started })}\n`);
    }
    return result;
  }) as unknown as T;
}

/**
 * Register the tools on a server through a thin wrapper that adds annotations from each
 * tool's access level, guards its callback, and skips tools named in `disabled`.
 * Returns the names of the tools registered.
 */
export function registerTools(
  server: McpServer,
  client: XWikiClient,
  tools: Array<[Access, Register]>,
  disabled: ReadonlySet<string>,
  seen: Set<string> = new Set(),
): string[] {
  const registered: string[] = [];
  for (const [access, register] of tools) {
    const wrapped = new Proxy(server, {
      get(target, prop, receiver) {
        if (prop === 'registerTool') {
          return (name: string, cfg: { annotations?: ToolAnnotations }, cb: (...args: never[]) => unknown) => {
            seen.add(name);
            if (disabled.has(name)) return undefined;
            registered.push(name);
            return target.registerTool(name, { title: titleFor(name), ...cfg, annotations: { title: titleFor(name), ...annotationsFor(name, access), ...cfg.annotations } } as never, guard(name, cb) as never);
          };
        }
        if (prop === 'tool') {
          return (...args: unknown[]) => {
            // Tools here call tool(name, description, paramsSchema, cb).
            if (args.length !== 4) throw new Error(`Unexpected tool() registration for ${String(args[0])}`);
            const [name, description, schema, cb] = args as [string, string, never, (...a: never[]) => unknown];
            seen.add(name);
            if (disabled.has(name)) return undefined;
            registered.push(name);
            return target.registerTool(name, { title: titleFor(name), description, inputSchema: schema, annotations: { title: titleFor(name), ...annotationsFor(name, access) } } as never, guard(name, cb) as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    register(wrapped, client);
  }
  return registered;
}
