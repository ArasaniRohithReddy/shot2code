/**
 * Reading what an image tool actually produced.
 *
 * Kept out of `AgentActivity` so the counting rules can be tested directly,
 * and because the regression they guard is a counting bug: the activity list
 * used to count *tiles*, so a batch where every prompt failed still read
 * "Generated 3 images" above three blank boxes.
 *
 * The backend now reports each prompt's own outcome, including a classified
 * category and the action to take, and these helpers are what turn that into
 * an honest headline.
 */

export interface ImageItemOutcome {
  url: string | null;
  succeeded: boolean;
  error: string | null;
  action: string | null;
  category: string | null;
}

import {
  FREE_IMAGE_SEARCH_TOOL_NAME,
  countFreeImages,
  describeFreeImageOutcome,
} from "../../lib/free-image-search";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, field: string): string | null {
  const source = record(value);
  const fieldValue = source?.[field];
  return typeof fieldValue === "string" ? fieldValue : null;
}

function arrayField(value: unknown, field: string): unknown[] | null {
  const source = record(value);
  const fieldValue = source?.[field];
  return Array.isArray(fieldValue) ? fieldValue : null;
}

/**
 * One item's outcome, read defensively.
 *
 * A tile counts as a success only when it carries a real URL *and* is not
 * marked as an error, so a contradictory item is treated as the failure it is.
 */
export function readImageItem(
  item: unknown,
  urlField: string
): ImageItemOutcome {
  const url = stringField(item, urlField);
  const status = stringField(item, "status");
  return {
    url: url || null,
    succeeded: Boolean(url) && status !== "error" && status !== "missing",
    error: stringField(item, "error"),
    action: stringField(item, "action"),
    category: stringField(item, "errorCategory"),
  };
}

export function countSuccessfulImages(
  output: unknown,
  urlField: string
): { succeeded: number; requested: number } | null {
  const images = arrayField(output, "images");
  if (!images) return null;
  return {
    succeeded: images.filter((item) => readImageItem(item, urlField).succeeded)
      .length,
    requested: images.length,
  };
}

/**
 * A title that counts what actually happened.
 *
 * `verb` is the completed form ("Generated"); `noun` is the singular thing. A
 * partial batch says "2 of 5", and a batch with nothing to show says so rather
 * than claiming a number it does not have.
 */
export function describeImageOutcome(
  counts: { succeeded: number; requested: number },
  verb: string,
  noun: string,
  emptyLabel: string
): string {
  const { succeeded, requested } = counts;
  if (requested === 0 || succeeded === 0) return emptyLabel;
  if (succeeded < requested) {
    return `${verb} ${succeeded} of ${requested} ${noun}s`;
  }
  return `${verb} ${succeeded} ${noun}${succeeded !== 1 ? "s" : ""}`;
}

export interface ImageEventShape {
  toolName?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
}

/**
 * The headline for one image tool call, or `null` if it is not one.
 *
 * While running there is nothing to count yet, so the requested total is used;
 * once complete only successes are counted.
 */
export function imageEventTitle(event: ImageEventShape): string | null {
  const running = event.status === "running";

  // Found, not generated: a real photograph somebody released is a different
  // thing from one the model invented, and the feed must not blur them.
  if (event.toolName === FREE_IMAGE_SEARCH_TOOL_NAME) {
    if (running) {
      const record =
        event.input && typeof event.input === "object"
          ? (event.input as Record<string, unknown>)
          : {};
      const query = typeof record.query === "string" ? record.query.trim() : "";
      return query ? `Searching free images for "${query}"` : "Searching free images";
    }
    const counts = countFreeImages(event.output);
    if (!counts) return "Searched free images";
    return describeFreeImageOutcome(counts);
  }

  if (event.toolName === "generate_images") {
    if (running) {
      const requested = arrayField(event.input, "prompts")?.length ?? 0;
      return requested
        ? `Generating ${requested} image${requested !== 1 ? "s" : ""}`
        : "Generating images";
    }
    const counts = countSuccessfulImages(event.output, "url");
    if (!counts) return "Generated images";
    return describeImageOutcome(
      counts,
      "Generated",
      "image",
      "Could not generate images"
    );
  }

  if (event.toolName === "remove_backgrounds") {
    if (running) {
      const requested = arrayField(event.input, "image_urls")?.length ?? 0;
      return requested > 1
        ? `Removing ${requested} backgrounds`
        : "Removing background";
    }
    const counts = countSuccessfulImages(event.output, "result_url");
    if (!counts) return "Background removed";
    if (counts.succeeded === 0) return "Could not remove backgrounds";
    if (counts.succeeded < counts.requested) {
      return `Removed ${counts.succeeded} of ${counts.requested} backgrounds`;
    }
    return counts.succeeded > 1
      ? `Removed ${counts.succeeded} backgrounds`
      : "Background removed";
  }

  if (event.toolName === "edit_images") {
    if (running) {
      const requested = arrayField(event.input, "edits")?.length ?? 0;
      return requested
        ? `Editing ${requested} image${requested !== 1 ? "s" : ""}`
        : "Editing images";
    }
    const counts = countSuccessfulImages(event.output, "result_url");
    if (!counts) return "Edited images";
    return describeImageOutcome(
      counts,
      "Edited",
      "image",
      "Could not edit images"
    );
  }

  return null;
}
