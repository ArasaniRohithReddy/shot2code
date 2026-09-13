export function usesHashRouting(protocol: string): boolean {
  return protocol.toLowerCase() === "file:";
}
