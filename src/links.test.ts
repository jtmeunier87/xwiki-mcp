import { describe, it, expect } from 'vitest';
import { outgoingLinks } from './links.js';

describe('outgoingLinks', () => {
  it('reads xwiki links, images and include macros, outside code', () => {
    const content = [
      'See [[Docs.Guides.Setup]] and [[the guide>>doc:Docs.Guides.WebHome||anchor="x"]].',
      '[[[[image:Main.WebHome@logo.png]]>>https://example.com]] ~[[escaped]] {{code}}[[NotALink]]{{/code}}',
      '{{include reference="Sandbox.Shared"/}} [[mail>>mailto:jane@example.com]]',
      '{{code language="none"}}',
      '[[InCode]]',
      '{{/code}}',
    ].join('\n');
    expect(outgoingLinks(content)).toEqual([
      { reference: 'Docs.Guides.Setup', type: 'untyped', line: 1 },
      { reference: 'Docs.Guides.WebHome', type: 'doc', line: 1 },
      { reference: 'Main.WebHome@logo.png', type: 'image', line: 2 },
      { reference: 'https://example.com', type: 'url', line: 2 },
      { reference: 'jane@example.com', type: 'mailto', line: 3 },
      { reference: 'Sandbox.Shared', type: 'include', line: 3 },
    ]);
  });

  it('reads Markdown links and images', () => {
    const md = '[a](Other.Page) ![i](pic.png) [w](https://example.com "t") `[c](x)`\n```\n[n](y)\n```';
    expect(outgoingLinks(md, 'markdown/1.2')).toEqual([
      { reference: 'Other.Page', type: 'untyped', line: 1 },
      { reference: 'pic.png', type: 'image', line: 1 },
      { reference: 'https://example.com', type: 'url', line: 1 },
    ]);
  });
});
