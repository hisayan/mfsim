import { useEffect, useRef, useState } from "react";
import ThreeView, { Color, type Layer, type LayerDescription, type MeshHandle, type Source } from "@navaramap/three";
import { DefaultPlugin, type DefaultDescriptions } from "@navaramap/three-default-plugin";
import type {
  InstancedCylinderMeshDesc,
  InstancedSphereMeshDesc,
  SphereMeshDesc,
} from "@navaramap/three-default-descs";
import { fetch as apiFetch } from "void/client";
import { getArea, type PlateauTileset, type SimArea } from "../lib/areas";
import { CROWD_MIN_MOVERS, HUMAN, walkBobM, wunOffsetM } from "../lib/crowd";
import {
  createFollowState,
  resolveFollowCamera,
  type FollowState,
} from "../lib/follow-cam";
import { moversTimeRange, parseMovers, sampleAt, type Mover } from "../lib/mfjson";
import { decodeFlow } from "../lib/sim/flow-codec";
import { disposeViewer } from "../lib/viewer-dom";

const MARKER_COLORS = ["#ff5136", "#ffd23f", "#3fd68f", "#4fa8ff", "#ff4fd8"];
const MARKER_RADIUS_M = 12;
const SPEEDS = [1, 4, 10, 60];
const COUNT_OPTIONS = [150, 1000, 3000];
const RATE_OPTIONS = [500, 1500, 3000];
const DEFAULT_COUNT = 150;
const DEFAULT_RATE = 1500;
const KYOTO_AREA_ID = "kyoto-station";
const HUD_BUCKET_MS = 5000;
/** 軌跡レイヤを個別描画する上限。これ以上は歩行NWのみ表示する */
const TRAIL_LIMIT = 24;
const MOVER_LIST_LIMIT = 24;
const NETWORK_COLOR = "#7aa2f7";
const NETWORK_COLOR_CYBER = "#00f0ff";
const CITY_COLOR_CYBER = 0x111a2e;

type RenderStyle = "real" | "cyber";

type MarkerEntry = {
  mover: Mover;
  handle: MeshHandle<SphereMeshDesc>;
  /** 高度なし軌跡は地形準拠＋上空5mに配置する */
  useTerrain: boolean;
};

type CrowdLayer = {
  bodies?: MeshHandle<InstancedCylinderMeshDesc>;
  heads?: MeshHandle<InstancedSphereMeshDesc>;
  /** サイバー表示の発光ドット単層。ある場合は bodies/heads の代わりに使う */
  dots?: MeshHandle<InstancedSphereMeshDesc>;
  anchor: { lng: number; lat: number };
};

type HudData = {
  departMs: Float64Array;
  arriveMs: Float64Array;
  /** 5秒バケットごとの生成数 */
  spawnHist: Uint16Array;
  t0: number;
  /** パルス開始時刻（ms）の列 */
  pulseMs: number[];
};

type Engine = {
  view?: ThreeView<DefaultDescriptions>;
  movers: Mover[];
  markers: MarkerEntry[];
  crowd?: CrowdLayer;
  hud?: HudData;
  /** 歩行ネットワークの表示レイヤ。一人称追従中は外して視界を塞がない */
  network?: { layer: Layer; desc: LayerDescription; hidden: boolean };
  /** 追従対象の足元マーカー（白球）。追従中のみ存在する */
  followRing?: MeshHandle<SphereMeshDesc>;
  /** 追従カメラ近傍で一時非表示中の番号集合 */
  proxHidden?: Set<number>;
  /** ビューのホスト要素（マウント中は使い回す） */
  host?: HTMLElement;
  /** 基本ビュー（照明・地形・航空写真ソース）の準備完了 */
  baseReady?: Promise<void>;
  imagerySource?: Source;
  imageryLayer?: Layer;
  cityLayers?: Layer[];
  citySources?: Source[];
  cityCredits?: { attribution: string; attributionUrl?: string }[];
  networkSource?: Source;
  trails?: Layer[];
  trailSources?: Source[];
  /** 適用済み選択の記録。変わっていない層は作り直さない */
  camArea?: string;
  imgStyle?: string;
  cityKey?: string;
  netKey?: string;
  moversKey?: string;
  t: number;
  t0: number;
  t1: number;
  /** 追従カメラの地形・方位の保持状態 */
  follow: FollowState;
  /** 一人称視点で非表示にしている自分の番号。なしは -1 */
  hiddenIdx: number;
};

