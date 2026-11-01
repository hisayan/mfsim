// 歩行者エージェントシミュレーション。
//
// 需要: 駅ノードから出発し、PLATEAU 建物属性由来の誘致力に比例して
//   行き先を選択する。各エージェントは最短経路を一定の自由歩行速度で
//   移動しようとする。
// 混雑: 辺ごとの線密度（人/m）に応じて速度が低下する。
// 出力: OGC MF-JSON の MovingFeature 配列。同じ seed からは常に同じ
//   出力が得られるため、(seed, params) がそのまま記録＝再生キーになる。
//
// 車両（バス・タクシー・自動車）は将来 AgentKind と辺の通行可否を
// 拡張して同じ枠組みに載せる。ネットワーク・経路探索は共有する。

import { attractionOf, EMPTY_MIX } from "./attraction.ts";
import { edgeLengthM, haversineM, type WalkEdge, type WalkNetwork } from "./network.ts";
import { rngFromSeed } from "./rand.ts";
import { shortestPath } from "./router.ts";
import { NODE_BUILDING_MIX, YOKOHAMA_NISHI_NETWORK } from "./yokohama-nishi.ts";

export type AgentKind = "pedestrian";

export type SimParams = {
  count: number;
  seed: string;
  startISO?: string;
  durationMin?: number;
  /** 出発をばらつかせる分数。既定は min(20, durationMin - 5) */
  departSpreadMin?: number;
  sampleSec?: number;
};

export type MfMovingFeature = {
  type: "MovingFeature";
  id: string;
  temporalGeometry: {
    type: "MovingPoint";
    datetimes: string[];
    coordinates: [number, number][];
    interpolation: "Linear";
  };
  properties: {
    kind: AgentKind;
    origin: string;
    destination: string;
  };
};

export type SimMeta = {
  source: "pedestrian-sim";
  seed: string;
  count: number;
  network: string;
  timeRange: [string, string];
  sampleSec: number;
  /** 終了時刻までに目的地へ到達した人数 */
  arrived: number;
  /** 全エージェントの平均移動速度（m/s） */
  avgSpeedMps: number;
};

export type SimResult = {
  movers: MfMovingFeature[];
  meta: SimMeta;
};

const DEFAULT_START_ISO = "2026-01-01T08:00:00+09:00";

/** 起点駅の選択重み。乗降人員データが無いためのシナリオ仮定 */
const ORIGIN_WEIGHT: Record<string, number> = {
  "yokohama-st": 0.4,
  "st-west-gate": 0.14,
  "st-east-gate": 0.14,
  "takashimacho-st": 0.05,
  "shin-takashima-st": 0.09,
  "mm-station": 0.18,
};

/** 混雑による減速: 密度 d（人/m）→速度比。線詰まり密度 1.2 人/m */
export const JAM_DENSITY_PER_M = 1.2;
export const MIN_SPEED_FRAC = 0.25;

export function slowdown(densityPerM: number): number {
  return Math.min(1, Math.max(MIN_SPEED_FRAC, 1 - densityPerM / JAM_DENSITY_PER_M));
}

export type Agent = {
  id: string;
  origin: string;
  destination: string;
  departStep: number;
  freeSpeed: number;
  /** 経路形状（[lng, lat]）と各点までの累積距離（m） */
  points: [number, number][];
  cum: number[];
  totalM: number;
  /** 経路上の各点が属する辺 id（points[i]→points[i+1] の区間） */
  segEdge: string[];
  /** 辺ごとの終了距離。占有辺の特定用 */
  legEnds: { edgeId: string; endM: number }[];
};

