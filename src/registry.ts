import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { XWikiClient } from './client.js';

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

type Result = { content: Array<{ type: 'text'; text: string }>; isError: true };

/** Wrap a tool callback so a thrown error becomes an isError result instead of a failed request. */
function guard<T extends (...args: never[]) => unknown>(cb: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await cb(...args);
    } catch (e) {
      return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true } satisfies Result;
    }
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
            return target.registerTool(name, { ...cfg, annotations: { ...annotationsFor(name, access), ...cfg.annotations } } as never, guard(cb) as never);
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
            return target.tool(name, description, schema, annotationsFor(name, access), guard(cb) as never);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    register(wrapped, client);
  }
  return registered;
}
