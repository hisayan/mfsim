import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFlow, encodeFlow } from "./sim/flow-codec.ts";
import { runInflowSim } from "./sim/inflow.ts";
import {
  KYOTO_NODE_BUILDING_MIX,
  KYOTO_ORIGIN_WEIGHT,
  KYOTO_STATION_NETWORK,
} from "./sim/kyoto-station.ts";

describe("flow-codec", () => {
  it("round-trips inflow output to movers", () => {
    const sim = runInflowSim({
      network: KYOTO_STATION_NETWORK,
      mixes: KYOTO_NODE_BUILDING_MIX,
      originWeight: KYOTO_ORIGIN_WEIGHT,
      ratePerMin: 120,
      durationMin: 2,
      sampleSec: 10,
      seed: "codec-1",
      pulseEveryMin: 0,
    });
    const payload = encodeFlow(sim);
    const json = JSON.parse(JSON.stringify(payload)) as unknown;
    const movers = decodeFlow(json);
    assert.equal(movers.length, sim.agents.length);
    assert.equal(movers[0].id, "kw-00001");
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i];
      const a = sim.agents[i];
      assert.equal(m.times.length, a.s.length);
      assert.equal(m.times[0], sim.t0 + a.departStep * 1000);
      // 始点は経路始点、終点は経路内
      const path = sim.paths[a.path];
      const [x0, y0] = path.points[0];
      assert.ok(Math.abs(m.positions[0].lng - x0) < 1e-6);
      assert.ok(Math.abs(m.positions[0].lat - y0) < 1e-6);
      for (const pos of m.positions) {
        assert.ok(pos.lng > 135.7 && pos.lng < 135.8);
        assert.ok(pos.lat > 34.97 && pos.lat < 35.0);
      }
    }
  });

  it("rejects garbage payloads", () => {
    assert.throws(() => decodeFlow(null), /invalid flow payload/);
    assert.throws(() => decodeFlow({ v: 999 }), /unsupported flow version/);
    assert.throws(
      () => decodeFlow({ v: 1, t0: 0, dur: 60, dt: 10, paths: [], agents: [[[0]]] }),
      /invalid flow agents/,
    );
    assert.throws(
      () =>
        decodeFlow({
          v: 1,
          t0: 0,
          dur: 60,
          dt: 10,
          paths: [[[[135.75, 34.98]], [0], 0]],
          agents: [[5, 0, [0]]],
        }),
      /missing path/,
    );
  });
});
