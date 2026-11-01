// 歩行ネットワーク上の最短経路探索（ダイクストラ法）。
// 辺重みは距離。混雑による所要時間の変化は移動シミュレーション側で扱い、
// 経路選択自体の再計算（動的配分）は将来の拡張点とする。

import { edgeLengthM, type WalkNetwork } from "./network.ts";

export type RouteLeg = {
  edgeId: string;
  /** 進行方向が辺定義の from→to と一致するか */
  forward: boolean;
  lengthM: number;
};

export type Route = {
  nodes: string[];
  legs: RouteLeg[];
  lengthM: number;
};

/** from→to の最短経路。from==to は空路、非連結は undefined */
export function shortestPath(
  network: WalkNetwork,
  from: string,
  to: string,
): Route | undefined {
  if (from === to) return { nodes: [from], legs: [], lengthM: 0 };
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edgeId: string; forward: boolean; lengthM: number }>();
  const settled = new Set<string>();
  dist.set(from, 0);

  for (;;) {
    let current: string | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const [id, d] of dist) {
      if (!settled.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === undefined) return undefined;
    if (current === to) break;
    settled.add(current);
    for (const edge of network.edges) {
      let next: string | undefined;
      let forward = true;
      if (edge.from === current) {
        next = edge.to;
      } else if (edge.to === current) {
        next = edge.from;
        forward = false;
      } else {
        continue;
      }
      if (settled.has(next)) continue;
      const lengthM = edgeLengthM(edge);
      const nd = best + lengthM;
      if (nd < (dist.get(next) ?? Number.POSITIVE_INFINITY)) {
        dist.set(next, nd);
        prev.set(next, { node: current, edgeId: edge.id, forward, lengthM });
      }
    }
  }

  const nodes: string[] = [to];
  const legs: RouteLeg[] = [];
  let cursor = to;
  while (cursor !== from) {
    const p = prev.get(cursor);
    if (!p) return undefined;
    nodes.unshift(p.node);
    legs.unshift({ edgeId: p.edgeId, forward: p.forward, lengthM: p.lengthM });
    cursor = p.node;
  }
  return { nodes, legs, lengthM: legs.reduce((s, l) => s + l.lengthM, 0) };
}
