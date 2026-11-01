import { defineHandler } from "void";
import { z } from "zod";
import { encodeFlow } from "../../lib/sim/flow-codec";
import { runInflowSim } from "../../lib/sim/inflow";
import {
  KYOTO_NODE_BUILDING_MIX,
  KYOTO_ORIGIN_WEIGHT,
  KYOTO_STATION_NETWORK,
} from "../../lib/sim/kyoto-station";

// GET /api/flow?area=kyoto-station&ratePerMin=1500&durationMin=6&seed=mfsim-kyoto
// 流入型シミュレーションの結果を軽量フロー形式で返す。MF-JSON より
// 1桁小さく、万人規模の動的な人並みをそのまま転送できる。
// 同じ (seed, params) からは常に同じ出力が得られる。
export const GET = defineHandler
  .withValidator({
    query: z.object({
      area: z.string().optional(),
      ratePerMin: z.coerce.number().int().min(50).max(3000).optional(),
      durationMin: z.coerce.number().int().min(2).max(12).optional(),
      sampleSec: z.coerce.number().int().min(5).max(60).optional(),
      seed: z.string().max(64).optional(),
      pulseEveryMin: z.coerce.number().int().min(0).max(10).optional(),
      pulseSize: z.coerce.number().int().min(0).max(2000).optional(),
    }),
  })(async (_c, { query }) => {
    const area = query.area || "kyoto-station";
    if (area !== "kyoto-station") {
      return {
        area,
        flow: null,
        meta: { source: "none" as const },
      };
    }
    const result = runInflowSim({
      network: KYOTO_STATION_NETWORK,
      mixes: KYOTO_NODE_BUILDING_MIX,
      originWeight: KYOTO_ORIGIN_WEIGHT,
      ratePerMin: query.ratePerMin ?? 1500,
      durationMin: query.durationMin ?? 6,
      sampleSec: query.sampleSec ?? 20,
      seed: query.seed ?? "mfsim-kyoto",
      pulseEveryMin: query.pulseEveryMin ?? 3,
      pulseSize: query.pulseSize ?? 500,
      maxAgents: 20000,
      // 駅前広路は狭い歩道より詰まりにくい想定。混雑の緩急は残す。
      jamDensityPerM: 4.0,
      minSpeedFrac: 0.5,
    });
    return { area, flow: encodeFlow(result), meta: result.meta };
  });
