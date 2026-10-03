import { Stack } from "../../../lib/stacks";

export type StitchOutputMode = "stitch" | "convert";

export function usesDirectStitchOutput(
  stitchOnly: boolean,
  outputMode: StitchOutputMode,
  stack: Stack
): boolean {
  return stitchOnly ? outputMode === "stitch" : stack === Stack.HTML_CSS;
}
