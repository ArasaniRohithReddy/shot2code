import type {
  AuditFinding,
  AuditSeverity,
} from "./source-audit";

export const REVIEW_MIN_WIDTH = 320;
export const REVIEW_MAX_WIDTH = 1920;
export const REVIEW_MIN_VIEWPORTS = 2;
export const REVIEW_MAX_VIEWPORTS = 4;
export const REVIEW_VIEWPORTS_STORAGE_KEY = "review-viewport-presets-v1";

export interface ReviewViewportPreset {
  id: string;
  label: string;
  width: number;
}

export const DEFAULT_REVIEW_VIEWPORTS: ReviewViewportPreset[] = [
  { id: "desktop-1440", label: "Desktop", width: 1440 },
  { id: "tablet-768", label: "Tablet", width: 768 },
  { id: "mobile-390", label: "Mobile", width: 390 },
];

export type ReviewViewportOrientation = "Landscape" | "Portrait";

export interface ReviewViewportDimensions {
  width: number;
  height: number;
  orientation: ReviewViewportOrientation;
}

export interface ReviewBinding {
  commitHash: string | null;
  variantIndex: number;
  codeHash: string;
  viewportWidths: number[];
}

export interface ReviewFindingCounts {
  error: number;
  warning: number;
  info: number;
  total: number;
}

export interface ReviewRun {
  binding: ReviewBinding;
  createdAt: string;
  artifactPath: string;
  findings: AuditFinding[];
  counts: ReviewFindingCounts;
}

export interface HorizontalOverflowMetrics {
  viewportWidth: number;
  documentWidth: number;
  horizontalOverflow: boolean;
}

export type ReviewWidthValidation =
  | { valid: true; width: number }
  | { valid: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function presetLabelForWidth(width: number): string {
  if (width >= 1200) return "Desktop";
  if (width >= 600) return "Tablet";
  return "Mobile";
}

export function createReviewViewportPreset(
  width: number,
  label = "Custom"
): ReviewViewportPreset {
  return {
    id: `viewport-${width}`,
    label: label.trim().slice(0, 40) || presetLabelForWidth(width),
    width,
  };
}

/**
 * Review widths are the iframe's real CSS viewport widths. Height is only
 * presentation metadata, but keeping it realistic also makes orientation
 * media queries behave as expected.
 */
export function getReviewViewportDimensions(
  width: number
): ReviewViewportDimensions {
  const height =
    width >= 1024
      ? Math.round(width * 0.625)
      : width >= 600
        ? 1024
        : 844;

  return {
    width,
    height,
    orientation: width >= height ? "Landscape" : "Portrait",
  };
}

export function validateReviewWidth(
  value: string | number,
  existingWidths: readonly number[] = []
): ReviewWidthValidation {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/.test(raw)) {
    return {
      valid: false,
      message: `Enter a whole number from ${REVIEW_MIN_WIDTH} to ${REVIEW_MAX_WIDTH}.`,
    };
  }

  const width = Number(raw);
  if (width < REVIEW_MIN_WIDTH || width > REVIEW_MAX_WIDTH) {
    return {
      valid: false,
      message: `Width must be between ${REVIEW_MIN_WIDTH}px and ${REVIEW_MAX_WIDTH}px.`,
    };
  }
  if (existingWidths.includes(width)) {
    return {
      valid: false,
      message: `${width}px is already in this review.`,
    };
  }

  return { valid: true, width };
}

/**
 * Local storage is user-controlled and survives app upgrades. Normalize it
 * before rendering so malformed or old preferences can never create an
 * unbounded number of frames.
 */
export function normalizeReviewViewportPresets(
  value: unknown
): ReviewViewportPreset[] {
  const normalized: ReviewViewportPreset[] = [];
  const seenWidths = new Set<number>();

  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (!isRecord(candidate)) continue;
      const width = candidate.width;
      if (
        typeof width !== "number" ||
        !Number.isInteger(width) ||
        width < REVIEW_MIN_WIDTH ||
        width > REVIEW_MAX_WIDTH ||
        seenWidths.has(width)
      ) {
        continue;
      }

      const label =
        typeof candidate.label === "string"
          ? candidate.label.trim().slice(0, 40)
          : "";
      normalized.push(
        createReviewViewportPreset(width, label || presetLabelForWidth(width))
      );
      seenWidths.add(width);
      if (normalized.length === REVIEW_MAX_VIEWPORTS) break;
    }
  }

  if (normalized.length === 0) {
    return DEFAULT_REVIEW_VIEWPORTS.map((preset) => ({ ...preset }));
  }

  for (const fallback of DEFAULT_REVIEW_VIEWPORTS) {
    if (normalized.length >= REVIEW_MIN_VIEWPORTS) break;
    if (seenWidths.has(fallback.width)) continue;
    normalized.push({ ...fallback });
    seenWidths.add(fallback.width);
  }

  return normalized;
}

/**
 * A small deterministic FNV-1a hash is sufficient for local staleness
 * detection. Including the source length makes accidental collisions less
 * likely without retaining any source in review state or exports.
 */
