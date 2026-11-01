import { defineHandler, type InferProps } from "void";
import { AREAS, DEFAULT_AREA_ID } from "../lib/areas";

export const ssr = false;

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
  return { areas: AREAS, defaultAreaId: DEFAULT_AREA_ID };
});
