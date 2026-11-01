// 流入型（開放系）の歩行者シミュレーション。
//
// 固定 N 人を流す simulate.ts と違い、時刻ごとに変わる流入率（人/分）で
// エージェントを生成し続ける。列車到着パルス（短時間の大量流入）を重ねる
// ことで、人並みが増えたり減ったりするダイナミックな流れを作る。
// 同じ seed からは常に同じ出力が得られる（決定的）。
//
// 出力は軽量フロー形式（flow-codec.ts で送受信）。等間隔グリッド上の
// 経路距離 s の列だけを持ち、座標は経路形状（共有）と合わせて復元する。

import { attractionOf, EMPTY_MIX, type NodeBuildingMix } from "./attraction.ts";
import { edgeLengthM, haversineM, type WalkEdge, type WalkNetwork } from "./network.ts";
import { rngFromSeed } from "./rand.ts";
import { shortestPath } from "./router.ts";
import {
  JAM_DENSITY_PER_M,
  MIN_SPEED_FRAC,
  edgeAt,
  pickWeighted,
  type Agent,
} from "./simulate.ts";

export type FlowPath = {
  points: [number, number][];
  /** 各点までの累積距離（m） */
  cum: number[];
  totalM: number;
};

export type FlowAgent = {
  id: string;
  origin: string;
  destination: string;
  /** FlowPath の添字 */
  path: number;
  /** 出発ステップ（秒）。時刻は t0 + departStep*1000 */
  departStep: number;
  /** 出発グリッドからの等間隔サンプル。s[d] は departStep+d*sampleSec 時点の経路距離（m） */
  s: number[];
};

export type InflowParams = {
  network: WalkNetwork;
  /** ノード id → 建物集計（行き先の誘致力用）。未定義ノードは微小値 */
  mixes: Record<string, NodeBuildingMix>;
  /** 起点ノード id → 選択重み */
  originWeight: Record<string, number>;
  /** 基準流入率（人/分）。正弦波（平均1.0倍）とパルスで変動する */
  ratePerMin: number;
  /** 時間窓（分） */
  durationMin: number;
  /** 記録グリッド間隔（秒） */
  sampleSec: number;
  seed: string;
  startISO?: string;
  /** 列車到着パルスの間隔（分）。0 で無効 */
  pulseEveryMin?: number;
  /** 1パルスあたりの流入人数 */
  pulseSize?: number;
  /** パルスを分散させる秒数 */
  pulseSpreadSec?: number;
  /** 生成上限。これを超えたら打ち切って capped=true を報告する */
  maxAgents?: number;
  /** 混雑パラメータ。駅前広路は既定より詰まりにくくする */
  jamDensityPerM?: number;
  minSpeedFrac?: number;
};

export type InflowMeta = {
  source: "inflow-sim";
  seed: string;
  network: string;
  spawned: number;
  capped: boolean;
  peakRatePerMin: number;
  avgRatePerMin: number;
  arrived: number;
  avgSpeedMps: number;
  /** パルス開始ステップ（秒）の列。HUD の「到着」表示用 */
  pulseSteps: number[];
  timeRange: [string, string];
  sampleSec: number;
};

export type InflowResult = {
  t0: number;
  totalSteps: number;
  sampleSec: number;
  paths: FlowPath[];
  agents: FlowAgent[];
  meta: InflowMeta;
};

const DEFAULT_START_ISO = "2026-01-01T08:00:00+09:00";

function congestionFactor(densityPerM: number, jam: number, minFrac: number): number {
  return Math.min(1, Math.max(minFrac, 1 - densityPerM / jam));
}

type RouteBuild = {
  points: [number, number][];
  cum: number[];
  totalM: number;
  legEnds: { edgeId: string; endM: number }[];
  key: string;
};

