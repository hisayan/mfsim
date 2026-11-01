// 群衆（InstancedMesh）描画のための座標変換と人型寸法。
//
// navara の geodetic 親フレームは WUN 接平面（単位 m）:
//   X = 西+, Y = 上+, Z = 北+（glTF 規約と一致）。
// 数 km 範囲では接平面近似の誤差は無視できる。

/** この人数を超えたら個別メッシュをやめて Instanced 群衆描画にする */
export const CROWD_MIN_MOVERS = 100;

const EARTH_R_M = 6371000;

/** 基準点 (lng0, lat0) から (lng, lat) への WUN 平面オフセット（m） */
export function wunOffsetM(
  lng0: number,
  lat0: number,
  lng: number,
  lat: number,
): { x: number; z: number } {
  const kx = (Math.cos((lat0 * Math.PI) / 180) * Math.PI * EARTH_R_M) / 180;
  const kz = (Math.PI * EARTH_R_M) / 180;
  return { x: -(lng - lng0) * kx, z: (lat - lat0) * kz };
}

/** 人型の寸法（m）と肌色。胴体＝円柱・頭＝球の2層 Instanced で描く */
export const HUMAN = {
  bodyRadiusTop: 0.32,
  bodyRadiusBottom: 0.38,
  bodyHeight: 1.3,
  /** 胴体中心の高さ（地面から） */
  bodyY: 0.85,
  headRadius: 0.24,
  /** 頭中心の高さ（地面から） */
  headY: 1.75,
  skin: "#ffd9b3",
};

/** 歩行の上下動（m）。tSec: 再生時刻（秒）、phase: 人別の位相 */
export function walkBobM(tSec: number, phase: number): number {
  return 0.06 * Math.sin(((2 * Math.PI) / 0.7) * tSec + phase);
}

/** 2点間の進行方位（北=0・東=90、度）。POV カメラの heading 用 */
export function bearingDeg(fromLng: number, fromLat: number, toLng: number, toLat: number): number {
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
