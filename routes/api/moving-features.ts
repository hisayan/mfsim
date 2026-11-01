import { defineHandler } from "void";
import { z } from "zod";
import { SAMPLE_MOVERS } from "../../lib/sample-movers";

// GET /api/moving-features?area=yokohama-nishi
// エリア内の移動体を OGC MF-JSON 形式で返す雛形 API。将来的には DB からの取得に置き換える。
export const GET = defineHandler
  .withValidator({
    query: z.object({ area: z.string().optional() }),
  })(async (_c, { query }) => {
    const area = query.area || "yokohama-nishi";
    if (area !== "yokohama-nishi") {
      return { area, movers: [] as unknown[] };
    }
    return { area, movers: SAMPLE_MOVERS };
  });