/** 歩行ネットワーク表示の切替。追従中は外して足元の線で視界が埋まらないようにする */
function setNetworkVisible(engine: Engine, visible: boolean): void {
  const net = engine.network;
  const view = engine.view;
  if (!net || !view) return;
  if (visible && net.hidden) {
    net.layer = view.addLayer(net.desc);
    net.hidden = false;
  } else if (!visible && !net.hidden) {
    net.layer.delete();
    net.hidden = true;
  }
}

/** 群衆表示を片付ける。カメラ・タイル・ネットワーク層は呼び出し側で条件判断する */
function clearCrowd(engine: Engine): void {
  engine.crowd?.bodies?.delete();
  engine.crowd?.heads?.delete();
  engine.crowd?.dots?.delete();
  engine.crowd = undefined;
  for (const m of engine.markers) m.handle.delete();
  engine.markers = [];
  for (const t of engine.trails ?? []) t.delete();
  engine.trails = [];
  for (const s of engine.trailSources ?? []) s.delete();
  engine.trailSources = [];
  engine.followRing?.delete();
  engine.followRing = undefined;
  engine.proxHidden?.clear();
  engine.proxHidden = undefined;
}

/** 建物タイルセットの帰属表示を現在のエリアに入れ替える */
function updateCityAttribution(engine: Engine, tilesets: PlateauTileset[]): void {
  const attribution = engine.view?.attribution;
  if (!attribution) return;
  if (engine.cityCredits) attribution.remove(engine.cityCredits);
  const credits = tilesets.map((ts) => ({ attribution: ts.attribution, attributionUrl: ts.attributionUrl }));
  engine.cityCredits = credits;
  if (credits.length > 0) attribution.add(credits);
}

/** 追従カメラからこの距離（m）内の群衆を隠す。一人称視界の埋没防止 */
const FOLLOW_CLEAR_M = 9;

function setInstanceScale(engine: Engine, i: number, v: number): void {
  const scale = { x: v, y: v, z: v };
  const crowd = engine.crowd;
  if (crowd) {
    crowd.bodies?.ref.updateAt(i, { scale });
    crowd.heads?.ref.updateAt(i, { scale });
    crowd.dots?.ref.updateAt(i, { scale });
  } else if (i < engine.markers.length) {
    engine.markers[i].handle.update({ visible: v > 0 });
  }
}

/** カメラ近傍の群衆の表示・非表示を更新する（差分のみ操作） */
function updateProximityHidden(engine: Engine, camLng: number, camLat: number, t: number): void {
  let hidden = engine.proxHidden;
  if (!hidden) {
    hidden = new Set();
    engine.proxHidden = hidden;
  }
  const r2 = FOLLOW_CLEAR_M * FOLLOW_CLEAR_M;
  for (let i = 0; i < engine.movers.length; i++) {
    if (i === engine.hiddenIdx) continue;
    const s = sampleAt(engine.movers[i], t);
    const { x, z } = wunOffsetM(camLng, camLat, s.lng, s.lat);
    const near = x * x + z * z < r2;
    if (near === hidden.has(i)) continue;
    if (near) {
      hidden.add(i);
      setInstanceScale(engine, i, 0);
    } else {
      hidden.delete(i);
      setInstanceScale(engine, i, 1);
    }
  }
}

function clearProximityHidden(engine: Engine): void {
  const hidden = engine.proxHidden;
  if (!hidden || hidden.size === 0) return;
  for (const i of hidden) setInstanceScale(engine, i, 1);
  hidden.clear();
}

/** 追従対象の自分の姿を隠す（カメラが体に埋まらないため）。無効な番号は復元のみ */
function setFollowHidden(engine: Engine, idx: number): void {
  const valid = idx >= 0 && idx < engine.movers.length ? idx : -1;
  if (engine.hiddenIdx === valid) return;
  const prev = engine.hiddenIdx;
  engine.hiddenIdx = valid;
  // 復元対象が近傍非表示に残っていたら外す（位置更新のスキップ対象から復帰）
  if (prev >= 0) engine.proxHidden?.delete(prev);
  const crowd = engine.crowd;
  if (crowd) {
    const layers = [crowd.bodies, crowd.heads, crowd.dots];
    if (prev >= 0 && prev < engine.movers.length) {
      for (const layer of layers) layer?.ref.updateAt(prev, { scale: { x: 1, y: 1, z: 1 } });
    }
    if (valid >= 0) {
      for (const layer of layers) layer?.ref.updateAt(valid, { scale: { x: 0, y: 0, z: 0 } });
    }
  } else {
    if (prev >= 0 && prev < engine.markers.length) {
      engine.markers[prev].handle.update({ visible: true });
    }
    if (valid >= 0 && valid < engine.markers.length) {
      engine.markers[valid].handle.update({ visible: false });
    }
  }
}

