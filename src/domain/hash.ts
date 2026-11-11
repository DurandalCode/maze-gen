/** Locale-independent ordering is required for cross-device hashes. */
export function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort(compareId)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  throw new Error('Canonical JSON accepts only finite JSON values');
}
export function utf8(value: string): number[] {
  const bytes: number[] = [];
  for (const char of value) {
    let n = char.codePointAt(0)!;
    if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
    if (n < 0x80) bytes.push(n);
    else if (n < 0x800) bytes.push(0xc0 | (n >>> 6), 0x80 | (n & 63));
    else if (n < 0x10000) bytes.push(0xe0 | (n >>> 12), 0x80 | ((n >>> 6) & 63), 0x80 | (n & 63));
    else
      bytes.push(
        0xf0 | (n >>> 18),
        0x80 | ((n >>> 12) & 63),
        0x80 | ((n >>> 6) & 63),
        0x80 | (n & 63),
      );
  }
  return bytes;
}
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));
/** Pure SHA-256 keeps domain code independent of browser/Node crypto APIs. */
export function sha256(value: string): string {
  const data = utf8(value),
    bits = data.length * 8;
  data.push(0x80);
  while (data.length % 64 !== 56) data.push(0);
  for (let i = 7; i >= 0; i--) data.push(Math.floor(bits / 2 ** (i * 8)) & 255);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      w[i] = (data[p]! << 24) | (data[p + 1]! << 16) | (data[p + 2]! << 8) | data[p + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!,
        b = w[i - 2]!;
      w[i] =
        (w[i - 16]! +
          (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) +
          w[i - 7]! +
          (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, j] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
        (j + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      j = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const state = [a, b, c, d, e, f, g, j];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + state[i]!) >>> 0;
  }
  return h.map((n) => n.toString(16).padStart(8, '0')).join('');
}
export const hashValue = (value: unknown): string => sha256(canonical(value));
