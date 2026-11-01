import { defineHandler } from "void";
import { z } from "zod";
import { attractionOf } from "../../lib/sim/attraction";
import { edgeLengthM } from "../../lib/sim/network";
import { NODE_BUILDING_MIX, YOKOHAMA_NISHI_NETWORK } from "../../lib/sim/yokohama-nishi";

// GET /api/walk-network?area=yokohama-nishi
// 歩行ネットワークを GeoJSON＋ノード表で返す。3D 上の動線表示と
// 将来のシナリオ編集 UI の基礎データ。
export const GET = defineHandler
  .withValidator({
    query: z.object({ area: z.string().optional() }),
  })(async (_c, { query }) => {
    const area = query.area || "yokohama-nishi";
    if (area !== "yokohama-nishi") {
      return {
        area,
        network: null,
        geojson: { type: "FeatureCollection", features: [] },
        nodes: [],
      };
    }
    const network = YOKOHAMA_NISHI_NETWORK;
    return {
      area,
      network: network.id,
      geojson: {
        type: "FeatureCollection",
        features: network.edges.map((e) => ({
          type: "Feature",
          id: e.id,
          geometry: { type: "LineString", coordinates: e.path },
          properties: { from: e.from, to: e.to, lengthM: Math.round(edgeLengthM(e)) },
        })),
      },
      nodes: network.nodes.map((n) => ({
        id: n.id,
        lng: n.lng,
        lat: n.lat,
        role: n.role,
        name: n.name ?? null,
        attraction: Math.round(attractionOf(NODE_BUILDING_MIX[n.id])),
      })),
    };
  });
