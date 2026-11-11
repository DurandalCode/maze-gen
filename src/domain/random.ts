import { canonical, sha256 } from './hash';
const rotl = (n: number, k: number) => ((n << k) | (n >>> (32 - k))) >>> 0;
export class Random {
  private state: number[];
  constructor(seed: string | readonly number[]) {
    if (typeof seed === 'string') {
      const hex = sha256(seed.normalize('NFC'));
      this.state = Array.from({ length: 4 }, (_, i) => {
        const bytes = Array.from({ length: 4 }, (_, j) =>
          parseInt(hex.slice(i * 8 + j * 2, i * 8 + j * 2 + 2), 16),
        );
        return (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
      });
    } else {
      if (seed.length !== 4 || seed.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff))
        throw new Error('PRNG state requires four uint32 words');
      this.state = [...seed];
    }
    if (this.state.every((n) => n === 0)) this.state = [1, 0, 0, 0];
  }
  uint32(): number {
    let [a, b, c, d] = this.state as [number, number, number, number];
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0,
      t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    this.state = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return result;
  }
  next(): number {
    return this.uint32() / 4294967296;
  }
  snapshot(): number[] {
    return [...this.state];
  }
}
export function variantSeed(
  seed: string,
  generatorVersion: string,
  variantIndex: number,
  attemptIndex: number,
): string {
  return sha256(canonical([seed.normalize('NFC'), generatorVersion, variantIndex, attemptIndex]));
}
