// 決定的な疑似乱数（xmur3 + mulberry32）。
// 同じ seed 文字列からは常に同じ需要・同じ軌跡が生成される。
// これが MF-JSON の「記録＝再計算で再現」の基礎になる。

export type Rng = () => number;

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(state: number): Rng {
  let a = state >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFromSeed(seed: string): Rng {
  return mulberry32(hashSeed(seed));
}