/** 時刻 t における一人称カメラを配置する。地形面＋目線の高さで地下に潜らない */
function positionFollowCamera(engine: Engine, idx: number, t: number): void {
  setFollowHidden(engine, idx);
  const view = engine.view;
  if (!view || idx < 0 || idx >= engine.movers.length) return;
  const target = resolveFollowCamera(
    engine.movers[idx],
    t,
    engine.t1,
    (lng, lat) => view.sampleTerrainHeight({ lng, lat }),
    engine.follow,
  );
  view.setCamera({
    lng: target.lng,
    lat: target.lat,
    height: target.height,
    heading: target.heading,
    pitch: target.pitch,
  });
  updateProximityHidden(engine, target.lng, target.lat, t);
  const s = sampleAt(engine.movers[idx], t);
  if (!engine.followRing) {
    engine.followRing = view.addMesh<SphereMeshDesc>({
      sphere: {
        radius: 0.7,
        color: new Color().setStyle("#ffffff"),
        emissiveColor: new Color().setStyle("#ffffff"),
        emissiveIntensity: 0.9,
      },
      geodetic:
        s.height !== undefined
          ? { lng: s.lng, lat: s.lat, height: s.height + 0.3 }
          : { lng: s.lng, lat: s.lat, height: 0.4, heightReference: "terrain" },
    });
  }
  engine.followRing.update({
    geodetic:
      s.height !== undefined
        ? { lng: s.lng, lat: s.lat, height: s.height + 0.3 }
        : { lng: s.lng, lat: s.lat, height: 0.4, heightReference: "terrain" },
  });
}

type Props = {
  areas: SimArea[];
  defaultAreaId: string;
};

/** JST の時計表示。シミュレーション開始 08:00 をそのまま読める */
function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--:--";
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(11, 19);
}

/** 群衆レイヤ（人体2層 or 発光ドット単層）を時刻 t に更新する */
function updateCrowdAt(engine: Engine, t: number): void {
  const crowd = engine.crowd;
  if (!crowd) return;
  const tSec = (t - engine.t0) / 1000;
  for (let i = 0; i < engine.movers.length; i++) {
    // 追従対象・近傍非表示は触らない（scale=0 が上書きされないよう）
    if (i === engine.hiddenIdx || engine.proxHidden?.has(i)) continue;
    const s = sampleAt(engine.movers[i], t);
    const { x, z } = wunOffsetM(crowd.anchor.lng, crowd.anchor.lat, s.lng, s.lat);
    if (crowd.dots) {
      const bob = walkBobM(tSec, i * 0.7) * 0.5;
      crowd.dots.ref.updateAt(i, { position: { x, y: 1.0 + bob, z } });
    } else {
      const bob = walkBobM(tSec, i * 0.7);
      crowd.bodies?.ref.updateAt(i, { position: { x, y: HUMAN.bodyY + bob, z } });
      crowd.heads?.ref.updateAt(i, { position: { x, y: HUMAN.headY + bob, z } });
    }
  }
}

/** HUD 用の在圏人数・流入率・パルス表示を求める */
function computeHud(engine: Engine, t: number): { active: number; rate: number; pulse: string } {
  const hud = engine.hud;
  if (!hud) return { active: 0, rate: 0, pulse: "" };
  let active = 0;
  for (let i = 0; i < hud.departMs.length; i++) {
    if (hud.departMs[i] <= t && t < hud.arriveMs[i]) active++;
  }
  const bucket = Math.floor((t - hud.t0) / HUD_BUCKET_MS);
  const spawned = bucket >= 0 && bucket < hud.spawnHist.length ? hud.spawnHist[bucket] : 0;
  const rate = Math.round((spawned / (HUD_BUCKET_MS / 1000)) * 60);
  const inPulse = hud.pulseMs.some((p) => Math.abs(t - p) < 45000);
  return { active, rate, pulse: inPulse ? "新幹線到着 — 降車客が流入中" : "" };
}

