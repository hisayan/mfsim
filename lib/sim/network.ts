// 歩行ネットワークの型と地理ユーティリティ。
// 車両（バス・タクシー・自動車）も将来このグラフを共有する想定で、
// 歩行者専用の重みは持たせず純粋なトポロジ＋形状に留める。

export type WalkNodeRole = "station" | "poi" | "junction";

export type WalkNode = {
  id: string;
  lng: number;
  lat: number;
  role: WalkNodeRole;
  /** 表示名（駅名など。PLATEAU 関連データセット由来の場合は分かるよう注記する） */
  name?: string;
};

export type WalkEdge = {
  id: string;
  from: string;
  to: string;
  /** from→to 方向の経路形状 [lng, lat]。両方向通行 */
  path: [number, number][];
};

export type WalkNetwork = {
  id: string;
  nodes: WalkNode[];
  edges: WalkEdge[];
};

const EARTH_R_M = 6371000;

export function haversineM(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * sLng * sLng;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 辺の全長（メートル） */
export function edgeLengthM(edge: WalkEdge): number {
  let total = 0;
  for (let i = 1; i < edge.path.length; i++) {
    const [aLng, aLat] = edge.path[i - 1];
    const [bLng, bLat] = edge.path[i];
    total += haversineM(aLng, aLat, bLng, bLat);
  }
  return total;
}

export function nodeById(network: WalkNetwork, id: string): WalkNode {
  const node = network.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`unknown walk node: ${id}`);
  return node;
}
