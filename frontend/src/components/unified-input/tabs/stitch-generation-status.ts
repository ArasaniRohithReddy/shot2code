export type StitchUiPhase = Shot2CodeStitchPhase | "importing-code";

export function formatStitchElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}
