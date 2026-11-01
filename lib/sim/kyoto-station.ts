// 京都駅前 の歩行ネットワーク（模式図）。
//
// 座標の方針:
// - 京都駅中央口 (135.7585, 34.9858) を基準にした駅前約1km四方の模式配置。
//   改札・広場・塔・寺社前の相対位置は実地に合わせているが、測量値ではない。
//   PLATEAU 京都市 2023 の実測で置き換える場合はこのファイルを差し替える。
// - 建物集計 (NODE_BUILDING_MIX) はシナリオ仮定。寺社は建物規模が小さくても
//   行き先として強い誘引を持つため、訪問者規模を反映した仮定値にしている。
//   横浜 (yokohama-nishi.ts) のような CityGML 実測値ではないことに注意。

import type { WalkEdge, WalkNetwork, WalkNode } from "./network.ts";
import type { NodeBuildingMix } from "./attraction.ts";

export const KYOTO_STATION_NETWORK_ID = "kyoto-station:v1";

export const KYOTO_STATION_NODES: WalkNode[] = [
  { id: "kyoto-st", lng: 135.7585, lat: 34.9858, role: "station", name: "京都駅中央口" },
  { id: "shinkansen-gate", lng: 135.7578, lat: 34.985, role: "station", name: "新幹線八条口改札" },
  { id: "kintetsu-gate", lng: 135.7563, lat: 34.9852, role: "station", name: "近鉄改札" },
  { id: "subway-gate", lng: 135.7594, lat: 34.9868, role: "station", name: "地下鉄改札" },
  { id: "bus-terminal", lng: 135.76, lat: 34.9873, role: "station", name: "バスターミナル" },
  { id: "kita-plaza", lng: 135.7588, lat: 34.9863, role: "junction", name: "北口駅前広場" },
  { id: "minami-plaza", lng: 135.7583, lat: 34.9846, role: "junction", name: "南口駅前広場" },
  { id: "kyoto-tower", lng: 135.759, lat: 34.9877, role: "poi", name: "京都タワー" },
  { id: "yodobashi", lng: 135.761, lat: 34.9878, role: "poi", name: "ヨドバシ周辺" },
  { id: "porta", lng: 135.7578, lat: 34.9869, role: "poi", name: "ポルタ" },
  { id: "avanti", lng: 135.7602, lat: 34.9838, role: "poi", name: "アバンティ周辺" },
  { id: "higashi-junction", lng: 135.7618, lat: 34.9892, role: "junction" },
  { id: "higashi-honganji", lng: 135.7628, lat: 34.9908, role: "poi", name: "東本願寺前" },
  { id: "nishi-junction", lng: 135.7555, lat: 34.9883, role: "junction" },
  { id: "nishi-honganji", lng: 135.7536, lat: 34.9912, role: "poi", name: "西本願寺前" },
];

function edge(id: string, from: string, to: string, via: [number, number][] = []): WalkEdge {
  const a = KYOTO_STATION_NODES.find((n) => n.id === from);
  const b = KYOTO_STATION_NODES.find((n) => n.id === to);
  if (!a || !b) throw new Error(`unknown edge endpoints: ${from}-${to}`);
  return { id, from, to, path: [[a.lng, a.lat], ...via, [b.lng, b.lat]] };
}

export const KYOTO_STATION_EDGES: WalkEdge[] = [
  edge("k01", "kyoto-st", "kita-plaza"),
  edge("k02", "kyoto-st", "minami-plaza"),
  edge("k03", "kita-plaza", "subway-gate"),
  edge("k04", "subway-gate", "bus-terminal"),
  edge("k05", "bus-terminal", "kyoto-tower"),
  edge("k06", "kyoto-tower", "yodobashi"),
  edge("k07", "kita-plaza", "porta"),
  edge("k08", "porta", "nishi-junction"),
  edge("k09", "nishi-junction", "nishi-honganji"),
  edge("k10", "subway-gate", "kyoto-tower", [[135.7592, 34.9872]]),
  edge("k11", "yodobashi", "higashi-junction"),
  edge("k12", "higashi-junction", "higashi-honganji"),
  edge("k13", "minami-plaza", "shinkansen-gate"),
  edge("k14", "minami-plaza", "kintetsu-gate"),
  edge("k15", "minami-plaza", "avanti"),
  edge("k16", "shinkansen-gate", "kintetsu-gate"),
  edge("k17", "kintetsu-gate", "avanti", [[135.758, 34.984]]),
  edge("k18", "bus-terminal", "higashi-junction", [[135.761, 34.9885]]),
  edge("k19", "kyoto-st", "subway-gate", [[135.759, 34.9862]]),
  edge("k20", "kyoto-st", "porta", [[135.758, 34.9862]]),
];

export const KYOTO_STATION_NETWORK: WalkNetwork = {
  id: KYOTO_STATION_NETWORK_ID,
  nodes: KYOTO_STATION_NODES,
  edges: KYOTO_STATION_EDGES,
};

// ノード別・建物集計（シナリオ仮定。横浜のような CityGML 実測ではない）。
// 駅・商業集積は大規模、寺社は訪問者誘引として中規模に設定。
export const KYOTO_NODE_BUILDING_MIX: Record<string, NodeBuildingMix> = {
  "kyoto-st": { towerM2: 520000, highM2: 180000, midM2: 40000, lowM2: 3000, buildings: 24 },
  "shinkansen-gate": { towerM2: 120000, highM2: 90000, midM2: 30000, lowM2: 4000, buildings: 18 },
  "kintetsu-gate": { towerM2: 150000, highM2: 110000, midM2: 35000, lowM2: 5000, buildings: 22 },
  "subway-gate": { towerM2: 260000, highM2: 190000, midM2: 60000, lowM2: 8000, buildings: 60 },
  "bus-terminal": { towerM2: 200000, highM2: 150000, midM2: 50000, lowM2: 6000, buildings: 45 },
  "kita-plaza": { towerM2: 80000, highM2: 60000, midM2: 20000, lowM2: 2000, buildings: 8 },
  "minami-plaza": { towerM2: 90000, highM2: 70000, midM2: 25000, lowM2: 3000, buildings: 10 },
  "kyoto-tower": { towerM2: 180000, highM2: 220000, midM2: 70000, lowM2: 9000, buildings: 70 },
  "yodobashi": { towerM2: 240000, highM2: 260000, midM2: 80000, lowM2: 7000, buildings: 65 },
  "porta": { towerM2: 160000, highM2: 140000, midM2: 55000, lowM2: 6000, buildings: 50 },
  "avanti": { towerM2: 140000, highM2: 130000, midM2: 60000, lowM2: 12000, buildings: 80 },
  "higashi-junction": { towerM2: 30000, highM2: 80000, midM2: 90000, lowM2: 25000, buildings: 150 },
  "higashi-honganji": { towerM2: 10000, highM2: 40000, midM2: 120000, lowM2: 30000, buildings: 120 },
  "nishi-junction": { towerM2: 20000, highM2: 70000, midM2: 85000, lowM2: 22000, buildings: 140 },
  "nishi-honganji": { towerM2: 8000, highM2: 35000, midM2: 110000, lowM2: 28000, buildings: 110 },
};

/** 起点改札の選択重み。乗降人員データが無いためのシナリオ仮定 */
export const KYOTO_ORIGIN_WEIGHT: Record<string, number> = {
  "kyoto-st": 0.34,
  "shinkansen-gate": 0.2,
  "kintetsu-gate": 0.1,
  "subway-gate": 0.14,
  "bus-terminal": 0.22,
};
