#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { XWikiClient } from './client.js';

// Read tools (original)
import { register as registerListSpaces } from './tools/list-spaces.js';
import { register as registerListPages } from './tools/list-pages.js';
import { register as registerGetPage } from './tools/get-page.js';
import { register as registerSearch } from './tools/search.js';
import { register as registerGetAttachments } from './tools/get-attachments.js';
import { register as registerGetPageChildren } from './tools/get-page-children.js';

// Write tools (Phase 1)
import { register as registerCreatePage } from './tools/create-page.js';
import { register as registerUpdatePage } from './tools/update-page.js';
import { register as registerDeletePage } from './tools/delete-page.js';
import { register as registerAddComment } from './tools/add-comment.js';
import { register as registerGetComments } from './tools/get-comments.js';

// Attachment tools (Phase 2)
import { register as registerUploadAttachment } from './tools/upload-attachment.js';
import { register as registerDownloadAttachment } from './tools/download-attachment.js';
import { register as registerDeleteAttachment } from './tools/delete-attachment.js';

// Tag tools (Phase 2)
import { register as registerGetTags } from './tools/get-tags.js';
import { register as registerAddTags } from './tools/add-tags.js';

// Class tools (Phase 3)
import { register as registerListClasses } from './tools/list-classes.js';
import { register as registerGetClass } from './tools/get-class.js';

// Object tools (Phase 3)
import { register as registerListObjects } from './tools/list-objects.js';
import { register as registerGetObject } from './tools/get-object.js';
import { register as registerCreateObject } from './tools/create-object.js';
import { register as registerUpdateObject } from './tools/update-object.js';
import { register as registerDeleteObject } from './tools/delete-object.js';

async function main() {
  const server = new McpServer({
    name: 'xwiki-mcp',
    version: '0.3.0',
  });

  const client = new XWikiClient();

  // Read tools (6)
  registerListSpaces(server, client);
  registerListPages(server, client);
  registerGetPage(server, client);
  registerSearch(server, client);
  registerGetAttachments(server, client);
  registerGetPageChildren(server, client);

  // Write tools (5)
  registerCreatePage(server, client);
  registerUpdatePage(server, client);
  registerDeletePage(server, client);
  registerAddComment(server, client);
  registerGetComments(server, client);

  // Attachment tools (3)
  registerUploadAttachment(server, client);
  registerDownloadAttachment(server, client);
  registerDeleteAttachment(server, client);

  // Tag tools (2)
  registerGetTags(server, client);
  registerAddTags(server, client);

  // Class tools (2)
  registerListClasses(server, client);
  registerGetClass(server, client);

  // Object tools (5)
  registerListObjects(server, client);
  registerGetObject(server, client);
  registerCreateObject(server, client);
  registerUpdateObject(server, client);
  registerDeleteObject(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`xwiki-mcp started (v0.3.0). Wiki: ${config.baseUrl} (${config.wikiName})\n`);
  process.stderr.write(`Registered 23 tools (6 read, 5 write, 3 attachment, 2 tag, 2 class, 5 object)\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
