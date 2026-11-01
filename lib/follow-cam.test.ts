import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FOLLOW_EYE_M,
  FOLLOW_FALLBACK_GROUND_M,
  FOLLOW_FORWARD_M,
  FOLLOW_PITCH_DEG,
  createFollowState,
  offsetLngLat,
  resolveFollowCamera,
} from "./follow-cam.ts";
import type { Mover } from "./mfjson.ts";
import { wunOffsetM } from "./crowd.ts";

const T0 = Date.parse("2026-01-01T08:00:00+09:00");
const T1 = T0 + 10 * 60 * 1000;

function mover2D(from: [number, number], to: [number, number]): Mover {
  return {
    id: "m1",
    times: [T0, T1],
    positions: [
      { lng: from[0], lat: from[1] },
      { lng: to[0], lat: to[1] },
    ],
    interpolation: "linear",
  };
}

describe("offsetLngLat", () => {
  it("moves north and east by meters", () => {
    const n = offsetLngLat(139.62, 35.46, 0, 111.2);
    assert.ok(Math.abs(n.lng - 139.62) < 1e-9);
    assert.ok(Math.abs(n.lat - 35.461) < 2e-6);
    const e = offsetLngLat(139.62, 35.46, 90, 91.0);
    // 群衆描画の接平面換算と往復して一致する（X は西+なので -91m）
    const back = wunOffsetM(139.62, 35.46, e.lng, e.lat);
    assert.ok(Math.abs(back.x + 91.0) < 0.05);
    assert.ok(Math.abs(back.z) < 0.05);
  });
});

describe("resolveFollowCamera", () => {
  it("places the camera above the terrain, ahead of the mover", () => {
    const mover = mover2D([139.62, 35.46], [139.63, 35.46]);
    const state = createFollowState();
    const target = resolveFollowCamera(mover, T0, T1, () => 41.5, state);
    // 東向きなのでカメラは東へ FOLLOW_FORWARD_M ずれる
    assert.ok(target.lng > 139.62);
    assert.ok(Math.abs(target.lat - 35.46) < 1e-9);
    assert.ok(Math.abs(target.heading - 90) < 0.5);
    assert.equal(target.pitch, FOLLOW_PITCH_DEG);
    assert.ok(Math.abs(target.height - (41.5 + FOLLOW_EYE_M)) < 1e-9);
    // 観測した地面高を保持する
    assert.equal(state.groundM, 41.5);
  });

  it("keeps the camera out of the ground when terrain tiles are not loaded", () => {
    const mover = mover2D([139.62, 35.46], [139.63, 35.46]);
    const state = createFollowState();
    const target = resolveFollowCamera(mover, T0, T1, () => undefined, state);
    // 旧実装の絶対高度 6m（地下）ではなくフォールバック＋目線になる
    assert.ok(target.height > 30);
    assert.ok(Math.abs(target.height - (FOLLOW_FALLBACK_GROUND_M + FOLLOW_EYE_M)) < 1e-9);
  });

  it("prefers the mover's own ellipsoid height when present", () => {
    const mover: Mover = {
      id: "m2",
      times: [T0, T1],
      positions: [
        { lng: 139.62, lat: 35.46, height: 100 },
        { lng: 139.63, lat: 35.46, height: 100 },
      ],
      interpolation: "linear",
    };
    const state = createFollowState();
    const target = resolveFollowCamera(mover, T0, T1, () => 41.5, state);
    assert.ok(Math.abs(target.height - (100 + FOLLOW_EYE_M)) < 1e-9);
  });

  it("keeps the last heading while the mover is stopped", () => {
    const mover = mover2D([139.62, 35.46], [139.63, 35.46]);
    const state = createFollowState();
    const first = resolveFollowCamera(mover, T0, T1, () => 41.5, state);
    assert.ok(Math.abs(first.heading - 90) < 0.5);
    // 終端で停止しても直前の方位をそのまま維持する（北へ跳ばない）
    const stopped = resolveFollowCamera(mover, T1, T1, () => 41.5, state);
    assert.equal(stopped.heading, first.heading);
    // 前方オフセットは維持した方位で付く
    assert.ok(stopped.lng > 139.63 - FOLLOW_FORWARD_M / 90000);
  });
});
