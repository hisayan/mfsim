// 横浜駅〜みなとみらい の歩行ネットワーク（模式図）。
//
// 座標の出典:
// - 駅ノード: PLATEAU 横浜市 2023 関連データセット station.geojson（西区）の実測座標
// - landmark / queens ノード: 同 CityGML bldg の実測値で同定した
//   ランドマークタワー (14100-bldg-501891, 高さ 296m) と
//   クイーンズタワー (14100-bldg-500689, 高さ 176.6m) の footprint 重心
// - その他: 上記を結ぶ主要歩行動線上の結節点（模式）
//
// PLATEAU tran（道路）は LOD1 面形状のみで中心線が無いため、
// v1 ではトポロジを手定義する。中心線データが使えるようになれば
// このファイルを置き換えるだけで需要・シミュレーションはそのまま動く。

import type { WalkEdge, WalkNetwork, WalkNode } from "./network.ts";
import type { NodeBuildingMix } from "./attraction.ts";

export const YOKOHAMA_NISHI_NETWORK_ID = "yokohama-nishi:v1";

export const YOKOHAMA_NISHI_NODES: WalkNode[] = [
  { id: "yokohama-st", lng: 139.62256, lat: 35.46577, role: "station", name: "横浜駅" },
  { id: "st-west-gate", lng: 139.621, lat: 35.4659, role: "station", name: "横浜駅西口" },
  { id: "st-east-gate", lng: 139.624, lat: 35.466, role: "station", name: "横浜駅東口" },
  { id: "kita-saiwai", lng: 139.6185, lat: 35.4675, role: "junction" },
  { id: "joinus", lng: 139.6195, lat: 35.465, role: "poi", name: "ジョイナス周辺" },
  { id: "minami-saiwai", lng: 139.6225, lat: 35.463, role: "poi", name: "南幸" },
  { id: "bay-quarter", lng: 139.627, lat: 35.4668, role: "poi", name: "ベイクォーター周辺" },
  { id: "sogo", lng: 139.6258, lat: 35.4642, role: "poi", name: "そごう周辺" },
  { id: "takashimacho-st", lng: 139.62366, lat: 35.4587, role: "station", name: "高島町駅" },
  { id: "shin-takashima-st", lng: 139.62649, lat: 35.46196, role: "station", name: "新高島駅" },
  { id: "mm-entrance", lng: 139.6295, lat: 35.4625, role: "junction" },
  { id: "mm-station", lng: 139.6323, lat: 35.45751, role: "station", name: "みなとみらい駅" },
  { id: "queens", lng: 139.63326, lat: 35.45584, role: "poi", name: "クイーンズスクエア周辺" },
  { id: "landmark", lng: 139.63144, lat: 35.45462, role: "poi", name: "ランドマークタワー周辺" },
  { id: "rinko-park", lng: 139.637, lat: 35.4585, role: "poi", name: "臨港パーク" },
];

function edge(id: string, from: string, to: string, via: [number, number][] = []): WalkEdge {
  const a = YOKOHAMA_NISHI_NODES.find((n) => n.id === from);
  const b = YOKOHAMA_NISHI_NODES.find((n) => n.id === to);
  if (!a || !b) throw new Error(`unknown edge endpoints: ${from}-${to}`);
  return { id, from, to, path: [[a.lng, a.lat], ...via, [b.lng, b.lat]] };
}

export const YOKOHAMA_NISHI_EDGES: WalkEdge[] = [
  edge("e01", "yokohama-st", "st-west-gate"),
  edge("e02", "yokohama-st", "st-east-gate"),
  edge("e03", "st-west-gate", "kita-saiwai"),
  edge("e04", "st-west-gate", "joinus"),
  edge("e05", "yokohama-st", "minami-saiwai"),
  edge("e06", "joinus", "minami-saiwai"),
  edge("e07", "st-east-gate", "sogo"),
  edge("e08", "st-east-gate", "bay-quarter"),
  edge("e09", "sogo", "shin-takashima-st"),
  edge("e10", "sogo", "takashimacho-st", [[139.6245, 35.4615]]),
  edge("e11", "minami-saiwai", "takashimacho-st"),
  edge("e12", "takashimacho-st", "shin-takashima-st"),
  edge("e13", "shin-takashima-st", "mm-entrance"),
  edge("e14", "bay-quarter", "mm-entrance", [[139.6285, 35.4645]]),
  edge("e15", "mm-entrance", "mm-station"),
  edge("e16", "mm-station", "queens"),
  edge("e17", "queens", "landmark"),
  edge("e18", "queens", "rinko-park"),
];

export const YOKOHAMA_NISHI_NETWORK: WalkNetwork = {
  id: YOKOHAMA_NISHI_NETWORK_ID,
  nodes: YOKOHAMA_NISHI_NODES,
  edges: YOKOHAMA_NISHI_EDGES,
};

// ノード別・建物集計（PLATEAU 実測値由来）。
// 出典: 国土交通省 Project PLATEAU 横浜市 2023 CityGML bldg（LOD2）
//   12 メッシュ (53391448/49/58/59/68/69, 53391540/41/50/51/60/61) から
//   footprint 1,436 棟を最近傍ノード（300m 以内）に吸着して集計。
//   延床 = footprint × 推定階数（階高 3.2m）。階級の定義は attraction.ts。
// 用途属性はこのデータセットに無いため規模で近似する（同ファイルの注記参照）。
// 再生成: 同 CityGML の bldg メッシュを展開し、各 Building(Part) の
// measuredHeight と lod0FootPrint から重心・面積を求めて吸着し直す。
export const NODE_BUILDING_MIX: Record<string, NodeBuildingMix> = {
  "yokohama-st": { towerM2: 305206, highM2: 142185, midM2: 28262, lowM2: 2229, buildings: 32 },
  "st-west-gate": { towerM2: 280137, highM2: 53480, midM2: 2077, lowM2: 5782, buildings: 25 },
  "st-east-gate": { towerM2: 363893, highM2: 27837, midM2: 29403, lowM2: 1254, buildings: 38 },
  "kita-saiwai": { towerM2: 247376, highM2: 496513, midM2: 90454, lowM2: 12922, buildings: 237 },
  "joinus": { towerM2: 498442, highM2: 148789, midM2: 111352, lowM2: 10229, buildings: 163 },
  "minami-saiwai": { towerM2: 210718, highM2: 249717, midM2: 84224, lowM2: 9365, buildings: 153 },
  "bay-quarter": { towerM2: 485724, highM2: 394312, midM2: 71455, lowM2: 4651, buildings: 69 },
  "sogo": { towerM2: 576671, highM2: 47947, midM2: 330, lowM2: 1304, buildings: 11 },
  "takashimacho-st": { towerM2: 148602, highM2: 325776, midM2: 135362, lowM2: 41258, buildings: 514 },
  "shin-takashima-st": { towerM2: 824873, highM2: 22118, midM2: 17754, lowM2: 3534, buildings: 28 },
  "mm-entrance": { towerM2: 1027836, highM2: 394332, midM2: 107035, lowM2: 6801, buildings: 39 },
  "mm-station": { towerM2: 791794, highM2: 354082, midM2: 16958, lowM2: 4771, buildings: 36 },
  "queens": { towerM2: 642083, highM2: 57507, midM2: 42445, lowM2: 8955, buildings: 39 },
  "landmark": { towerM2: 1320569, highM2: 292237, midM2: 16103, lowM2: 10428, buildings: 33 },
  "rinko-park": { towerM2: 565888, highM2: 71227, midM2: 284381, lowM2: 2595, buildings: 19 },
};