export function hashReviewSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${source.length.toString(
    36
  )}`;
}

export function hashReviewProjectFiles(
  files: Readonly<Record<string, { content: string; path?: string }>>
): string {
  const canonicalSource = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mapPath, file]) => {
      const path = file.path ?? mapPath;
      return `${path.length}:${path}:${file.content.length}:${file.content}`;
    })
    .join("\u0000");
  return hashReviewSource(canonicalSource);
}

export function createReviewBinding({
  commitHash,
  variantIndex,
  source,
  codeHash,
  viewportWidths,
}: {
  commitHash: string | null;
  variantIndex: number;
  source?: string;
  codeHash?: string;
  viewportWidths: readonly number[];
}): ReviewBinding {
  return {
    commitHash,
    variantIndex,
    codeHash: codeHash ?? hashReviewSource(source ?? ""),
    viewportWidths: [...new Set(viewportWidths)].sort((a, b) => a - b),
  };
}

export function isReviewRunStale(
  run: Pick<ReviewRun, "binding"> | null,
  current: ReviewBinding
): boolean {
  if (!run) return false;
  const previous = run.binding;
  return (
    previous.commitHash !== current.commitHash ||
    previous.variantIndex !== current.variantIndex ||
    previous.codeHash !== current.codeHash ||
    previous.viewportWidths.length !== current.viewportWidths.length ||
    previous.viewportWidths.some(
      (width, index) => width !== current.viewportWidths[index]
    )
  );
}

export function classifyAuditFindings(
  findings: readonly Pick<AuditFinding, "severity">[]
): ReviewFindingCounts {
  const counts: Record<AuditSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return {
    ...counts,
    total: findings.length,
  };
}

export function formatHorizontalOverflowMessage(
  requestedWidth: number,
  metrics?: HorizontalOverflowMetrics
): string {
  if (!metrics) {
    return `Checking horizontal overflow at ${requestedWidth}px.`;
  }

  const measuredViewport = Math.max(0, Math.round(metrics.viewportWidth));
  const documentWidth = Math.max(
    measuredViewport,
    Math.ceil(metrics.documentWidth)
  );
  if (!metrics.horizontalOverflow) {
    return `No horizontal overflow detected at ${requestedWidth}px.`;
  }

  const excess = Math.max(1, documentWidth - measuredViewport);
  return `Horizontal overflow: content is ${excess}px wider than the ${measuredViewport}px measured viewport.`;
}

function safeArtifactPath(value: string): string {
  const wasAbsolute = /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]/.test(value);
  const parts = value
    .replace(/^[A-Za-z]:/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  if (wasAbsolute) {
    return parts[parts.length - 1] || "composed-preview.html";
  }
  return parts.join("/") || "composed-preview.html";
}

export function buildFixFindingsInstruction(
  findings: readonly AuditFinding[],
  viewportWidths: readonly number[]
): string {
  const groups = new Map<
    string,
    {
      ruleId: string;
      guidance: string;
      files: Set<string>;
      evidence: string[];
      count: number;
    }
  >();

  for (const finding of findings) {
    const group = groups.get(finding.ruleId) ?? {
      ruleId: finding.ruleId,
      guidance: finding.guidance,
      files: new Set<string>(),
      evidence: [],
      count: 0,
    };
    group.count += 1;
    group.files.add(safeArtifactPath(finding.affectedFile));
    if (group.evidence.length < 3) group.evidence.push(finding.evidence);
    groups.set(finding.ruleId, group);
  }

  const widths = [...new Set(viewportWidths)].sort((a, b) => b - a);
  const lines = [
    `Fix the ${findings.length} selected finding${
      findings.length === 1 ? "" : "s"
    } from the local automated source audit.`,
    "Preserve existing behavior and unrelated styling. Do not treat this as WCAG certification.",
  ];

  for (const group of groups.values()) {
    const examples = group.evidence.join("; ");
    lines.push(
      `- [${group.ruleId}] ${group.count} in ${[...group.files].join(
        ", "
      )}: ${examples}${group.count > group.evidence.length ? "; plus the remaining matching occurrences" : ""}. ${group.guidance}`
    );
  }
  lines.push(`Verify the result at ${widths.map((width) => `${width}px`).join(", ")}.`);
  return lines.join("\n");
}

export function serializeReviewReport(
  run: ReviewRun,
  stale: boolean
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      kind: "shot2code-local-source-review",
      notice:
        "Automated source audit only; not WCAG certification. Runtime/framework DOM may differ.",
      createdAt: run.createdAt,
      stale,
      target: {
        commitHash: run.binding.commitHash,
        variantIndex: run.binding.variantIndex,
        codeHash: run.binding.codeHash,
        viewportWidths: run.binding.viewportWidths,
        artifactPath: safeArtifactPath(run.artifactPath),
      },
      summary: run.counts,
      findings: run.findings.map((finding) => ({
        severity: finding.severity,
        ruleId: finding.ruleId,
        message: finding.message,
        evidence: finding.evidence,
        affectedFile: safeArtifactPath(finding.affectedFile),
        guidance: finding.guidance,
      })),
    },
    null,
    2
  );
}
