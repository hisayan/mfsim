// 軽量フロー転送形式（v1）。
//
// MF-JSON は1点ごとに ISO 時刻＋経緯度を持つため、万人規模では数MB〜
// 十数MB になる。フロー形式は等間隔グリッド＋共有経路＋経路距離 s の列
// だけを送り、座標は受信側で復元する。ID は連番から再生成できるため送らない。

import type { Mover } from "../mfjson.ts";
import { positionOnPath } from "./simulate.ts";
import type { FlowAgent, FlowPath, InflowMeta, InflowResult } from "./inflow.ts";

export const FLOW_CODEC_VERSION = 1;

export type FlowPayloadPath = [points: [number, number][], cum: number[], totalM: number];

export type FlowPayloadAgent = [path: number, departStep: number, sDeciM: number[]];

export type FlowPayload = {
  v: number;
  /** 開始時刻（UNIXミリ秒） */
  t0: number;
  /** 時間窓（秒） */
  dur: number;
  /** 記録グリッド間隔（秒） */
  dt: number;
  paths: FlowPayloadPath[];
  agents: FlowPayloadAgent[];
  meta: InflowMeta;
};

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const round1 = (v: number): number => Math.round(v * 10) / 10;

function encodePath(p: FlowPath): FlowPayloadPath {
  return [p.points.map(([lng, lat]) => [round6(lng), round6(lat)] as [number, number]), p.cum.map(round1), round1(p.totalM)];
}

function encodeAgent(a: FlowAgent): FlowPayloadAgent {
  return [a.path, a.departStep, a.s.map((v) => Math.round(v * 10))];
}

/** InflowResult → 送信用ペイロード */
export function encodeFlow(result: InflowResult): FlowPayload {
  return {
    v: FLOW_CODEC_VERSION,
    t0: result.t0,
    dur: result.totalSteps,
    dt: result.sampleSec,
    paths: result.paths.map(encodePath),
    agents: result.agents.map(encodeAgent),
    meta: result.meta,
  };
}

function isPayloadPath(p: unknown): p is FlowPayloadPath {
  if (!Array.isArray(p) || p.length !== 3) return false;
  const [points, cum, totalM] = p as [unknown, unknown, unknown];
  if (!Array.isArray(points) || points.length === 0 || !Array.isArray(cum)) return false;
  if (typeof totalM !== "number" || !Number.isFinite(totalM)) return false;
  if (cum.length !== points.length) return false;
  return points.every(
    (pt) =>
      Array.isArray(pt) &&
      pt.length === 2 &&
      typeof pt[0] === "number" &&
      typeof pt[1] === "number" &&
      Number.isFinite(pt[0]) &&
      Number.isFinite(pt[1]),
  );
}

function isPayloadAgent(a: unknown): a is FlowPayloadAgent {
  if (!Array.isArray(a) || a.length !== 3) return false;
  const [path, departStep, s] = a as [unknown, unknown, unknown];
  if (typeof path !== "number" || !Number.isInteger(path) || path < 0) return false;
  if (typeof departStep !== "number" || !Number.isInteger(departStep) || departStep < 0) return false;
  return Array.isArray(s) && s.length > 0 && s.every((v) => typeof v === "number" && Number.isFinite(v));
}

/** 送信用ペイロード → Mover[]（ID は kw-00001 からの連番で再生成する） */
export function decodeFlow(payload: unknown): Mover[] {
  if (typeof payload !== "object" || payload === null) throw new Error("invalid flow payload");
  const p = payload as Record<string, unknown>;
  if (p["v"] !== FLOW_CODEC_VERSION) throw new Error(`unsupported flow version: ${String(p["v"])}`);
  const { t0, dur, dt, paths, agents } = p as {
    t0: unknown;
    dur: unknown;
    dt: unknown;
    paths: unknown;
    agents: unknown;
  };
  if (typeof t0 !== "number" || !Number.isFinite(t0)) throw new Error("invalid flow t0");
  if (typeof dur !== "number" || dur <= 0) throw new Error("invalid flow dur");
  if (typeof dt !== "number" || dt <= 0) throw new Error("invalid flow dt");
  if (!Array.isArray(paths) || !paths.every(isPayloadPath)) throw new Error("invalid flow paths");
  if (!Array.isArray(agents) || !agents.every(isPayloadAgent)) throw new Error("invalid flow agents");

  return agents.map((a, i) => {
    const [pathIdx, departStep, sDeciM] = a;
    const path = paths[pathIdx];
    if (!path) throw new Error(`flow agent references missing path: ${pathIdx}`);
    const [points, cum, totalM] = path;
    const times = sDeciM.map((_, k) => t0 + (departStep + k * dt) * 1000);
    const positions = sDeciM.map((s) => {
      const [lng, lat] = positionOnPath(points, cum, totalM, s / 10);
      return { lng, lat };
    });
    return {
      id: `kw-${String(i + 1).padStart(5, "0")}`,
      times,
      positions,
      interpolation: "linear" as const,
    };
  });
}