export function pickWeighted(rng: () => number, entries: [string, number][]): string {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

function buildAgent(
  index: number,
  network: WalkNetwork,
  origins: [string, number][],
  attractions: [string, number][],
  rng: () => number,
  spreadSteps: number,
  edges: Map<string, WalkEdge>,
): Agent {
  const origin = pickWeighted(rng, origins);
  let destination = origin;
  let route = shortestPath(network, origin, destination);
  for (let tries = 0; tries < 25 && (destination === origin || !route || route.lengthM < 1); tries++) {
    destination = pickWeighted(rng, attractions);
    if (destination !== origin) route = shortestPath(network, origin, destination);
  }
  if (!route || route.legs.length === 0) {
    throw new Error(`no route from ${origin} to ${destination}`);
  }
  const points: [number, number][] = [];
  const segEdge: string[] = [];
  const legEnds: { edgeId: string; endM: number }[] = [];
  const cum: number[] = [];
  let dist = 0;
  for (const leg of route.legs) {
    const edge = edges.get(leg.edgeId);
    if (!edge) throw new Error(`unknown edge: ${leg.edgeId}`);
    const shape = leg.forward ? edge.path : [...edge.path].reverse();
    for (let i = 0; i < shape.length; i++) {
      if (points.length > 0 && i === 0) continue;
      const prev = points[points.length - 1];
      const [lng, lat] = shape[i] as [number, number];
      if (prev) dist += haversineM(prev[0], prev[1], lng, lat);
      points.push([lng, lat]);
      cum.push(dist);
      if (prev) segEdge.push(leg.edgeId);
    }
    legEnds.push({ edgeId: leg.edgeId, endM: dist });
  }
  return {
    id: `ped-${String(index + 1).padStart(3, "0")}`,
    origin,
    destination,
    departStep: Math.floor(rng() * (spreadSteps + 1)),
    freeSpeed: 1.1 + rng() * 0.6,
    points,
    cum,
    totalM: dist,
    segEdge,
    legEnds,
  };
}

/** 経路形状上の距離 s（m）における座標。流入シミュレーションの復元でも使う */
export function positionOnPath(
  points: [number, number][],
  cum: number[],
  totalM: number,
  s: number,
): [number, number] {
  const clamped = Math.min(Math.max(s, 0), totalM);
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const c0 = cum[lo];
  const c1 = cum[lo + 1] ?? c0;
  const k = c1 > c0 ? (clamped - c0) / (c1 - c0) : 0;
  const [x0, y0] = points[lo];
  const [x1, y1] = points[lo + 1] ?? points[lo];
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
}

/** 経路距離 s（m）における座標 */
function positionAt(agent: Agent, s: number): [number, number] {
  return positionOnPath(agent.points, agent.cum, agent.totalM, s);
}

/** 経路距離 s（m）が属する辺 id */
export function edgeAt(agent: Agent, s: number): string {
  for (const leg of agent.legEnds) {
    if (s < leg.endM) return leg.edgeId;
  }
  return agent.legEnds[agent.legEnds.length - 1].edgeId;
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

export function runPedestrianSim(params: SimParams): SimResult {
  const count = Math.max(1, Math.floor(params.count));
  const durationMin = Math.max(1, params.durationMin ?? 30);
  const sampleSec = Math.max(1, Math.floor(params.sampleSec ?? 10));
  const spreadMin = Math.min(
    params.departSpreadMin ?? Math.min(20, durationMin - 1),
    Math.max(durationMin - 1, 1),
  );
  const network = YOKOHAMA_NISHI_NETWORK;
  const edges = new Map(network.edges.map((e) => [e.id, e]));
  const edgeLen = new Map<string, number>();
  for (const e of network.edges) {
    edgeLen.set(e.id, edgeLengthM(e));
  }

  const t0 = Date.parse(params.startISO ?? DEFAULT_START_ISO);
  if (Number.isNaN(t0)) throw new Error(`invalid startISO: ${params.startISO}`);
  const totalSteps = Math.round(durationMin * 60);
  const spreadSteps = Math.round(spreadMin * 60);

  const rng = rngFromSeed(params.seed);
  const origins = network.nodes
    .filter((n) => ORIGIN_WEIGHT[n.id] !== undefined)
    .map((n) => [n.id, ORIGIN_WEIGHT[n.id]] as [string, number]);
  const attractions = network.nodes.map(
    (n) => [n.id, attractionOf(NODE_BUILDING_MIX[n.id] ?? EMPTY_MIX)] as [string, number],
  );

  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    agents.push(buildAgent(i, network, origins, attractions, rng, spreadSteps, edges));
  }

  const s = new Array<number>(count).fill(0);
  const arrivedStep = new Array<number>(count).fill(-1);
  const lastRecStep = new Array<number>(count).fill(-1);
  const datetimes: string[][] = agents.map(() => []);
  const coords: [number, number][][] = agents.map(() => []);
  const record = (i: number, step: number) => {
    if (lastRecStep[i] === step) return;
    lastRecStep[i] = step;
    const [lng, lat] = positionAt(agents[i], s[i]);
    datetimes[i].push(new Date(t0 + step * 1000).toISOString());
    coords[i].push([round6(lng), round6(lat)]);
  };

  for (let step = 0; step <= totalSteps; step++) {
    // 占有率（ステップ開始時点の位置から求める。順序非依存で決定的）
    const occ = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      if (step < agents[i].departStep || arrivedStep[i] >= 0) continue;
      const edgeId = edgeAt(agents[i], s[i]);
      occ.set(edgeId, (occ.get(edgeId) ?? 0) + 1);
    }
    for (let i = 0; i < count; i++) {
      const agent = agents[i];
      if (step < agent.departStep || arrivedStep[i] >= 0) continue;
      if (step === agent.departStep) record(i, step);
      const edgeId = edgeAt(agent, s[i]);
      const density = (occ.get(edgeId) ?? 1) / (edgeLen.get(edgeId) ?? 1);
      s[i] += agent.freeSpeed * slowdown(density);
      if (s[i] >= agent.totalM) {
        s[i] = agent.totalM;
        arrivedStep[i] = step;
        record(i, step);
      } else if ((step - agent.departStep) % sampleSec === 0 && step !== agent.departStep) {
        record(i, step);
      }
    }
  }
  // 打ち切り：終了時に移動中の軌跡端を記録
  for (let i = 0; i < count; i++) {
    if (arrivedStep[i] < 0 && totalSteps > agents[i].departStep) record(i, totalSteps);
  }

  let speedSum = 0;
  let arrived = 0;
  for (let i = 0; i < count; i++) {
    const endStep = arrivedStep[i] >= 0 ? arrivedStep[i] : totalSteps;
    const active = Math.max(endStep - agents[i].departStep, 0);
    if (active > 0) speedSum += s[i] / active;
    if (arrivedStep[i] >= 0) arrived++;
  }

  const movers: MfMovingFeature[] = agents.map((agent, i) => ({
    type: "MovingFeature",
    id: agent.id,
    temporalGeometry: {
      type: "MovingPoint",
      datetimes: datetimes[i],
      coordinates: coords[i],
      interpolation: "Linear",
    },
    properties: { kind: "pedestrian" satisfies AgentKind, origin: agent.origin, destination: agent.destination },
  }));

  return {
    movers,
    meta: {
      source: "pedestrian-sim",
      seed: params.seed,
      count,
      network: network.id,
      timeRange: [new Date(t0).toISOString(), new Date(t0 + totalSteps * 1000).toISOString()],
      sampleSec,
      arrived,
      avgSpeedMps: count > 0 ? Math.round((speedSum / count) * 1000) / 1000 : 0,
    },
  };
}
