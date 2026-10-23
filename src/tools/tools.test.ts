import { describe, it, expect } from 'vitest';
import { pageOf } from './paging.js';
import { fileContent } from './files.js';

describe('pageOf', () => {
  it('slices a list and reports the exact total', () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(pageOf(items, 0, 3)).toEqual({ items: [0, 1, 2], _pagination: { total: 7, start: 0, limit: 3, has_more: true } });
    expect(pageOf(items, 6, 3)).toEqual({ items: [6], _pagination: { total: 7, start: 6, limit: 3, has_more: false } });
  });
});

describe('fileContent', () => {
  const base = { name: 'f', uri: 'https://wiki.example.com/f', content_base64: 'AAAA', size_bytes: 3 };

  it('returns a small image as image content', () => {
    expect(fileContent({ ...base, mime_type: 'image/png;charset=x' })[0]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });

  it('returns other files as an embedded resource blob, never base64 text', () => {
    const [blob, meta] = fileContent({ ...base, mime_type: 'application/pdf' });
    expect(blob).toEqual({ type: 'resource', resource: { uri: 'https://wiki.example.com/f', mimeType: 'application/pdf', blob: 'AAAA' } });
    expect(JSON.parse((meta as { text: string }).text)).toEqual({ name: 'f', mime_type: 'application/pdf', size_bytes: 3, url: 'https://wiki.example.com/f' });
  });
});
