// How file bytes go back to the client: images the model can see as image content, every
// other file as an embedded resource (a binary blob, not base64 text in the model's context).

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function fileContent(file: { name: string; uri: string; mime_type?: string; size_bytes: number; content_base64: string }) {
  const mime = (file.mime_type ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const meta = { type: 'text' as const, text: JSON.stringify({ name: file.name, mime_type: mime, size_bytes: file.size_bytes, url: file.uri }) };
  if (IMAGE_TYPES.has(mime) && file.size_bytes <= MAX_IMAGE_BYTES) {
    return [{ type: 'image' as const, data: file.content_base64, mimeType: mime }, meta];
  }
  return [{ type: 'resource' as const, resource: { uri: file.uri, mimeType: mime, blob: file.content_base64 } }, meta];
}
