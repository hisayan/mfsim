// PLATEAU 建物属性（measuredHeight・footprint）から求める誘致力。
//
// 横浜市 2023 bldg に建物用途の属性は無いため、規模（延床プロキシ）と
// 高さ階級で誘致力を近似する。都心部の高層棟は商業・業務の複合用途が
// 大半という実態に基づくヒューリスティックで、用途属性が使える
// データセットでは用途係数に置き換える。

export type SizeClass = "tower" | "high" | "mid" | "low";

export const SIZE_CLASS_OF_HEIGHT: { min: number; cls: SizeClass }[] = [
  { min: 60, cls: "tower" },
  { min: 30, cls: "high" },
  { min: 10, cls: "mid" },
  { min: 0, cls: "low" },
];

/** 高さ（m）→規模階級。高さ不明は低層扱い */
export function sizeClassOf(heightM: number | undefined): SizeClass {
  const h = heightM ?? 0;
  for (const row of SIZE_CLASS_OF_HEIGHT) {
    if (h >= row.min) return row.cls;
  }
  return "low";
}

/** 階級ごとの誘致係数（延床 1m² あたりの相対寄与） */
export const SIZE_CLASS_FACTOR: Record<SizeClass, number> = {
  tower: 1.0,
  high: 0.7,
  mid: 0.4,
  low: 0.15,
};

/** 延床プロキシ（m²）＝ footprint × 推定階数（階高 3.2m） */
export function floorProxyM2(footprintM2: number, heightM: number | undefined): number {
  const floors = heightM === undefined ? 2 : Math.max(1, Math.round(heightM / 3.2));
  return footprintM2 * floors;
}

/** ノードに吸着した建物群の階級別・延床集計 */
export type NodeBuildingMix = {
  towerM2: number;
  highM2: number;
  midM2: number;
  lowM2: number;
  buildings: number;
};

export const EMPTY_MIX: NodeBuildingMix = { towerM2: 0, highM2: 0, midM2: 0, lowM2: 0, buildings: 0 };

/** 集計→誘致力。建物が無いノードは微小値で選択肢に残す */
export function attractionOf(mix: NodeBuildingMix): number {
  const w =
    mix.towerM2 * SIZE_CLASS_FACTOR.tower +
    mix.highM2 * SIZE_CLASS_FACTOR.high +
    mix.midM2 * SIZE_CLASS_FACTOR.mid +
    mix.lowM2 * SIZE_CLASS_FACTOR.low;
  return w > 0 ? w : 1;
}
