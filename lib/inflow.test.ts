import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runInflowSim, type InflowParams } from "./sim/inflow.ts";
import {
  KYOTO_NODE_BUILDING_MIX,
  KYOTO_ORIGIN_WEIGHT,
  KYOTO_STATION_EDGES,
  KYOTO_STATION_NETWORK,
  KYOTO_STATION_NODES,
} from "./sim/kyoto-station.ts";

function baseParams(over: Partial<InflowParams> = {}): InflowParams {
  return {
    network: KYOTO_STATION_NETWORK,
    mixes: KYOTO_NODE_BUILDING_MIX,
    originWeight: KYOTO_ORIGIN_WEIGHT,
    ratePerMin: 120,
    durationMin: 2,
    sampleSec: 10,
    seed: "kyoto-test-1",
    pulseEveryMin: 0,
    ...over,
  };
}

describe("kyoto-station network", () => {
  it("has connected edges with sane coordinates", () => {
    assert.equal(KYOTO_STATION_NODES.length, 15);
    assert.equal(KYOTO_STATION_EDGES.length, 20);
    const ids = new Set(KYOTO_STATION_NODES.map((n) => n.id));
    for (const e of KYOTO_STATION_EDGES) {
      assert.ok(ids.has(e.from), `edge ${e.id} from`);
      assert.ok(ids.has(e.to), `edge ${e.id} to`);
      for (const [lng, lat] of e.path) {
        assert.ok(lng > 135.7 && lng < 135.8, `lng ${lng}`);
        assert.ok(lat > 34.97 && lat < 35.0, `lat ${lat}`);
      }
    }
    for (const n of KYOTO_STATION_NODES) {
      assert.ok(KYOTO_NODE_BUILDING_MIX[n.id], `mix ${n.id}`);
    }
    for (const id of Object.keys(KYOTO_ORIGIN_WEIGHT)) {
      assert.ok(ids.has(id), `origin ${id}`);
    }
  });
});

describe("runInflowSim", () => {
  it("is deterministic for the same seed", () => {
    const a = runInflowSim(baseParams());
    const b = runInflowSim(baseParams());
    assert.equal(JSON.stringify(a.agents), JSON.stringify(b.agents));
    assert.deepEqual(a.meta, b.meta);
  });

  it("spawns roughly rate*duration agents without pulses", () => {
    const r = runInflowSim(baseParams());
    // 120/min * 2min = 240 expected; base wave averages ~0.6x-1x
    assert.ok(r.agents.length > 100 && r.agents.length < 300, `spawned ${r.agents.length}`);
    assert.equal(r.meta.capped, false);
    assert.equal(r.meta.spawned, r.agents.length);
  });

  it("creates ebb and flow with pulses", () => {
    const r = runInflowSim(baseParams({ durationMin: 6, pulseEveryMin: 3, pulseSize: 300 }));
    assert.deepEqual(r.meta.pulseSteps, [60, 240]);
    const inPulse = r.agents.filter((a) => a.departStep >= 60 && a.departStep < 150).length;
    const quiet = r.agents.filter((a) => a.departStep >= 180 && a.departStep < 240).length;
    assert.ok(inPulse > quiet * 1.5, `pulse ${inPulse} vs quiet ${quiet}`);
  });

  it("honors maxAgents and reports capped", () => {
    const r = runInflowSim(baseParams({ ratePerMin: 3000, durationMin: 6, maxAgents: 500 }));
    assert.equal(r.agents.length, 500);
    assert.equal(r.meta.capped, true);
  });

  it("emits valid uniform-grid samples within each path", () => {
    const r = runInflowSim(baseParams());
    assert.ok(r.paths.length > 0);
    for (const a of r.agents) {
      const path = r.paths[a.path];
      assert.ok(path, `path ${a.path}`);
      assert.ok(a.departStep >= 0 && a.departStep <= r.totalSteps);
      assert.ok(a.s.length >= 1);
      for (let k = 0; k < a.s.length; k++) {
        assert.ok(a.s[k] >= 0 && a.s[k] <= path.totalM + 1e-9, `s range ${a.s[k]}`);
        if (k > 0) assert.ok(a.s[k] >= a.s[k - 1], "s monotonic");
        assert.ok(a.departStep + k * r.sampleSec <= r.totalSteps, "grid in window");
      }
    }
  });

  it("moves agents toward their destinations", () => {
    const r = runInflowSim(baseParams());
    assert.ok(r.meta.avgSpeedMps > 0.3, `avgSpeed ${r.meta.avgSpeedMps}`);
    assert.ok(r.meta.arrived > 0, "some arrived");
  });
});
