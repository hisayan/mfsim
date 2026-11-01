import { defineHandler } from "void";
import { z } from "zod";
import { SAMPLE_MOVERS } from "../../lib/sample-movers";
import { runPedestrianSim } from "../../lib/sim/simulate";

// GET /api/moving-features?area=yokohama-nishi&source=sim&count=150&seed=mfsim-1
// エリア内の移動体を OGC MF-JSON 形式で返す。
// 既定は歩行者シミュレーションの生成軌跡。同じ (seed, params) からは
// 常に同じ出力が得られるため、パラメータ自体が記録＝再生キーになる。
// source=sample で従来の固定サンプル2軌跡を返す（後方互換）。
export const GET = defineHandler
  .withValidator({
    query: z.object({
      area: z.string().optional(),
      source: z.enum(["sim", "sample"]).optional(),
      count: z.coerce.number().int().min(1).max(3000).optional(),
      seed: z.string().max(64).optional(),
      durationMin: z.coerce.number().int().min(1).max(180).optional(),
      sampleSec: z.coerce.number().int().min(1).max(120).optional(),
    }),
  })(async (_c, { query }) => {
    const area = query.area || "yokohama-nishi";
    if (area !== "yokohama-nishi") {
      return { area, movers: [] as unknown[], meta: { source: "none" as const } };
    }
    if (query.source === "sample") {
      return { area, movers: SAMPLE_MOVERS, meta: { source: "sample" as const } };
    }
    const { movers, meta } = runPedestrianSim({
      count: query.count ?? 150,
      seed: query.seed ?? "mfsim-1",
      durationMin: query.durationMin ?? 30,
      sampleSec: query.sampleSec ?? 10,
    });
    return { area, movers, meta };
  });
