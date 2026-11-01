import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bearingDeg, HUMAN, walkBobM, wunOffsetM } from "./crowd.ts";

describe("wunOffsetM", () => {
  it("converts degrees to meters on the WUN tangent plane", () => {
    // 北へ 0.001° ≒ 111m（Z+）、東へ 0.001° ≒ 91m（X は西+なので負）
    const n = wunOffsetM(139.62, 35.46, 139.62, 35.461);
    assert.ok(Math.abs(n.x) < 0.01);
    assert.ok(Math.abs(n.z - 111.2) < 0.5);
    const e = wunOffsetM(139.62, 35.46, 139.621, 35.46);
    assert.ok(Math.abs(e.x + 91.0) < 0.5);
    assert.ok(Math.abs(e.z) < 0.01);
  });

  it("returns zero at the anchor", () => {
    assert.deepEqual(wunOffsetM(139.62, 35.46, 139.62, 35.46), { x: -0, z: 0 });
  });
});

describe("HUMAN", () => {
  it("stacks head above body", () => {
    assert.ok(HUMAN.headY - HUMAN.headRadius > HUMAN.bodyY + HUMAN.bodyHeight / 2 - 0.3);
    assert.ok(HUMAN.bodyY - HUMAN.bodyHeight / 2 > 0);
  });
});

describe("walkBobM", () => {
  it("stays within a few centimeters and varies with phase", () => {
    for (const t of [0, 0.1, 0.35, 1, 10]) {
      assert.ok(Math.abs(walkBobM(t, 0)) <= 0.061);
    }
    assert.notEqual(walkBobM(0.1, 0), walkBobM(0.1, 2));
  });
});

describe("bearingDeg", () => {
  it("measures clockwise from north", () => {
    assert.ok(Math.abs(bearingDeg(139.62, 35.46, 139.62, 35.461) - 0) < 0.01);
    assert.ok(Math.abs(bearingDeg(139.62, 35.46, 139.621, 35.46) - 90) < 0.5);
    assert.ok(Math.abs(bearingDeg(139.62, 35.46, 139.62, 35.459) - 180) < 0.01);
  });
});
