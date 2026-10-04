export function githubImportActionLabel(
  instruction: string,
  isLoading: boolean
): string {
  if (isLoading) return "Inspecting repository…";
  return instruction.trim()
    ? "Inspect, Open & Refine"
    : "Inspect & Open Repository";
}
