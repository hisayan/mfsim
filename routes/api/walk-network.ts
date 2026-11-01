import { defineHandler } from "void";
import { z } from "zod";
import { attractionOf, type NodeBuildingMix } from "../../lib/sim/attraction";
import { edgeLengthM, type WalkNetwork } from "../../lib/sim/network";
import { KYOTO_NODE_BUILDING_MIX, KYOTO_STATION_NETWORK } from "../../lib/sim/kyoto-station";
import { NODE_BUILDING_MIX, YOKOHAMA_NISHI_NETWORK } from "../../lib/sim/yokohama-nishi";

const NETWORKS: Record<string, { network: WalkNetwork; mixes: Record<string, NodeBuildingMix> }> = {
  "yokohama-nishi": { network: YOKOHAMA_NISHI_NETWORK, mixes: NODE_BUILDING_MIX },
  "kyoto-station": { network: KYOTO_STATION_NETWORK, mixes: KYOTO_NODE_BUILDING_MIX },
};

// GET /api/walk-network?area=yokohama-nishi
// 歩行ネットワークを GeoJSON＋ノード表で返す。3D 上の動線表示と
// 将来のシナリオ編集 UI の基礎データ。
export const GET = defineHandler
  .withValidator({
    query: z.object({ area: z.string().optional() }),
  })(async (_c, { query }) => {
    const area = query.area || "yokohama-nishi";
    const entry = NETWORKS[area];
    if (!entry) {
      return {
        area,
        network: null,
        geojson: { type: "FeatureCollection", features: [] },
        nodes: [],
      };
    }
    const network = entry.network;
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
        attraction: Math.round(attractionOf(entry.mixes[n.id])),
      })),
    };
  });
