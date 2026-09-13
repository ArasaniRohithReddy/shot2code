import type { Commit, Variant, VariantStatus } from "./types";

export interface SelectedVariantState {
  index: number | null;
  variant: Variant | undefined;
  status: VariantStatus | undefined;
  canUpdate: boolean;
  isGenerating: boolean;
  isError: boolean;
  isCancelled: boolean;
}

export function getSelectedVariantState(
  commit: Commit | null | undefined
): SelectedVariantState {
  const index = commit ? commit.selectedVariantIndex : null;
  const variant = index === null ? undefined : commit?.variants[index];
  const status = variant?.status;

  return {
    index,
    variant,
    status,
    canUpdate: status === "complete",
    isGenerating: status === "generating",
    isError: status === "error",
    isCancelled: status === "cancelled",
  };
}

export function getVariantStatusLabel(
  status: VariantStatus | undefined
): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "generating":
      return "Generating";
    default:
      return "Pending";
  }
}

export function getVariantUpdateUnavailableMessage(
  status: VariantStatus | undefined
): string {
  switch (status) {
    case "generating":
      return "Wait for this option to finish generating before updating it.";
    case "error":
      return "This option failed to generate. Retry it or select a completed option.";
    case "cancelled":
      return "This option was cancelled. Select a completed option to update.";
    default:
      return "The selected option is not ready to update.";
  }
}