function buildRoute(
  network: WalkNetwork,
  edges: Map<string, WalkEdge>,
  origin: string,
  destination: string,
): RouteBuild | undefined {
  const route = shortestPath(network, origin, destination);
  if (!route || route.legs.length === 0) return undefined;
  const points: [number, number][] = [];
  const cum: number[] = [];
  const legEnds: { edgeId: string; endM: number }[] = [];
  let dist = 0;
  const keyParts: string[] = [];
  for (const leg of route.legs) {
    const edge = edges.get(leg.edgeId);
    if (!edge) throw new Error(`unknown edge: ${leg.edgeId}`);
    keyParts.push(`${leg.forward ? "+" : "-"}${leg.edgeId}`);
    const shape = leg.forward ? edge.path : [...edge.path].reverse();
    for (let i = 0; i < shape.length; i++) {
      if (points.length > 0 && i === 0) continue;
      const prev = points[points.length - 1];
      const [lng, lat] = shape[i] as [number, number];
      if (prev) dist += haversineM(prev[0], prev[1], lng, lat);
      points.push([lng, lat]);
      cum.push(dist);
    }
    legEnds.push({ edgeId: leg.edgeId, endM: dist });
  }
  return { points, cum, totalM: dist, legEnds, key: keyParts.join(",") };
}