function buildHudData(engine: Engine, movers: Mover[], pulseSteps: number[]): void {
  const n = movers.length;
  const departMs = new Float64Array(n);
  const arriveMs = new Float64Array(n);
  const buckets = Math.max(1, Math.ceil((engine.t1 - engine.t0) / HUD_BUCKET_MS));
  const spawnHist = new Uint16Array(buckets);
  for (let i = 0; i < n; i++) {
    const m = movers[i];
    departMs[i] = m.times[0];
    arriveMs[i] = m.times[m.times.length - 1];
    const b = Math.floor((m.times[0] - engine.t0) / HUD_BUCKET_MS);
    if (b >= 0 && b < buckets) spawnHist[b]++;
  }
  engine.hud = { departMs, arriveMs, spawnHist, t0: engine.t0, pulseMs: pulseSteps.map((p) => engine.t0 + p * 1000) };
}

export default function MfViewer({ areas, defaultAreaId }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>({
    movers: [],
    markers: [],
    t: 0,
    t0: 0,
    t1: 0,
    follow: createFollowState(),
    hiddenIdx: -1,
  });
  const playingRef = useRef(true);
  const speedRef = useRef(defaultAreaId === KYOTO_AREA_ID ? 10 : 1);
  const followRef = useRef(-1);

  const [areaId, setAreaId] = useState(defaultAreaId);
  const [count, setCount] = useState(defaultAreaId === KYOTO_AREA_ID ? DEFAULT_RATE : DEFAULT_COUNT);
  const [style, setStyle] = useState<RenderStyle>(defaultAreaId === KYOTO_AREA_ID ? "cyber" : "real");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(defaultAreaId === KYOTO_AREA_ID ? 10 : 1);
  const [clockMs, setClockMs] = useState(0);
  const [range, setRange] = useState<[number, number] | undefined>(undefined);
  const [moverIds, setMoverIds] = useState<string[]>([]);
  const [simInfo, setSimInfo] = useState("");
  const [followIdx, setFollowIdx] = useState(-1);
  const [hudActive, setHudActive] = useState(0);
  const [hudRate, setHudRate] = useState(0);
  const [hudPulse, setHudPulse] = useState("");

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    followRef.current = followIdx;
  }, [followIdx]);

  // 追従の切り替え直後にカメラを動かす（一時停止中も即座に一人称視点へ）。
  // 再生中の追従は tick 側で毎フレーム更新する。
  useEffect(() => {
    const engine = engineRef.current;
    setNetworkVisible(engine, followIdx < 0);
    if (!engine.view || engine.movers.length === 0) return;
    if (followIdx < 0) {
      setFollowHidden(engine, -1);
      engine.followRing?.delete();
      engine.followRing = undefined;
      clearProximityHidden(engine);
      // 追従解除：エリアの俯瞰カメラに戻す（路上の目線に置き去りにしない）
      const area = getArea(areaId);
      engine.view.setCamera({
        lng: area.camera.lng,
        lat: area.camera.lat,
        distance: area.camera.distance,
        heading: area.camera.heading,
        pitch: area.camera.pitch,
        roll: area.camera.roll,
      });
      return;
    }
    positionFollowCamera(engine, followIdx, engine.t);
  }, [followIdx]);

  useEffect(() => {
    const area = getArea(areaId);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const engine = engineRef.current;
    const isKyoto = area.id === KYOTO_AREA_ID;
    const moversKeyNew = isKyoto ? `flow:${area.id}:${count}` : `mf:${area.id}:${count}`;
    // 移動体が変わらない切替（画風のみ）では追従・時刻・データを継承する
    const willChangeMovers = engine.moversKey !== moversKeyNew;
    // 選択切替ではビューを作り直さない。変わる層だけ入れ替える
    // （navara は2重起動不可のため使い回しが必須）。
    if (willChangeMovers) {
      engine.movers = [];
      engine.hud = undefined;
      engine.follow = createFollowState();
      engine.hiddenIdx = -1;
    }
    let cancelled = false;
    let raf = 0;
    let lastFrame = 0;
    let lastUiSync = 0;
    let baseOk = false;

    setStatus("loading");
    setErrorMsg("");
    if (willChangeMovers) {
      setRange(undefined);
      setMoverIds([]);
      setSimInfo("");
      setFollowIdx(-1);
      setHudActive(0);
      setHudRate(0);
      setHudPulse("");
    }

    const applyCrowdTime = (t: number) => {
      updateCrowdAt(engine, t);
    };

    const applyMarkersTime = (t: number) => {
      for (let i = 0; i < engine.markers.length; i++) {
        // 追従対象・近傍非表示は触らない（visible=false が上書きされないよう）
        if (i === engine.hiddenIdx || engine.proxHidden?.has(i)) continue;
        const m = engine.markers[i];
        const s = sampleAt(m.mover, t);
        m.handle.update({
          geodetic: m.useTerrain
            ? { lng: s.lng, lat: s.lat }
            : { lng: s.lng, lat: s.lat, height: s.height ?? 0 },
        });
      }
    };

    const applyTime = (t: number) => {
      if (engine.crowd) applyCrowdTime(t);
      else applyMarkersTime(t);
    };

    const applyFollowCamera = (t: number) => {
      positionFollowCamera(engine, followRef.current, t);
    };

    const syncHudNow = (t: number) => {
      const h = computeHud(engine, t);
      setHudActive(h.active);
      setHudRate(h.rate);
      setHudPulse(h.pulse);
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const dt = lastFrame ? now - lastFrame : 0;
      lastFrame = now;
      if (playingRef.current && engine.t1 > engine.t0) {
        engine.t += dt * speedRef.current;
        if (engine.t > engine.t1) engine.t = engine.t0;
        applyTime(engine.t);
        if (followRef.current >= 0) applyFollowCamera(engine.t);
        if (now - lastUiSync > 120) {
          lastUiSync = now;
          setClockMs(engine.t);
          syncHudNow(engine.t);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const boot = async () => {
      if (!engine.baseReady) {
        engine.baseReady = (async () => {
          const host = wrapRef.current;
          if (!host) throw new Error("viewer host is gone");
          const container = document.createElement("div");
          container.className = "mfviewer-map";
          container.setAttribute("role", "application");
          container.setAttribute("aria-label", "3D city model viewer");
          host.appendChild(container);
          engine.host = container;
          // Keep wheel gestures over the map from scrolling the page. The listener
          // only calls preventDefault so navara's own zoom handling still runs.
          container.addEventListener(
            "wheel",
            (e: WheelEvent) => {
              e.preventDefault();
            },
            { passive: false },
          );
          const view = new ThreeView<DefaultDescriptions>({
            container,
            shadow: true,
            // ⓘと帰属ポップオーバーを左下に寄せて右下の時計・速度と干渉させない
            defaultAttribution: { position: "bottom-left" },
          });
          engine.view = view;
          const defaultPlugin = new DefaultPlugin();
          view.addPlugin(defaultPlugin);
          await view.init();
          view.addLight({ ambient: { intensity: 0.6 } });
          view.addLight({ sun: { intensity: 2, applyColor: true } });
          const terrain = view.addSource({
            type: "quantized-mesh",
            url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
            maxZoom: 18,
            requestVertexNormals: true,
            requestWaterMask: true,
          });
          view.addLayer({ type: "terrain", source: terrain });
          engine.imagerySource = view.addSource({
            type: "raster-tile",
            url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
            maxZoom: 18,
          });
          view.attribution?.add([
            { attribution: "© Re:Earth Terrain", attributionUrl: "https://terrain.reearth.land/" },
            {
              attribution: "Geospatial Information Authority of Japan Tiles - Latest Nationwide Photo (Seamless)",
              attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
            },
          ]);
        })();
      }
      await engine.baseReady;
      if (cancelled) return;
      const view = engine.view;
      if (!view || !engine.imagerySource) return;
      baseOk = true;
      // 前回の群衆表示を片付けて新しい選択を適用する
      clearCrowd(engine);
      if (cancelled) return;

      if (engine.camArea !== area.id) {
        engine.camArea = area.id;
        view.setCamera({
          lng: area.camera.lng,
          lat: area.camera.lat,
          distance: area.camera.distance,
          heading: area.camera.heading,
          pitch: area.camera.pitch,
          roll: area.camera.roll,
        });
      }

      if (engine.imgStyle !== style) {
        engine.imgStyle = style;
        engine.imageryLayer?.delete();
        engine.imageryLayer = view.addLayer(
          style === "cyber"
            ? { type: "raster", source: engine.imagerySource, raster: { opacity: 0.6 } }
            : { type: "raster", source: engine.imagerySource },
        );
      }

      const cityKeyNew = `${area.id}:${style}`;
      if (engine.cityKey !== cityKeyNew) {
        engine.cityKey = cityKeyNew;
        for (const l of engine.cityLayers ?? []) l.delete();
        engine.cityLayers = [];
        for (const s of engine.citySources ?? []) s.delete();
        engine.citySources = [];
        const cityColor = style === "cyber" ? CITY_COLOR_CYBER : 0xffffff;
        for (const ts of area.tilesets) {
          const src = view.addSource({ type: "3d-tiles", url: ts.url });
          engine.citySources.push(src);
          engine.cityLayers.push(
            view.addLayer({
              type: "3d-tiles",
              source: src,
              model: { color: new Color().setHex(cityColor), metalness: 0, roughness: 1 },
            }),
          );
        }
        updateCityAttribution(engine, area.tilesets);
      }

      const netKeyNew = `${area.id}:${style}`;
      const netChanged = engine.netKey !== netKeyNew;
      const moversReq = isKyoto
        ? apiFetch("/api/flow", { query: { area: area.id, ratePerMin: count } })
        : apiFetch("/api/moving-features", {
            query: { area: area.id, count, sampleSec: count >= 1000 ? 30 : 10 },
          });
      const [res, netRes] = await Promise.all([
        willChangeMovers ? moversReq : Promise.resolve(null),
        netChanged ? apiFetch("/api/walk-network", { query: { area: area.id } }) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      if (netRes) {
        engine.netKey = netKeyNew;
        if (engine.network && !engine.network.hidden) engine.network.layer.delete();
        engine.network = undefined;
        engine.networkSource?.delete();
        engine.networkSource = undefined;
      }
      if (netRes && netRes.geojson.features.length > 0) {
        const network = view.addSource({
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: netRes.geojson.features.map((f) => ({
              type: "Feature",
              geometry: { type: "LineString", coordinates: f.geometry.coordinates },
              properties: { ...f.properties },
            })),
          },
        });
        engine.networkSource = network;
        const networkDesc: LayerDescription = {
          type: "vector",
          source: network,
          polyline: {
            color: new Color().setStyle(style === "cyber" ? NETWORK_COLOR_CYBER : NETWORK_COLOR),
            width: 2,
            clampToGround: true,
          },
        };
        engine.network = { layer: view.addLayer(networkDesc), desc: networkDesc, hidden: false };
        // 追従を継続している場合は作り直した線も隠す
        if (followRef.current >= 0) setNetworkVisible(engine, false);
      }

      if (willChangeMovers && res) {
        const fresh = isKyoto
          ? decodeFlow((res as unknown as { flow: unknown }).flow)
          : parseMovers((res as unknown as { movers: unknown }).movers);
        engine.movers = fresh;
        engine.moversKey = moversKeyNew;
        const meta = (res as unknown as {
          meta: { source: string; seed?: string; avgRatePerMin?: number; pulseSteps?: number[] };
        }).meta;
        if (meta.source === "pedestrian-sim" && meta.seed) {
          setSimInfo(` · seed ${meta.seed}`);
        } else if (meta.source === "inflow-sim" && meta.seed && meta.avgRatePerMin !== undefined) {
          setSimInfo(` · seed ${meta.seed} · 平均${meta.avgRatePerMin}/分`);
        } else {
          setSimInfo("");
        }

        const timeRange = moversTimeRange(fresh);
        if (timeRange) {
          engine.t0 = timeRange[0];
          engine.t1 = timeRange[1];
          engine.t = timeRange[0];
          setRange(timeRange);
        }
        buildHudData(engine, fresh, meta.pulseSteps ?? []);
        setMoverIds(fresh.map((m) => m.id));
      }
      const movers = engine.movers;

      if (movers.length > CROWD_MIN_MOVERS) {
        const anchor = { lng: area.camera.lng, lat: area.camera.lat };
        const cyber = style === "cyber";
        const at0 = engine.t;
        if (cyber) {
          const dots = view.addMesh<InstancedSphereMeshDesc>({
            spheres: {
              widthSegments: 10,
              heightSegments: 8,
              color: new Color().setStyle("#0a2a33"),
              emissiveColor: new Color().setStyle("#00f0ff"),
              emissiveIntensity: 1.2,
              children: movers.map((mover) => {
                const s = sampleAt(mover, at0);
                const { x, z } = wunOffsetM(anchor.lng, anchor.lat, s.lng, s.lat);
                return { position: { x, y: 1.0, z }, radius: 1.2 };
              }),
            },
            geodetic: { lng: anchor.lng, lat: anchor.lat, height: 0, heightReference: "terrain" },
          });
          engine.crowd = { dots, anchor };
        } else {
        const bodies = view.addMesh<InstancedCylinderMeshDesc>({
          cylinders: {
            radiusTop: HUMAN.bodyRadiusTop,
            radiusBottom: HUMAN.bodyRadiusBottom,
            radialSegments: 10,
            color: new Color().setStyle(cyber ? "#062a33" : "#ffffff"),
            emissiveColor: new Color().setStyle(cyber ? "#00f0ff" : "#ffffff"),
            emissiveIntensity: cyber ? 1.0 : 0.1,
            children: movers.map((mover, i) => {
              const s = sampleAt(mover, at0);
              const { x, z } = wunOffsetM(anchor.lng, anchor.lat, s.lng, s.lat);
              return {
                position: { x, y: HUMAN.bodyY, z },
                radius: 1,
                height: 1,
                ...(cyber
                  ? {}
                  : { color: new Color().setStyle(MARKER_COLORS[i % MARKER_COLORS.length]) }),
              };
            }),
          },
          geodetic: { lng: anchor.lng, lat: anchor.lat, height: 0, heightReference: "terrain" },
        });
        const heads = view.addMesh<InstancedSphereMeshDesc>({
          spheres: {
            widthSegments: 12,
            heightSegments: 8,
            color: new Color().setStyle(cyber ? "#062a33" : "#ffffff"),
            emissiveColor: new Color().setStyle(cyber ? "#00f0ff" : "#ffffff"),
            emissiveIntensity: cyber ? 1.0 : 0.1,
            children: movers.map((mover, i) => {
              const s = sampleAt(mover, at0);
              const { x, z } = wunOffsetM(anchor.lng, anchor.lat, s.lng, s.lat);
              return {
                position: { x, y: HUMAN.headY, z },
                radius: HUMAN.headRadius,
                ...(cyber ? {} : { color: new Color().setStyle(HUMAN.skin) }),
              };
            }),
          },
          geodetic: { lng: anchor.lng, lat: anchor.lat, height: 0, heightReference: "terrain" },
        });
        engine.crowd = { bodies, heads, anchor };
        }
      } else {
        const markerRadius =
          movers.length > 100 ? 3 : movers.length > 20 ? 6 : MARKER_RADIUS_M;
        const showTrails = movers.length <= TRAIL_LIMIT;
        movers.forEach((mover, i) => {
          const styleColor = MARKER_COLORS[i % MARKER_COLORS.length];
          const color = new Color().setStyle(styleColor);
          if (showTrails) {
            const trail = view.addSource({
              type: "geojson",
              data: {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: mover.positions.map((p) =>
                    p.height !== undefined ? [p.lng, p.lat, p.height] : [p.lng, p.lat],
                  ),
                },
                properties: {},
              },
            });
            (engine.trailSources ??= []).push(trail);
            (engine.trails ??= []).push(
              view.addLayer({
                type: "vector",
                source: trail,
                polyline: { color, width: 3, clampToGround: true },
              }),
            );
          }
          const first = mover.positions[0];
          const useTerrain = first.height === undefined;
          const handle = view.addMesh<SphereMeshDesc>({
            sphere: {
              radius: markerRadius,
              color,
              emissiveColor: color,
              emissiveIntensity: 0.6,
            },
            geodetic: useTerrain
              ? { lng: first.lng, lat: first.lat, height: 5, heightReference: "terrain" }
              : { lng: first.lng, lat: first.lat, height: first.height ?? 0 },
          });
          engine.markers.push({ mover, handle, useTerrain });
        });
      }

      applyTime(engine.t);
      setClockMs(engine.t);
      syncHudNow(engine.t);
      setMoverIds(movers.map((m) => m.id));
      setStatus("ready");
      raf = requestAnimationFrame(tick);
    };

    boot().catch((err: unknown) => {
      if (cancelled) return;
      if (!baseOk) {
        // 基本ビューが壊れていたら捨てて次回の作り直しに任せる
        engine.baseReady = undefined;
        if (engine.host) {
          disposeViewer(engine.view, engine.host);
          engine.host.remove();
        }
        engine.view = undefined;
        engine.host = undefined;
      }
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [areaId, count, style]);

  // アンマウント時のみ現役ビューを破棄する（切替時は次回の入れ替えに任せる）
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (engine.host) {
        disposeViewer(engine.view, engine.host);
        engine.host.remove();
      }
      engine.view = undefined;
      engine.host = undefined;
    };
  }, []);

  const onScrub = (value: number) => {
    const engine = engineRef.current;
    // スクラブしたら一時停止する（終端で留まれる。再生再開でループ継続）
    setPlaying(false);
    engine.t = value;
    if (engine.crowd) {
      updateCrowdAt(engine, value);
    } else {
      for (const m of engine.markers) {
        const s = sampleAt(m.mover, value);
        m.handle.update({
          geodetic: m.useTerrain
            ? { lng: s.lng, lat: s.lat }
            : { lng: s.lng, lat: s.lat, height: s.height ?? 0 },
        });
      }
    }
    positionFollowCamera(engine, followRef.current, value);
    setClockMs(value);
    const h = computeHud(engine, value);
    setHudActive(h.active);
    setHudRate(h.rate);
    setHudPulse(h.pulse);
  };

  const resetView = () => {
    const engine = engineRef.current;
    if (!engine.view) return;
    const area = getArea(areaId);
    engine.view.setCamera({
      lng: area.camera.lng,
      lat: area.camera.lat,
      distance: area.camera.distance,
      heading: area.camera.heading,
      pitch: area.camera.pitch,
      roll: area.camera.roll,
    });
  };

  const stepFollow = (dir: 1 | -1) => {
    setFollowIdx((prev) => {
      const n = moverIds.length;
      if (n === 0) return -1;
      const next = prev < 0 ? (dir === 1 ? 0 : n - 1) : (prev + dir + n) % n;
      return next;
    });
  };

  return (
    <div className="mfviewer">
      <div className="mfviewer-toolbar">
        <label className="mfviewer-field">
          Area
          <select
            value={areaId}
            onChange={(e) => {
              const id = e.target.value;
              setAreaId(id);
              setCount(id === KYOTO_AREA_ID ? DEFAULT_RATE : DEFAULT_COUNT);
            }}
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mfviewer-field">
          {areaId === KYOTO_AREA_ID ? "Flow/min" : "People"}
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {(areaId === KYOTO_AREA_ID ? RATE_OPTIONS : COUNT_OPTIONS).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="mfviewer-field">
          Style
          <select value={style} onChange={(e) => setStyle(e.target.value as RenderStyle)}>
            <option value="real">リアル</option>
            <option value="cyber">サイバー</option>
          </select>
        </label>
        <span className="mfviewer-meta">
          {status === "loading" && "Loading map…"}
          {status === "ready" &&
            (moverIds.length === 0 ? "人流データ未対応エリア" : `${moverIds.length} movers${simInfo}`)}
          {status === "error" && `Error: ${errorMsg}`}
        </span>
      </div>
      <div className="mfviewer-mapwrap" ref={wrapRef}>
        {status === "loading" && (
          <div className="mfviewer-veil" role="status" aria-label="読み込み中">
            <div className="mfviewer-veil-spinner" aria-hidden="true" />
            <div>3D都市と人流を読込中…</div>
          </div>
        )}
        {status === "ready" && moverIds.length > 0 && (
          <div className="mfviewer-hud" aria-hidden="true">
            <div className="mfviewer-hud-row">
              <span>在圏</span>
              <strong>{hudActive.toLocaleString("ja-JP")}人</strong>
            </div>
            <div className="mfviewer-hud-row">
              <span>流入</span>
              <strong>{hudRate.toLocaleString("ja-JP")}/分</strong>
            </div>
            {hudPulse && <div className="mfviewer-hud-pulse">{hudPulse}</div>}
          </div>
        )}
      </div>
      <div className="mfviewer-controls">
        <button type="button" onClick={() => setPlaying((p) => !p)} disabled={range === undefined}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          className="mfviewer-slider"
          min={range?.[0] ?? 0}
          max={range?.[1] ?? 0}
          step={1000}
          value={range ? clockMs : 0}
          disabled={range === undefined}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Playback time"
        />
        <span className="mfviewer-clock">{formatClock(clockMs)} JST</span>
        <label className="mfviewer-field">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mfviewer-follow">
        <button type="button" onClick={() => stepFollow(-1)} disabled={moverIds.length === 0}>
          ◀
        </button>
        <button
          type="button"
          onClick={() => setFollowIdx((prev) => (prev >= 0 ? -1 : 0))}
          disabled={moverIds.length === 0}
        >
          {followIdx >= 0 ? `追従中: ${moverIds[followIdx]}` : "一人称視点で追う"}
        </button>
        <button type="button" onClick={() => stepFollow(1)} disabled={moverIds.length === 0}>
          ▶
        </button>
        <button type="button" onClick={resetView} disabled={status !== "ready"}>
          視点を戻す
        </button>
      </div>
      {moverIds.length > 0 && !(style === "cyber" && moverIds.length > CROWD_MIN_MOVERS) && (
        <ul className="mfviewer-movers">
          {moverIds.slice(0, MOVER_LIST_LIMIT).map((id, i) => (
            <li key={id}>
              <span
                className="mfviewer-swatch"
                style={{ backgroundColor: MARKER_COLORS[i % MARKER_COLORS.length] }}
              />
              {id}
            </li>
          ))}
          {moverIds.length > MOVER_LIST_LIMIT && <li>+{moverIds.length - MOVER_LIST_LIMIT} more</li>}
        </ul>
      )}
    </div>
  );
}
