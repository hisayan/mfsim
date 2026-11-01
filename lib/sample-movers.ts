// 横浜市西区エリアのサンプル移動体（OGC MF-JSON プリズム符号化）。
// 実データ接続までの雛形として、横浜駅〜みなとみらい周辺の2軌跡を用意する。

export const SAMPLE_MOVERS = [
  {
    type: "MovingFeature",
    id: "yokohama-shuttle-1",
    temporalGeometry: {
      type: "MovingPoint",
      datetimes: [
        "2026-01-01T09:00:00Z",
        "2026-01-01T09:02:30Z",
        "2026-01-01T09:05:00Z",
        "2026-01-01T09:07:30Z",
        "2026-01-01T09:10:00Z",
      ],
      coordinates: [
        [139.624, 35.466],
        [139.6262, 35.4642],
        [139.6286, 35.4621],
        [139.6306, 35.4599],
        [139.6326, 35.4579],
      ],
      interpolation: "Linear",
    },
  },
  {
    type: "MovingFeature",
    id: "yokohama-shuttle-2",
    temporalGeometry: {
      type: "MovingPoint",
      datetimes: [
        "2026-01-01T09:01:00Z",
        "2026-01-01T09:04:00Z",
        "2026-01-01T09:07:00Z",
        "2026-01-01T09:10:00Z",
      ],
      coordinates: [
        [139.6205, 35.4635],
        [139.6255, 35.4615],
        [139.631, 35.4595],
        [139.6365, 35.4575],
      ],
      interpolation: "Linear",
    },
  },
];
