import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moversTimeRange, parseMovers } from "./mfjson.ts";
import { attractionOf, EMPTY_MIX, floorProxyM2, sizeClassOf } from "./sim/attraction.ts";
import { edgeLengthM, type WalkNetwork } from "./sim/network.ts";
import { shortestPath } from "./sim/router.ts";
import { runPedestrianSim, slowdown } from "./sim/simulate.ts";
import {
  NODE_BUILDING_MIX,
  YOKOHAMA_NISHI_EDGES,
  YOKOHAMA_NISHI_NETWORK,
  YOKOHAMA_NISHI_NODES,
} from "./sim/yokohama-nishi.ts";

describe("shortestPath", () => {
  // A -91m- B
  // |          |
  // 556m      111m
  // |          |
  // C -~450m- D : A→D は A-B-D が最短
  const diamond: WalkNetwork = {
    id: "test",
    nodes: [
      { id: "A", lng: 139.0, lat: 35.0, role: "junction" },
      { id: "B", lng: 139.001, lat: 35.0, role: "junction" },
      { id: "C", lng: 139.0, lat: 35.005, role: "junction" },
      { id: "D", lng: 139.001, lat: 35.001, role: "junction" },
    ],
    edges: [
      { id: "ab", from: "A", to: "B", path: [[139.0, 35.0], [139.001, 35.0]] },
      { id: "ac", from: "A", to: "C", path: [[139.0, 35.0], [139.0, 35.005]] },
      { id: "bd", from: "B", to: "D", path: [[139.001, 35.0], [139.001, 35.001]] },
      { id: "cd", from: "C", to: "D", path: [[139.0, 35.005], [139.001, 35.001]] },
    ],
  };

  it("picks the shorter of two routes", () => {
    const route = shortestPath(diamond, "A", "D");
    assert.ok(route);
    assert.deepEqual(route.nodes, ["A", "B", "D"]);
    assert.ok(route.lengthM > 150 && route.lengthM < 250);
  });

  it("returns an empty route for identical endpoints", () => {
    assert.deepEqual(shortestPath(diamond, "A", "A"), { nodes: ["A"], legs: [], lengthM: 0 });
  });

  it("returns undefined when disconnected", () => {
    const cut: WalkNetwork = { ...diamond, edges: diamond.edges.filter((e) => e.id !== "ab" && e.id !== "ac") };
    assert.equal(shortestPath(cut, "A", "D"), undefined);
  });
});

describe("yokohama-nishi network", () => {
  it("has positive edge lengths and known endpoints", () => {
    const ids = new Set(YOKOHAMA_NISHI_NODES.map((n) => n.id));
    for (const e of YOKOHAMA_NISHI_EDGES) {
      assert.ok(ids.has(e.from), e.id);
      assert.ok(ids.has(e.to), e.id);
      assert.ok(edgeLengthM(e) > 10, e.id);
    }
  });

  it("connects every station to every node", () => {
    const stations = YOKOHAMA_NISHI_NODES.filter((n) => n.role === "station");
    assert.ok(stations.length > 0);
    for (const s of stations) {
      for (const n of YOKOHAMA_NISHI_NODES) {
        assert.ok(shortestPath(YOKOHAMA_NISHI_NETWORK, s.id, n.id), `${s.id} -> ${n.id}`);
      }
    }
  });

  it("has a PLATEAU building mix for every node", () => {
    for (const n of YOKOHAMA_NISHI_NODES) {
      const mix = NODE_BUILDING_MIX[n.id];
      assert.ok(mix, n.id);
      assert.ok(mix.buildings > 0, n.id);
    }
  });
});

describe("attraction", () => {
  it("classifies by height", () => {
    assert.equal(sizeClassOf(296), "tower");
    assert.equal(sizeClassOf(60), "tower");
    assert.equal(sizeClassOf(59.9), "high");
    assert.equal(sizeClassOf(10), "mid");
    assert.equal(sizeClassOf(9.9), "low");
    assert.equal(sizeClassOf(undefined), "low");
  });

  it("estimates floor area from footprint and height", () => {
    assert.equal(floorProxyM2(100, 32), 1000);
    assert.equal(floorProxyM2(100, undefined), 200);
  });

  it("weights towers above houses and empty nodes last", () => {
    const tower = attractionOf({ ...EMPTY_MIX, towerM2: 1000, buildings: 1 });
    const house = attractionOf({ ...EMPTY_MIX, lowM2: 1000, buildings: 10 });
    assert.ok(tower > house);
    assert.ok(house > attractionOf(EMPTY_MIX));
    // 実測集計：ランドマーク周辺が最大級の誘致力を持つ
    assert.ok(attractionOf(NODE_BUILDING_MIX["landmark"]) > attractionOf(NODE_BUILDING_MIX["kita-saiwai"]));
  });
});

describe("slowdown", () => {
  it("is 1 at zero density and floored at high density", () => {
    assert.equal(slowdown(0), 1);
    assert.equal(slowdown(0.6), 0.5);
    assert.equal(slowdown(100), 0.25);
  });
});

describe("runPedestrianSim", () => {
  const params = { count: 25, seed: "test-seed", durationMin: 10, sampleSec: 5 };

  it("emits MF-JSON movers parseable by the viewer pipeline", () => {
    const { movers, meta } = runPedestrianSim(params);
    assert.equal(movers.length, 25);
    assert.equal(meta.source, "pedestrian-sim");
    assert.equal(meta.count, 25);
    const parsed = parseMovers(movers);
    assert.equal(parsed.length, 25);
    for (const m of parsed) {
      assert.ok(m.times.length >= 2, m.id);
      for (let i = 1; i < m.times.length; i++) {
        assert.ok(m.times[i] > m.times[i - 1], m.id);
      }
    }
    assert.ok(moversTimeRange(parsed));
    assert.equal(movers[0].properties.kind, "pedestrian");
  });

  it("is deterministic for the same seed and varies by seed", () => {
    const a = JSON.stringify(runPedestrianSim(params).movers);
    const b = JSON.stringify(runPedestrianSim(params).movers);
    assert.equal(a, b);
    const c = JSON.stringify(runPedestrianSim({ ...params, seed: "other-seed" }).movers);
    assert.notEqual(a, c);
  });

  it("keeps average speed within free-speed bounds", () => {
    const { meta } = runPedestrianSim({ ...params, count: 100 });
    assert.ok(meta.avgSpeedMps > 0);
    assert.ok(meta.avgSpeedMps <= 1.7);
    assert.ok(meta.arrived >= 0 && meta.arrived <= 100);
  });
});
