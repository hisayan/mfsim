// 一人称追従カメラの配置計算。
//
// navara の setCamera height は楕円体高（m）。日本ではジオイド高が約+37m
// あるため、横浜駅前の地面は楕円体高で約+40mになる。絶対高度の定数
// （例: 6m）をそのまま渡すと地下に潜ってしまうので、地形サンプル値に
// 目の高さを足して求める。

import { bearingDeg } from "./crowd.ts";
import { sampleAt, type Mover } from "./mfjson.ts";

/** 地面からの目の高さ（m）。密集時の発光ドット（上端2.4m）の上に抜ける */
export const FOLLOW_EYE_M = 3.2;
/** 自分の体の中心から進行方向へずらす距離（m）。体に埋まらないため */
export const FOLLOW_FORWARD_M = 2.0;
/** 一人称カメラのピッチ（度）。足元と前方の人並みが入るよう見下ろす */
export const FOLLOW_PITCH_DEG = -8;
/** 地形タイル未読込時の地面の楕円体高フォールバック（m）。横浜駅前の想定値 */
export const FOLLOW_FALLBACK_GROUND_M = 40;

export type FollowState = {
  /** 最後に観測した地面の楕円体高（m） */
  groundM: number;
  /** 最後に求めた進行方位（度）。停止中は維持する */
  heading: number;
};

export function createFollowState(): FollowState {
  return { groundM: FOLLOW_FALLBACK_GROUND_M, heading: 0 };
}

const EARTH_R_M = 6371000;

/** (lng, lat) から方位 headingDeg（北=0・東=90）へ distM 進んだ地点 */
export function offsetLngLat(
  lng: number,
  lat: number,
  headingDeg: number,
  distM: number,
): { lng: number; lat: number } {
  const br = (headingDeg * Math.PI) / 180;
  const dLat = ((distM * Math.cos(br)) / EARTH_R_M) * (180 / Math.PI);
  const dLng =
    (((distM * Math.sin(br)) / EARTH_R_M) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180);
  return { lng: lng + dLng, lat: lat + dLat };
}

export type FollowCameraTarget = {
  lng: number;
  lat: number;
  /** 楕円体高（m）。setCamera にそのまま渡せる */
  height: number;
  heading: number;
  pitch: number;
};

/** 時刻 t における追従カメラの配置を求める。state は観測値の保持用に更新する */
export function resolveFollowCamera(
  mover: Mover,
  t: number,
  t1: number,
  sampleTerrain: (lng: number, lat: number) => number | undefined,
  state: FollowState,
): FollowCameraTarget {
  const s0 = sampleAt(mover, t);
  const s1 = sampleAt(mover, Math.min(t + 5000, t1));
  const moved = Math.abs(s1.lng - s0.lng) > 1e-12 || Math.abs(s1.lat - s0.lat) > 1e-12;
  if (moved) state.heading = bearingDeg(s0.lng, s0.lat, s1.lng, s1.lat);
  const ahead = offsetLngLat(s0.lng, s0.lat, state.heading, FOLLOW_FORWARD_M);
  let height: number;
  if (s0.height !== undefined) {
    height = s0.height + FOLLOW_EYE_M;
  } else {
    const ground = sampleTerrain(ahead.lng, ahead.lat);
    if (ground !== undefined) state.groundM = ground;
    height = state.groundM + FOLLOW_EYE_M;
  }
  return { lng: ahead.lng, lat: ahead.lat, height, heading: state.heading, pitch: FOLLOW_PITCH_DEG };
}
