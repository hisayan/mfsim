import { useEffect, useRef, useState } from "react";
import ThreeView, { Color, type MeshHandle } from "@navaramap/three";
import { DefaultPlugin, type DefaultDescriptions } from "@navaramap/three-default-plugin";
import type { SphereMeshDesc } from "@navaramap/three-default-descs";
import { fetch as apiFetch } from "void/client";
import { getArea, type SimArea } from "../lib/areas";
import { moversTimeRange, parseMovers, sampleAt, type Mover } from "../lib/mfjson";
import { disposeViewer } from "../lib/viewer-dom";

const MARKER_COLORS = ["#ff5136", "#ffd23f", "#3fd68f", "#4fa8ff", "#ff4fd8"];
const MARKER_RADIUS_M = 12;
const SPEEDS = [1, 4, 10, 60];

type MarkerEntry = {
  mover: Mover;
  handle: MeshHandle<SphereMeshDesc>;
  /** 高度なし軌跡は地形準拠＋上空5mに配置する */
  useTerrain: boolean;
};

type Engine = {
  view?: ThreeView<DefaultDescriptions>;
  markers: MarkerEntry[];
  t: number;
  t0: number;
  t1: number;
};

type Props = {
  areas: SimArea[];
  defaultAreaId: string;
};

function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--:--";
  return `${new Date(ms).toISOString().slice(11, 19)}Z`;
}

export default function MfViewer({ areas, defaultAreaId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>({ markers: [], t: 0, t0: 0, t1: 0 });
  const playingRef = useRef(true);
  const speedRef = useRef(1);

  const [areaId, setAreaId] = useState(defaultAreaId);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [clockMs, setClockMs] = useState(0);
  const [range, setRange] = useState<[number, number] | undefined>(undefined);
  const [moverIds, setMoverIds] = useState<string[]>([]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const area = getArea(areaId);
    const container = containerRef.current;
    if (!container) return;
    const engine = engineRef.current;
    engine.markers = [];
    let cancelled = false;
    let raf = 0;
    let lastFrame = 0;
    let lastUiSync = 0;

    setStatus("loading");
    setErrorMsg("");
    setRange(undefined);
    setMoverIds([]);

    const applyTime = (t: number) => {
      for (const m of engine.markers) {
        const s = sampleAt(m.mover, t);
        m.handle.update({
          geodetic: m.useTerrain
            ? { lng: s.lng, lat: s.lat }
            : { lng: s.lng, lat: s.lat, height: s.height ?? 0 },
        });
      }
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const dt = lastFrame ? now - lastFrame : 0;
      lastFrame = now;
      if (playingRef.current && engine.t1 > engine.t0) {
        engine.t += dt * speedRef.current;
        if (engine.t > engine.t1) engine.t = engine.t0;
        applyTime(engine.t);
        if (now - lastUiSync > 120) {
          lastUiSync = now;
          setClockMs(engine.t);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const boot = async () => {
      const view = new ThreeView<DefaultDescriptions>({ container, shadow: true });
      engine.view = view;
      const defaultPlugin = new DefaultPlugin();
      view.addPlugin(defaultPlugin);
      await view.init();
      if (cancelled) return;

      view.addLight({ ambient: { intensity: 0.6 } });
      view.addLight({ sun: { intensity: 2, applyColor: true } });

      view.setCamera({
        lng: area.camera.lng,
        lat: area.camera.lat,
        distance: area.camera.distance,
        heading: area.camera.heading,
        pitch: area.camera.pitch,
        roll: area.camera.roll,
      });

      const terrain = view.addSource({
        type: "quantized-mesh",
        url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
        maxZoom: 18,
        requestVertexNormals: true,
        requestWaterMask: true,
      });
      view.addLayer({ type: "terrain", source: terrain });

      const imagery = view.addSource({
        type: "raster-tile",
        url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
        maxZoom: 18,
      });
      view.addLayer({ type: "raster", source: imagery });

      for (const ts of area.tilesets) {
        const src = view.addSource({ type: "3d-tiles", url: ts.url });
        view.addLayer({
          type: "3d-tiles",
          source: src,
          model: { color: new Color().setHex(0xffffff), metalness: 0, roughness: 1 },
        });
        view.attribution?.add([{ attribution: ts.attribution, attributionUrl: ts.attributionUrl }]);
      }
      view.attribution?.add([
        { attribution: "© Re:Earth Terrain", attributionUrl: "https://terrain.reearth.land/" },
        {
          attribution: "Geospatial Information Authority of Japan Tiles - Latest Nationwide Photo (Seamless)",
          attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
        },
      ]);

      const res = await apiFetch("/api/moving-features", { query: { area: area.id } });
      if (cancelled) return;
      const movers = parseMovers(res.movers);
      movers.forEach((mover, i) => {
        const style = MARKER_COLORS[i % MARKER_COLORS.length];
        const color = new Color().setStyle(style);
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
        view.addLayer({
          type: "vector",
          source: trail,
          polyline: { color, width: 3, clampToGround: true },
        });
        const first = mover.positions[0];
        const useTerrain = first.height === undefined;
        const handle = view.addMesh<SphereMeshDesc>({
          sphere: {
            radius: MARKER_RADIUS_M,
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

      const timeRange = moversTimeRange(movers);
      if (timeRange) {
        engine.t0 = timeRange[0];
        engine.t1 = timeRange[1];
        engine.t = timeRange[0];
        applyTime(engine.t);
        setRange(timeRange);
        setClockMs(engine.t);
      }
      setMoverIds(movers.map((m) => m.id));
      setStatus("ready");
      raf = requestAnimationFrame(tick);
    };

    boot().catch((err: unknown) => {
      if (cancelled) return;
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      disposeViewer(engine.view, container);
      engine.view = undefined;
      engine.markers = [];
    };
  }, [areaId]);

  const onScrub = (value: number) => {
    const engine = engineRef.current;
    engine.t = value;
    for (const m of engine.markers) {
      const s = sampleAt(m.mover, value);
      m.handle.update({
        geodetic: m.useTerrain
          ? { lng: s.lng, lat: s.lat }
          : { lng: s.lng, lat: s.lat, height: s.height ?? 0 },
      });
    }
    setClockMs(value);
  };

  return (
    <div className="mfviewer">
      <div className="mfviewer-toolbar">
        <label className="mfviewer-field">
          Area
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <span className="mfviewer-meta">
          {status === "loading" && "Loading map…"}
          {status === "ready" && `${moverIds.length} movers`}
          {status === "error" && `Error: ${errorMsg}`}
        </span>
      </div>
      <div className="mfviewer-map" ref={containerRef} role="application" aria-label="3D city model viewer" />
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
        <span className="mfviewer-clock">{formatClock(clockMs)}</span>
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
      {moverIds.length > 0 && (
        <ul className="mfviewer-movers">
          {moverIds.map((id, i) => (
            <li key={id}>
              <span
                className="mfviewer-swatch"
                style={{ backgroundColor: MARKER_COLORS[i % MARKER_COLORS.length] }}
              />
              {id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
