/**
 * ハッシュ値を seed とする決定論的な乱数生成器。
 * 同じ seed からは必ず同じ乱数列が得られる（Math.random は使わない）。
 *
 * アルゴリズムは sfc32。SHA-256 の 32byte を 4 つの uint32 に畳み込んで初期状態にする。
 */
export interface SeededRandom {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [min, max) の実数 */
  range(min: number, max: number): number;
  /** [min, max] の整数 */
  int(min: number, max: number): number;
  /** 確率 p で true */
  chance(p: number): boolean;
  /** 重み付き選択 */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
}

export function createSeededRandom(seed: Uint8Array): SeededRandom {
  if (seed.length < 16) throw new Error("seed must be at least 16 bytes");

  const view = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
  const word = (i: number) => {
    const lo = view.getUint32(i * 4);
    const hi = seed.length >= 32 ? view.getUint32(16 + i * 4) : 0;
    return (lo ^ hi) >>> 0;
  };
  let a = word(0);
  let b = word(1);
  let c = word(2);
  let d = word(3);

  const nextUint32 = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  // 初期状態の偏りを捨てる
  for (let i = 0; i < 15; i++) nextUint32();

  const next = () => nextUint32() / 4294967296;

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    weighted(entries) {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) {
        r -= w;
        if (r < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
  };
}
