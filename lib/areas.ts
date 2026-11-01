// mfsim の表示エリア設定。PLATEAU 3D Tiles とカメラの初期値をエリアごとに定義する。
// 新しい都市を追加する場合は tileset.json の URL と帰属表示をここに追記するだけでよい。

export type AreaCamera = {
  lng: number;
  lat: number;
  /** カメラの注視点からの距離（メートル）。指定時は height の代わりに使う */
  distance: number;
  heading: number;
  pitch: number;
  roll: number;
};

export type PlateauTileset = {
  /** tileset.json の URL */
  url: string;
  /** 帰属表示テキスト */
  attribution: string;
  /** 帰属表示のリンク先（任意） */
  attributionUrl?: string;
};

export type SimArea = {
  id: string;
  label: string;
  camera: AreaCamera;
  tilesets: PlateauTileset[];
};

export const AREAS: SimArea[] = [
  {
    id: "kyoto-station",
    label: "Kyoto Station",
    camera: { lng: 135.7585, lat: 34.986, distance: 650, heading: 15, pitch: -50, roll: 0 },
    // 京都市 2023 の 3D Tiles は ZIP 公開のみで配信 URL が無いため、
    // ひとまず建物なし（地形＋航空写真＋人流）で表示する。配信 URL か
    // 自前ホストの目処がついたら tileset を追加する。
    tilesets: [],
  },
  {
    id: "yokohama-nishi",
    label: "Nishi-ku, Yokohama",
    camera: { lng: 139.6275, lat: 35.4595, distance: 3500, heading: 0, pitch: -45, roll: 0 },
    tilesets: [
      {
        url: "https://assets.cms.plateau.reearth.io/assets/4a/c9fb39-9c97-4da6-af8f-e08751a2f269/14100_yokohama-shi_city_2023_citygml_1_op_bldg_3dtiles_14103_nishi-ku_lod2_no_texture/tileset.json",
        attribution: "3D City Model (Project PLATEAU) Yokohama City Nishi-ku (FY2023) - MLIT PLATEAU",
      },
    ],
  },
];

// 千代田・新宿の tileset 定義は人流シミュレーション未対応のため選択肢から外した。
// 歩行ネットワークができたらこの配列に戻す（URL は git 履歴に残っている）。

export const DEFAULT_AREA_ID = "kyoto-station";

export function getArea(id: string): SimArea {
  return AREAS.find((a) => a.id === id) ?? AREAS[0];
}
