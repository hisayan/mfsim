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
    id: "yokohama-nishi",
    label: "横浜市西区",
    camera: { lng: 139.6275, lat: 35.4595, distance: 3500, heading: 0, pitch: -45, roll: 0 },
    tilesets: [
      {
        url: "https://assets.cms.plateau.reearth.io/assets/4a/c9fb39-9c97-4da6-af8f-e08751a2f269/14100_yokohama-shi_city_2023_citygml_1_op_bldg_3dtiles_14103_nishi-ku_lod2_no_texture/tileset.json",
        attribution: "3D City Model (Project PLATEAU) Yokohama City Nishi-ku (FY2023) - MLIT PLATEAU",
      },
    ],
  },
  {
    id: "chiyoda",
    label: "千代田区",
    camera: { lng: 139.7671, lat: 35.6812, distance: 2500, heading: 50, pitch: -35, roll: 0 },
    tilesets: [
      {
        url: "https://assets.cms.plateau.reearth.io/assets/db/070026-aa27-431b-8d53-7cc6b03244f8/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json",
        attribution: "3D City Model (Project PLATEAU) Chiyoda Ward (FY2023) - MLIT PLATEAU",
        attributionUrl: "https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2023",
      },
    ],
  },
  {
    id: "shinjuku",
    label: "新宿区",
    camera: { lng: 139.7, lat: 35.6895, distance: 2500, heading: 0, pitch: -40, roll: 0 },
    tilesets: [
      {
        url: "https://assets.cms.plateau.reearth.io/assets/f0/840fc4-114c-41e4-9a65-67768efd3629/13104_shinjuku-ku_pref_2023_citygml_2_op_bldg_3dtiles_13104_shinjuku-ku_lod2_no_texture/tileset.json",
        attribution: "3D City Model (Project PLATEAU) Shinjuku Ward (FY2023) - MLIT PLATEAU",
        attributionUrl: "https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2023",
      },
    ],
  },
];

export const DEFAULT_AREA_ID = "yokohama-nishi";

export function getArea(id: string): SimArea {
  return AREAS.find((a) => a.id === id) ?? AREAS[0];
}
