// OGC Moving Features JSON (OGC 19-045r3) の MovingPoint サブセットを扱う。
// 対応する符号化:
//   1. プリズム符号化の TemporalGeometry: { type: "MovingPoint", datetimes, coordinates, interpolation }
//   2. MovingFeature ラッパ: { type: "MovingFeature", id, temporalGeometry: {...} }
//   3. トラジェクトリ符号化 (GeoJSON): LineString ジオメトリ + properties.datetimes
// いずれも単体・配列・FeatureCollection のいずれでも受け付ける。

export type MfPosition = {
  lng: number;
  lat: number;
  /** 楕円体高（メートル）。入力に高度が無い場合は undefined */
  height?: number;
};

export type MfInterpolation = "linear" | "step" | "discrete";

export type Mover = {
  id: string;
  /** 時刻（UNIXミリ秒、昇順）と対応する位置 */
  times: number[];
  positions: MfPosition[];
  interpolation: MfInterpolation;
};

export type SampleAt = MfPosition & { visible: boolean };

function toMillis(t: unknown): number | undefined {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function toPosition(c: unknown): MfPosition | undefined {
  if (!Array.isArray(c) || c.length < 2) return undefined;
  const [lng, lat, height] = c as [unknown, unknown, unknown];
  if (typeof lng !== "number" || typeof lat !== "number") return undefined;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  const pos: MfPosition = { lng, lat };
  if (typeof height === "number" && Number.isFinite(height)) pos.height = height;
  return pos;
}

function toInterpolation(v: unknown): MfInterpolation {
  const name =
    typeof v === "string" ? v : typeof v === "object" && v !== null && "type" in v ? String((v as { type: unknown }).type) : "";
  const n = name.trim().toLowerCase();
  if (n === "step" || n === "stepwise") return "step";
  if (n === "discrete") return "discrete";
  return "linear";
}

/** 1件分の TemporalGeometry (MovingPoint) を Mover に変換する。解釈できない場合は undefined */
function fromTemporalGeometry(obj: Record<string, unknown>, fallbackId: string): Mover | undefined {
  const type = obj["type"];
  if (type !== "MovingPoint") return undefined;
  const datetimes = obj["datetimes"];
  const coordinates = obj["coordinates"];
  if (!Array.isArray(datetimes) || !Array.isArray(coordinates)) return undefined;
  if (datetimes.length !== coordinates.length || datetimes.length === 0) return undefined;
  const times: number[] = [];
  const positions: MfPosition[] = [];
  for (let i = 0; i < datetimes.length; i++) {
    const ms = toMillis(datetimes[i]);
    const pos = toPosition(coordinates[i]);
    if (ms === undefined || pos === undefined) return undefined;
    times.push(ms);
    positions.push(pos);
  }
  const id = typeof obj["id"] === "string" && obj["id"] ? (obj["id"] as string) : fallbackId;
  return { id, times, positions, interpolation: toInterpolation(obj["interpolation"]) };
}

/** GeoJSON トラジェクトリ符号化の Feature を Mover に変換する */
function fromTrajectoryFeature(obj: Record<string, unknown>, fallbackId: string): Mover | undefined {
  if (obj["type"] !== "Feature") return undefined;
  const geometry = obj["geometry"];
  const properties = obj["properties"];
  if (typeof geometry !== "object" || geometry === null) return undefined;
  if (typeof properties !== "object" || properties === null) return undefined;
  const g = geometry as Record<string, unknown>;
  const p = properties as Record<string, unknown>;
  const datetimes = p["datetimes"];
  if (!Array.isArray(datetimes) || datetimes.length === 0) return undefined;
  let coordinates: unknown[];
  if (g["type"] === "LineString" && Array.isArray(g["coordinates"])) {
    coordinates = g["coordinates"] as unknown[];
  } else if (g["type"] === "Point" && Array.isArray(g["coordinates"]) && datetimes.length === 1) {
    coordinates = [g["coordinates"]];
  } else {
    return undefined;
  }
  if (datetimes.length !== coordinates.length) return undefined;
  const times: number[] = [];
  const positions: MfPosition[] = [];
  for (let i = 0; i < datetimes.length; i++) {
    const ms = toMillis(datetimes[i]);
    const pos = toPosition(coordinates[i]);
    if (ms === undefined || pos === undefined) return undefined;
    times.push(ms);
    positions.push(pos);
  }
  const rawId = obj["id"] ?? p["id"] ?? p["name"];
  const id = typeof rawId === "string" && rawId ? rawId : fallbackId;
  return { id, times, positions, interpolation: toInterpolation(p["interpolation"]) };
}

function fromUnknown(obj: unknown, index: number): Mover | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const o = obj as Record<string, unknown>;
  // MovingFeature ラッパ
  if (o["type"] === "MovingFeature" && typeof o["temporalGeometry"] === "object" && o["temporalGeometry"] !== null) {
    const inner = o["temporalGeometry"] as Record<string, unknown>;
    if (typeof o["id"] === "string" && inner["id"] === undefined) inner["id"] = o["id"];
    return fromTemporalGeometry(inner, `mover-${index + 1}`);
  }
  return fromTemporalGeometry(o, `mover-${index + 1}`) ?? fromTrajectoryFeature(o, `mover-${index + 1}`);
}

/** MF-JSON ドキュメントを Mover 配列に変換する。1件も解釈できない場合は空配列 */
export function parseMovers(doc: unknown): Mover[] {
  const movers: Mover[] = [];
  const items: unknown[] =
    Array.isArray(doc)
      ? doc
      : typeof doc === "object" && doc !== null && (doc as { type?: unknown }).type === "FeatureCollection"
        ? (Array.isArray((doc as { features?: unknown }).features) ? (doc as { features: unknown[] }).features : [])
        : [doc];
  items.forEach((item, i) => {
    const m = fromUnknown(item, i);
    if (m) movers.push(m);
  });
  return movers;
}

/** 全 Mover に共通する再生区間 [開始, 終了]（UNIXミリ秒）。空の場合は undefined */
export function moversTimeRange(movers: Mover[]): [number, number] | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const m of movers) {
    if (m.times.length === 0) continue;
    min = Math.min(min, m.times[0]);
    max = Math.max(max, m.times[m.times.length - 1]);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return [min, max];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 時刻 t（UNIXミリ秒）における Mover の位置を求める */
export function sampleAt(mover: Mover, t: number): SampleAt {
  const { times, positions } = mover;
  const first = { ...positions[0], visible: true };
  const last = { ...positions[positions.length - 1], visible: true };
  if (t <= times[0]) return first;
  if (t >= times[times.length - 1]) return last;
  let i = 0;
  while (i + 1 < times.length && times[i + 1] < t) i++;
  const t0 = times[i];
  const t1 = times[i + 1];
  const p0 = positions[i];
  const p1 = positions[i + 1];
  if (mover.interpolation === "step") return { ...p0, visible: true };
  if (mover.interpolation === "discrete") {
    return { ...(t - t0 <= t1 - t ? p0 : p1), visible: true };
  }
  const span = t1 - t0;
  const k = span <= 0 ? 0 : (t - t0) / span;
  const height =
    p0.height !== undefined || p1.height !== undefined
      ? lerp(p0.height ?? 0, p1.height ?? 0, k)
      : undefined;
  return { lng: lerp(p0.lng, p1.lng, k), lat: lerp(p0.lat, p1.lat, k), height, visible: true };
}