export function runInflowSim(params: InflowParams): InflowResult {
  const sampleSec = Math.max(1, Math.floor(params.sampleSec));
  const totalSteps = Math.max(sampleSec, Math.floor((params.durationMin * 60) / sampleSec) * sampleSec);
  const jam = params.jamDensityPerM ?? JAM_DENSITY_PER_M;
  const minFrac = params.minSpeedFrac ?? MIN_SPEED_FRAC;
  const maxAgents = Math.max(1, Math.floor(params.maxAgents ?? 9000));
  const pulseEveryMin = params.pulseEveryMin ?? 3;
  const pulseSize = Math.max(0, Math.floor(params.pulseSize ?? 600));
  const pulseSpreadSec = Math.max(10, Math.floor(params.pulseSpreadSec ?? 90));

  const t0 = Date.parse(params.startISO ?? DEFAULT_START_ISO);
  if (Number.isNaN(t0)) throw new Error(`invalid startISO: ${params.startISO}`);

  const network = params.network;
  const edges = new Map(network.edges.map((e) => [e.id, e]));
  const edgeLen = new Map<string, number>();
  for (const e of network.edges) edgeLen.set(e.id, edgeLengthM(e));

  const rng = rngFromSeed(params.seed);
  const origins = network.nodes
    .filter((n) => params.originWeight[n.id] !== undefined)
    .map((n) => [n.id, params.originWeight[n.id]] as [string, number]);
  if (origins.length === 0) throw new Error("no origin nodes");
  const attractions = network.nodes.map(
    (n) => [n.id, attractionOf(params.mixes[n.id] ?? EMPTY_MIX)] as [string, number],
  );

  // パルス開始ステップ（初回は1分後、終了1分前まで）
  const pulseSteps: number[] = [];
  if (pulseEveryMin > 0 && pulseSize > 0) {
    for (let t = 60; t < totalSteps - 60; t += Math.round(pulseEveryMin * 60)) {
      pulseSteps.push(t);
    }
  }

  const lambdaAt = (step: number): number => {
    const base = (params.ratePerMin / 60) * (1.0 + 0.4 * Math.sin((2 * Math.PI * 2 * step) / totalSteps));
    let pulse = 0;
    for (const p of pulseSteps) {
      if (step >= p && step < p + pulseSpreadSec) pulse += pulseSize / pulseSpreadSec;
    }
    return Math.max(0, base + pulse);
  };

  // 生成スケジュール（決定的）。上限到達で打ち切り。
  const agents: Agent[] = [];
  const agentPath: number[] = [];
  const pathByKey = new Map<string, number>();
  const paths: FlowPath[] = [];
  let capped = false;
  let peakLambda = 0;
  for (let step = 0; step <= totalSteps && !capped; step++) {
    const lambda = lambdaAt(step);
    if (lambda > peakLambda) peakLambda = lambda;
    let n = Math.floor(lambda) + (rng() < lambda - Math.floor(lambda) ? 1 : 0);
    while (n-- > 0) {
      if (agents.length >= maxAgents) {
        capped = true;
        break;
      }
      const origin = pickWeighted(rng, origins);
      let destination = origin;
      let built: RouteBuild | undefined;
      for (let tries = 0; tries < 25 && !built; tries++) {
        destination = pickWeighted(rng, attractions);
        if (destination === origin) continue;
        const rb = buildRoute(network, edges, origin, destination);
        if (rb && rb.totalM >= 1) built = rb;
      }
      if (!built) continue;
      let pathIdx = pathByKey.get(built.key);
      if (pathIdx === undefined) {
        pathIdx = paths.length;
        pathByKey.set(built.key, pathIdx);
        paths.push({ points: built.points, cum: built.cum, totalM: built.totalM });
      }
      agents.push({
        id: `kw-${String(agents.length + 1).padStart(5, "0")}`,
        origin,
        destination,
        departStep: step,
        freeSpeed: 1.1 + rng() * 0.6,
        points: built.points,
        cum: built.cum,
        totalM: built.totalM,
        segEdge: [],
        legEnds: built.legEnds,
      });
      agentPath.push(pathIdx);
    }
  }

  // 移動ステップ（1秒刻み、混雑減速つき）。グリッド上で s を記録する。
  const count = agents.length;
  const s = new Array<number>(count).fill(0);
  const arrivedStep = new Array<number>(count).fill(-1);
  const done = new Array<boolean>(count).fill(false);
  const samples: number[][] = agents.map(() => []);

  for (let step = 0; step <= totalSteps; step++) {
    const occ = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      if (step < agents[i].departStep || arrivedStep[i] >= 0) continue;
      const edgeId = edgeAt(agents[i], s[i]);
      occ.set(edgeId, (occ.get(edgeId) ?? 0) + 1);
    }
    for (let i = 0; i < count; i++) {
      const agent = agents[i];
      if (step < agent.departStep || done[i]) continue;
      const onGrid = (step - agent.departStep) % sampleSec === 0;
      if (step === agent.departStep) samples[i].push(0);
      if (arrivedStep[i] >= 0) {
        // 到達済み：次のグリッドで終端を記録して打ち切り
        if (onGrid && step !== agent.departStep) {
          samples[i].push(agent.totalM);
          done[i] = true;
        }
        continue;
      }
      const edgeId = edgeAt(agent, s[i]);
      const density = (occ.get(edgeId) ?? 1) / (edgeLen.get(edgeId) ?? 1);
      s[i] += agent.freeSpeed * congestionFactor(density, jam, minFrac);
      if (s[i] >= agent.totalM) {
        s[i] = agent.totalM;
        arrivedStep[i] = step;
        if (onGrid && step !== agent.departStep) {
          samples[i].push(s[i]);
          done[i] = true;
        }
      } else if (onGrid && step !== agent.departStep) {
        samples[i].push(s[i]);
      }
    }
  }

  let speedSum = 0;
  let arrived = 0;
  for (let i = 0; i < count; i++) {
    const endStep = arrivedStep[i] >= 0 ? arrivedStep[i] : totalSteps;
    const active = Math.max(endStep - agents[i].departStep, 0);
    if (active > 0) speedSum += s[i] / active;
    if (arrivedStep[i] >= 0) arrived++;
  }

  const flowAgents: FlowAgent[] = agents.map((a, i) => ({
    id: a.id,
    origin: a.origin,
    destination: a.destination,
    path: agentPath[i],
    departStep: a.departStep,
    s: samples[i],
  }));

  return {
    t0,
    totalSteps,
    sampleSec,
    paths,
    agents: flowAgents,
    meta: {
      source: "inflow-sim",
      seed: params.seed,
      network: network.id,
      spawned: count,
      capped,
      peakRatePerMin: Math.round(peakLambda * 60),
      avgRatePerMin: count > 0 && totalSteps > 0 ? Math.round((count / totalSteps) * 60) : 0,
      arrived,
      avgSpeedMps: count > 0 ? Math.round((speedSum / count) * 1000) / 1000 : 0,
      pulseSteps,
      timeRange: [new Date(t0).toISOString(), new Date(t0 + totalSteps * 1000).toISOString()],
      sampleSec,
    },
  };
}
