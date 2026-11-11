/** JSON wire codec shared by browser storage worker and the local dev server. */
export async function encodeStorage(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer()),
      parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192)
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    return { $mazeBlob: { type: value.type, base64: btoa(parts.join('')) } };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeStorage));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = await encodeStorage(item);
    return result;
  }
  return value;
}
export function decodeStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeStorage);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Object.keys(o).length === 1 && o.$mazeBlob) {
      const b = o.$mazeBlob as { type: string; base64: string };
      if (
        typeof b.type !== 'string' ||
        typeof b.base64 !== 'string' ||
        b.base64.length > 46_000_000
      )
        throw new Error('Invalid blob');
      const bytes = Uint8Array.from(atob(b.base64), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: b.type });
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decodeStorage(v)]));
  }
  return value;
}
