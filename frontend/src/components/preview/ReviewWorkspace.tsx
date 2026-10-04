import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuAlertCircle,
  LuAlertTriangle,
  LuCheckCircle2,
  LuDownload,
  LuInfo,
  LuListChecks,
  LuPlay,
  LuSearch,
  LuTrash2,
} from "react-icons/lu";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  AUDIT_CATEGORY_LABELS,
  DEFAULT_REVIEW_VIEWPORTS,
  REVIEW_MAX_VIEWPORTS,
  REVIEW_MIN_VIEWPORTS,
  REVIEW_VIEWPORTS_STORAGE_KEY,
  buildFixFindingsInstruction,
  buildReviewRuntimeSnapshot,
  classifyAuditCategories,
  classifyAuditFindings,
  createReviewBinding,
  createReviewViewportPreset,
  filterReviewFindings,
  formatHorizontalOverflowMessage,
  getReviewStaleReasons,
  getReviewViewportDimensions,
  isReviewRunStale,
  normalizeReviewViewportPresets,
  serializeReviewReport,
  summarizeReviewHealth,
  updateFilteredFindingSelection,
  validateReviewWidth,
  type ReviewBinding,
  type ReviewCategoryFilter,
  type ReviewRun,
  type ReviewRuntimeFrameState,
  type ReviewSeverityFilter,
} from "../../lib/review";
import {
  auditComposedPreviewSource,
  type AuditCategory,
  type AuditFinding,
  type AuditSeverity,
} from "../../lib/source-audit";
import { requestAiReview, type AiReviewFinding } from "../../lib/ai-review";
import type { Settings } from "../../types";
import { Button } from "../ui/button";
import SandboxedPreviewFrame from "./SandboxedPreviewFrame";
import DesignInspectorPanel from "./DesignInspectorPanel";
import ReviewFrameBoundary from "./ReviewFrameBoundary";

interface Props {
  active: boolean;
  html: string;
  codeHash: string;
  sourcePath: string | null;
  commitHash: string | null;
  variantIndex: number;
  refreshToken: number;
  modelId?: string | null;
  settings: Settings;
  onFixSelectedFindings: (
    instruction: string,
    binding: ReviewBinding
  ) => void;
}

function SeverityIcon({ severity }: { severity: AuditSeverity }) {
  if (severity === "error") {
    return <LuAlertCircle className="h-4 w-4" aria-hidden="true" />;
  }
  if (severity === "warning") {
    return <LuAlertTriangle className="h-4 w-4" aria-hidden="true" />;
  }
  return <LuInfo className="h-4 w-4" aria-hidden="true" />;
}

function severityClasses(severity: AuditSeverity): string {
  if (severity === "error") {
    return "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100";
  }
  if (severity === "warning") {
    return "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100";
}

const AUDIT_CATEGORIES: AuditCategory[] = [
  "accessibility",
  "structure",
  "responsive",
  "document",
];

function healthSummaryClasses(
  state: ReturnType<typeof summarizeReviewHealth>["state"]
): string {
  if (state === "needs-attention") {
    return "border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100";
  }
  if (state === "warnings" || state === "stale" || state === "partial") {
    return "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  }
  if (state === "healthy") {
    return "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  return "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100";
}

function FindingCard({
  finding,
  selected,
  onSelectedChange,
}: {
  finding: AuditFinding;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  return (
    <li>
      <label
        className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-violet-500 ${severityClasses(
          finding.severity
        )}`}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-violet-600"
          aria-label={`Select ${finding.ruleId} finding: ${finding.evidence}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide">
              <SeverityIcon severity={finding.severity} />
              {finding.severity}
            </span>
            <code className="break-all rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold dark:bg-white/10">
              {finding.ruleId}
            </code>
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold dark:bg-white/10">
              {AUDIT_CATEGORY_LABELS[finding.category]}
            </span>
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold dark:bg-white/10">
              {finding.origin === "runtime"
                ? `Runtime · ${finding.viewportWidth}px`
                : "Source"}
            </span>
          </span>
          <span className="mt-1 block text-sm font-semibold">
            {finding.message}
          </span>
          <span className="mt-1 block break-words text-xs">
            <span className="font-semibold">Evidence:</span>{" "}
            {finding.evidence}
          </span>
          <span className="mt-1 block break-all text-xs">
            <span className="font-semibold">Affected:</span>{" "}
            <code>{finding.affectedFile}</code>
          </span>
          <span className="mt-1 block break-words text-xs">
            <span className="font-semibold">Fix:</span> {finding.guidance}
          </span>
        </span>
      </label>
    </li>
  );
}

function downloadJsonReport(run: ReviewRun, stale: boolean) {
  const blob = new Blob([serializeReviewReport(run, stale)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shot2code-review-${run.binding.codeHash}.json`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ReviewWorkspace({
  active,
  html,
  codeHash,
  sourcePath,
  commitHash,
  variantIndex,
  refreshToken,
  modelId,
  settings,
  onFixSelectedFindings,
}: Props) {
  const [storedPresets, setStoredPresets] = usePersistedState(
    DEFAULT_REVIEW_VIEWPORTS.map((preset) => ({ ...preset })),
    REVIEW_VIEWPORTS_STORAGE_KEY
  );
  const presets = useMemo(
    () => normalizeReviewViewportPresets(storedPresets),
    [storedPresets]
  );
  const [customWidth, setCustomWidth] = useState("");
  const [widthError, setWidthError] = useState<string | null>(null);
  const [runtimeFrames, setRuntimeFrames] = useState<
    Record<string, ReviewRuntimeFrameState>
  >({});
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [announcement, setAnnouncement] = useState(
    "Review has not been run."
  );
  const [severityFilter, setSeverityFilter] =
    useState<ReviewSeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<ReviewCategoryFilter>("all");
  const [findingQuery, setFindingQuery] = useState("");
  const selectFilteredRef = useRef<HTMLInputElement>(null);
  const [aiFindings, setAiFindings] = useState<AiReviewFinding[]>([]);
  const [selectedAiFindingIds, setSelectedAiFindingIds] = useState<Set<number>>(
    () => new Set()
  );
  const [aiReviewModel, setAiReviewModel] = useState<string | null>(null);
  const [aiReviewError, setAiReviewError] = useState<string | null>(null);
  const [isAiReviewing, setIsAiReviewing] = useState(false);

  const viewportWidths = useMemo(
    () => presets.map((preset) => preset.width),
    [presets]
  );
  const viewportSignature = viewportWidths.join(",");
  const currentBinding = useMemo(
    () =>
      createReviewBinding({
        commitHash,
        variantIndex,
        codeHash,
        viewportWidths,
      }),
    [codeHash, commitHash, variantIndex, viewportWidths]
  );
  const stale = isReviewRunStale(run, currentBinding);
  const staleReasons = useMemo(
    () => (run ? getReviewStaleReasons(run.binding, currentBinding) : []),
    [currentBinding, run]
  );
  const staleReasonText =
    staleReasons.length <= 1
      ? staleReasons[0] ?? "bound target"
      : `${staleReasons.slice(0, -1).join(", ")} and ${
          staleReasons[staleReasons.length - 1]
        }`;
  const healthSummary = useMemo(
    () => summarizeReviewHealth(run, stale),
    [run, stale]
  );
  const selectedFindings = useMemo(
    () =>
      run?.findings.filter((finding) =>
        selectedFindingIds.has(finding.id)
      ) ?? [],
    [run, selectedFindingIds]
  );
  const filteredFindings = useMemo(
    () =>
      filterReviewFindings(
        run?.findings ?? [],
        severityFilter,
        categoryFilter,
        findingQuery
      ),
    [categoryFilter, findingQuery, run, severityFilter]
  );
  const filteredSelectedCount = filteredFindings.filter((finding) =>
    selectedFindingIds.has(finding.id)
  ).length;
  const allFilteredSelected =
    filteredFindings.length > 0 &&
    filteredSelectedCount === filteredFindings.length;

  useEffect(() => {
    if (JSON.stringify(storedPresets) !== JSON.stringify(presets)) {
      setStoredPresets(presets);
    }
  }, [presets, setStoredPresets, storedPresets]);

  useEffect(() => {
    setRuntimeFrames({});
  }, [currentBinding.codeHash, refreshToken, viewportSignature]);

  useEffect(() => {
    if (!active) setRuntimeFrames({});
  }, [active]);

  useEffect(() => {
    if (selectFilteredRef.current) {
      selectFilteredRef.current.indeterminate =
        filteredSelectedCount > 0 && !allFilteredSelected;
    }
  }, [allFilteredSelected, filteredSelectedCount]);

  useEffect(() => {
    if (run && stale) {
      setAnnouncement(
        `Review results are stale because the ${staleReasonText} changed.`
      );
    }
  }, [run, stale, staleReasonText]);

  const addViewport = (event: React.FormEvent) => {
    event.preventDefault();
    if (presets.length >= REVIEW_MAX_VIEWPORTS) {
      setWidthError(`A review can show at most ${REVIEW_MAX_VIEWPORTS} viewports.`);
      return;
    }
    const validation = validateReviewWidth(customWidth, viewportWidths);
    if (!validation.valid) {
      setWidthError(validation.message);
      return;
    }
    setStoredPresets([
      ...presets,
      createReviewViewportPreset(validation.width),
    ]);
    setCustomWidth("");
    setWidthError(null);
    setAnnouncement(`Added a ${validation.width}px review viewport.`);
  };

  const removeViewport = (id: string, width: number) => {
    if (presets.length <= REVIEW_MIN_VIEWPORTS) return;
    setStoredPresets(presets.filter((preset) => preset.id !== id));
    setWidthError(null);
    setAnnouncement(`Removed the ${width}px review viewport.`);
  };

  const runAudit = useCallback(() => {
    const artifactPath = sourcePath ?? "composed-preview.html";
    const sourceFindings = auditComposedPreviewSource({
      html,
      sourcePath,
      viewportWidths,
    });
    const runtime = buildReviewRuntimeSnapshot(
      presets,
      runtimeFrames,
      artifactPath
    );
    const findings = [...sourceFindings, ...runtime.findings];
    const nextRun: ReviewRun = {
      binding: currentBinding,
      createdAt: new Date().toISOString(),
      artifactPath,
      findings,
      counts: classifyAuditFindings(findings),
      categoryCounts: classifyAuditCategories(findings),
      runtimeViewports: runtime.viewports,
    };
    const readyViewports = runtime.viewports.filter(
      (viewport) => viewport.status === "ready"
    ).length;
    setRun(nextRun);
    setSelectedFindingIds(new Set(findings.map((finding) => finding.id)));
    setAnnouncement(
      `Review complete: ${nextRun.counts.error} errors, ${nextRun.counts.warning} warnings, ${nextRun.counts.info} informational findings, and ${readyViewports} of ${runtime.viewports.length} runtime viewports captured.`
    );
  }, [
    currentBinding,
    html,
    presets,
    runtimeFrames,
    sourcePath,
    viewportWidths,
  ]);

  const toggleFinding = (id: string, selected: boolean) => {
    setSelectedFindingIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const fixSelected = () => {
    if (!run || stale || selectedFindings.length === 0) return;
    onFixSelectedFindings(
      buildFixFindingsInstruction(selectedFindings, viewportWidths),
      run.binding
    );
    setAnnouncement(
      `Started fixing ${selectedFindings.length} selected review finding${
        selectedFindings.length === 1 ? "" : "s"
      } in Chat.`
    );
  };

  const exportReport = () => {
    if (!run || stale) return;
    try {
      downloadJsonReport(run, false);
      setAnnouncement("Downloaded the local JSON review report.");
    } catch (error) {
      console.error("Failed to download review report", error);
      setAnnouncement("The review report could not be downloaded.");
    }
  };

  const runAiReview = async () => {
    if (!modelId) {
      setAiReviewError(
        "This option does not record a model identity. Retry it before using AI review."
      );
      return;
    }
    setIsAiReviewing(true);
    setAiReviewError(null);
    try {
      const result = await requestAiReview({
        source: html,
        sourcePath,
        viewportWidths,
        model: modelId,
        settings,
      });
      setAiFindings(result.findings);
      setAiReviewModel(result.model);
      setSelectedAiFindingIds(
        new Set(result.findings.map((_finding, index) => index))
      );
      setAnnouncement(
        `AI review returned ${result.findings.length} finding${
          result.findings.length === 1 ? "" : "s"
        } using ${result.model}.`
      );
    } catch (caught) {
      setAiReviewError(
        caught instanceof Error ? caught.message : "AI review could not run."
      );
    } finally {
      setIsAiReviewing(false);
    }
  };

  const fixSelectedAiFindings = () => {
    const selected = aiFindings.filter((_finding, index) =>
      selectedAiFindingIds.has(index)
    );
    if (selected.length === 0) return;
    const instruction = [
      `Fix the ${selected.length} selected finding${
        selected.length === 1 ? "" : "s"
      } from the bounded AI review performed by ${aiReviewModel ?? modelId}.`,
      "Preserve unrelated behavior and styling. Verify every change in the local deterministic Review afterward.",
      ...selected.map(
        (finding) =>
          `- [${finding.severity}] ${finding.title}: ${finding.evidence}. ${finding.guidance}`
      ),
      `Verify at ${viewportWidths
        .slice()
        .sort((left, right) => right - left)
        .map((width) => `${width}px`)
        .join(", ")}.`,
    ].join("\n");
    onFixSelectedFindings(instruction, currentBinding);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-zinc-950">
      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-950 dark:text-zinc-50">
              <LuListChecks className="h-4 w-4" aria-hidden="true" />
              Responsive review
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-600 dark:text-zinc-300">
              Each frame uses its labeled CSS viewport width—nothing is
              screenshot-scaled. Frames are sandboxed and are unmounted when
              Review is inactive.
            </p>
          </div>
          <form
            onSubmit={addViewport}
            className="flex min-w-0 flex-wrap items-end gap-2"
            aria-label="Add review viewport"
          >
            <label className="text-xs font-medium text-gray-700 dark:text-zinc-200">
              <span className="mb-1 block">Custom width</span>
              <span className="flex h-11 overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-900">
                <input
                  type="number"
                  min={320}
                  max={1920}
                  step={1}
                  inputMode="numeric"
                  value={customWidth}
                  onChange={(event) => {
                    setCustomWidth(event.target.value);
                    setWidthError(null);
                  }}
                  disabled={presets.length >= REVIEW_MAX_VIEWPORTS}
                  aria-describedby={widthError ? "review-width-error" : undefined}
                  className="min-w-0 w-24 border-0 bg-transparent px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="320–1920"
                />
                <span className="flex items-center border-l border-gray-200 px-2 text-xs text-gray-500 dark:border-zinc-700 dark:text-zinc-400">
                  px
                </span>
              </span>
            </label>
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={presets.length >= REVIEW_MAX_VIEWPORTS}
            >
              Add viewport
            </Button>
            <span className="self-center text-xs text-gray-500 dark:text-zinc-400">
              {presets.length}/{REVIEW_MAX_VIEWPORTS}
            </span>
          </form>
        </div>
        {widthError && (
          <p
            id="review-width-error"
            role="alert"
            className="mt-2 text-xs font-medium text-red-700 dark:text-red-300"
          >
            {widthError}
          </p>
        )}
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_23rem] lg:overflow-hidden">
        <section
          aria-label="Responsive viewport comparison"
          tabIndex={0}
          className="h-[32rem] min-w-0 overflow-auto overscroll-contain border-b border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 lg:h-full lg:border-b-0 lg:border-r dark:border-zinc-800"
          data-testid="review-viewport-scroller"
        >
          <div className="flex w-max min-w-full items-start gap-4 p-3 sm:p-4">
            {active &&
              presets.map((preset) => {
                const dimensions = getReviewViewportDimensions(preset.width);
                const frameState = runtimeFrames[preset.id];
                const metrics =
                  frameState?.status === "ready"
                    ? frameState.metrics
                    : undefined;
                const frameError =
                  frameState?.status === "error"
                    ? frameState.message
                    : null;
                const inspectionCapped =
                  metrics?.inspectionTruncated === true ||
                  metrics?.findingsTruncated === true;
                const overflowMessage = frameError
                  ? `${preset.width}px runtime inspection unavailable: ${frameError}`
                  : `${formatHorizontalOverflowMessage(
                      preset.width,
                      metrics
                    )}${
                      inspectionCapped
                        ? " Runtime evidence was capped; review the generated page manually for additional issues."
                        : ""
                    }`;
                const hasOverflow = metrics?.horizontalOverflow === true;
                const runtimeFindingCount = metrics?.findings.length ?? 0;
                const markFrameError = (message: string) =>
                  setRuntimeFrames((current) => ({
                    ...current,
                    [preset.id]: { status: "error", message },
                  }));
                return (
                  <article
                    key={preset.id}
                    style={{ width: `${dimensions.width + 2}px` }}
                    className={`flex-none overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-zinc-900 ${
                      frameError || hasOverflow
                        ? "border-red-500 dark:border-red-500"
                        : "border-gray-300 dark:border-zinc-700"
                    }`}
                    aria-label={`${preset.label}, ${dimensions.width} by ${dimensions.height} pixels, ${dimensions.orientation}`}
                  >
                    <header className="sticky top-0 z-10 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-200 bg-white px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-bold text-gray-900 dark:text-zinc-50">
                          {preset.label}
                        </span>
                        <span className="text-xs tabular-nums text-gray-600 dark:text-zinc-300">
                          {dimensions.width} × {dimensions.height}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-zinc-400">
                          {dimensions.orientation}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            frameError || hasOverflow
                              ? "text-red-700 dark:text-red-300"
                              : metrics
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-gray-500 dark:text-zinc-400"
                          }`}
                          title={overflowMessage}
                          aria-label={overflowMessage}
                          data-testid={`runtime-status-${preset.width}`}
                        >
                          {frameError || hasOverflow ? (
                            <LuAlertTriangle
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                          ) : metrics ? (
                            <LuCheckCircle2
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                          ) : (
                            <LuInfo className="h-4 w-4" aria-hidden="true" />
                          )}
                          {frameError
                            ? "Unavailable"
                            : hasOverflow
                              ? `Overflow · ${runtimeFindingCount}${
                                  inspectionCapped ? " · capped" : ""
                                }`
                              : metrics
                                ? `Checked · ${runtimeFindingCount}${
                                    inspectionCapped ? " · capped" : ""
                                  }`
                                : "Checking"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          removeViewport(preset.id, preset.width)
                        }
                        disabled={presets.length <= REVIEW_MIN_VIEWPORTS}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-300"
                        aria-label={`Remove ${preset.label} ${preset.width}px viewport`}
                        title={
                          presets.length <= REVIEW_MIN_VIEWPORTS
                            ? `Keep at least ${REVIEW_MIN_VIEWPORTS} viewports`
                            : `Remove ${preset.width}px viewport`
                        }
                      >
                        <LuTrash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </header>
                    {frameError && (
                      <div
                        role="status"
                        className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                      >
                        Runtime checks unavailable: {frameError} The preview and
                        other viewport results remain available.
                      </div>
                    )}
                    <ReviewFrameBoundary
                      key={`${codeHash}:${refreshToken}:${preset.id}`}
                      height={dimensions.height}
                      onError={markFrameError}
                    >
                      <SandboxedPreviewFrame
                        html={html}
                        refreshToken={refreshToken}
                        title={`${preset.label} preview at ${dimensions.width} pixels`}
                        data-testid={`review-frame-${preset.width}`}
                        data-review-width={preset.width}
                        loading="eager"
                        className="block border-0 bg-white"
                        style={{
                          width: `${dimensions.width}px`,
                          height: `${dimensions.height}px`,
                        }}
                        onRuntimeError={markFrameError}
                        onRuntimeMetrics={(nextMetrics) =>
                          setRuntimeFrames((current) => {
                            const previous = current[preset.id];
                            if (
                              previous?.status === "ready" &&
                              JSON.stringify(previous.metrics) ===
                                JSON.stringify(nextMetrics)
                            ) {
                              return current;
                            }
                            return {
                              ...current,
                              [preset.id]: {
                                status: "ready",
                                metrics: nextMetrics,
                              },
                            };
                          })
                        }
                      />
                    </ReviewFrameBoundary>
                  </article>
                );
              })}
          </div>
        </section>

        <aside
          aria-labelledby="local-review-heading"
          className="min-w-0 bg-white dark:bg-zinc-950 lg:min-h-0 lg:overflow-y-auto"
        >
          <div className="p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2
                  id="local-review-heading"
                  className="text-sm font-semibold text-gray-950 dark:text-zinc-50"
                >
                  Automated local review
                </h2>
                <p className="mt-1 break-words text-xs text-gray-600 dark:text-zinc-300">
                  Local composed artifact:{" "}
                  <code className="font-semibold">
                    {sourcePath ?? "composed-preview.html"}
                  </code>
                </p>
              </div>
              <Button
                type="button"
                onClick={runAudit}
                className="min-h-11 gap-2 bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
              >
                <LuPlay className="h-4 w-4" aria-hidden="true" />
                {run ? "Rerun" : "Run audit"}
              </Button>
            </div>

            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              <span className="font-semibold">
                Automated checks only—not WCAG certification.
              </span>{" "}
              Review combines static source checks with bounded, read-only DOM
              measurements from each sandboxed viewport. Accessible-name,
              keyboard-path, and target-size checks are conservative signals;
              confirm results with
              keyboard, screen-reader, zoom, and interaction testing.
            </div>

            <div
              className={`mt-3 rounded-lg border p-3 text-xs ${healthSummaryClasses(
                healthSummary.state
              )}`}
              role="status"
              data-testid="review-health-summary"
            >
              <strong className="block text-sm">{healthSummary.title}</strong>
              <span className="mt-1 block leading-5">
                {healthSummary.detail}
              </span>
            </div>

            {run && (
              <>
                <div
                  className={`mt-3 rounded-lg border p-3 text-xs ${
                    stale
                      ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                      : "border-gray-200 bg-gray-50 text-gray-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  }`}
                  role="status"
                >
                  {stale ? (
                    <span className="flex items-start gap-2 font-semibold">
                      <LuAlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      Results are stale because the {staleReasonText}
                      changed. Rerun before fixing or exporting.
                    </span>
                  ) : (
                    <span>
                      Current for commit{" "}
                      <code>{run.binding.commitHash ?? "uncommitted"}</code>,
                      option {run.binding.variantIndex + 1}, code{" "}
                      <code>{run.binding.codeHash}</code>, at{" "}
                      {run.binding.viewportWidths.join(", ")}px.
                      {modelId && (
                        <>
                          {" "}
                          Model{" "}
                          <code className="notranslate" translate="no">
                            {modelId}
                          </code>
                          .
                        </>
                      )}
                    </span>
                  )}
                </div>

                <div
                  className="mt-3 grid grid-cols-3 gap-2"
                  aria-label={`${run.counts.error} errors, ${run.counts.warning} warnings, ${run.counts.info} informational findings`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSeverityFilter((current) =>
                        current === "error" ? "all" : "error"
                      )
                    }
                    aria-pressed={severityFilter === "error"}
                    className={`rounded-lg border p-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                      severityFilter === "error"
                        ? "border-red-500 bg-red-50 dark:bg-red-950/30"
                        : "border-red-200 dark:border-red-900"
                    }`}
                  >
                    <span className="block text-lg font-bold tabular-nums text-red-700 dark:text-red-300">
                      {run.counts.error}
                    </span>
                    <span className="text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-300">
                      Errors
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSeverityFilter((current) =>
                        current === "warning" ? "all" : "warning"
                      )
                    }
                    aria-pressed={severityFilter === "warning"}
                    className={`rounded-lg border p-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      severityFilter === "warning"
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                        : "border-amber-200 dark:border-amber-900"
                    }`}
                  >
                    <span className="block text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">
                      {run.counts.warning}
                    </span>
                    <span className="text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-300">
                      Warnings
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSeverityFilter((current) =>
                        current === "info" ? "all" : "info"
                      )
                    }
                    aria-pressed={severityFilter === "info"}
                    className={`rounded-lg border p-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      severityFilter === "info"
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                        : "border-blue-200 dark:border-blue-900"
                    }`}
                  >
                    <span className="block text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">
                      {run.counts.info}
                    </span>
                    <span className="text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-300">
                      Info
                    </span>
                  </button>
                </div>

                <div
                  className="mt-2 grid grid-cols-2 gap-2"
                  aria-label="Finding categories"
                >
                  {AUDIT_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() =>
                        setCategoryFilter((current) =>
                          current === category ? "all" : category
                        )
                      }
                      aria-pressed={categoryFilter === category}
                      className={`flex min-h-11 items-center justify-between rounded-lg border px-3 text-left text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        categoryFilter === category
                          ? "border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-100"
                          : "border-gray-200 text-gray-700 dark:border-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      <span>{AUDIT_CATEGORY_LABELS[category]}</span>
                      <span className="tabular-nums">
                        {run.categoryCounts[category]}
                      </span>
                    </button>
                  ))}
                </div>

                {run.findings.length > 0 && (
                  <label className="relative mt-3 block">
                    <span className="sr-only">Search audit findings</span>
                    <LuSearch
                      className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={findingQuery}
                      onChange={(event) => setFindingQuery(event.target.value)}
                      placeholder="Search rule, file, evidence or fix"
                      className="h-11 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-violet-950"
                    />
                  </label>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={fixSelected}
                    disabled={stale || selectedFindings.length === 0}
                    className="min-h-11 flex-1 bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
                  >
                    Fix selected findings ({selectedFindings.length})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportReport}
                    disabled={stale}
                    className="min-h-11 gap-2"
                    title="Download a local JSON report without source code or prompts"
                  >
                    <LuDownload className="h-4 w-4" aria-hidden="true" />
                    JSON
                  </Button>
                </div>

                {run.findings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-within:ring-2 focus-within:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-950/30">
                      <input
                        ref={selectFilteredRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        disabled={filteredFindings.length === 0}
                        onChange={(event) =>
                          setSelectedFindingIds((current) =>
                            updateFilteredFindingSelection(
                              current,
                              filteredFindings,
                              event.target.checked
                            )
                          )
                        }
                        className="h-5 w-5 accent-violet-600"
                      />
                      Select filtered ({filteredSelectedCount}/
                      {filteredFindings.length})
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFindingIds(
                          new Set(
                            run.findings
                              .filter(
                                (finding) =>
                                  finding.severity === "error" ||
                                  finding.severity === "warning"
                              )
                              .map((finding) => finding.id)
                          )
                        )
                      }
                      className="min-h-11 rounded-lg px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-300 dark:hover:bg-amber-950/30"
                    >
                      Select errors + warnings
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFindingIds(new Set())}
                      className="min-h-11 rounded-lg px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Clear selection
                    </button>
                  </div>
                )}

                {run.findings.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                    <span className="flex items-center gap-2 font-semibold">
                      <LuCheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      No findings from the completed deterministic checks.
                    </span>
                    <p className="mt-1 text-xs">
                      This does not certify accessibility; test the runtime
                      experience manually too.
                    </p>
                  </div>
                ) : filteredFindings.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600 dark:border-zinc-700 dark:text-zinc-300">
                    No findings match the current filter.
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2" aria-label="Audit findings">
                    {filteredFindings.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        selected={selectedFindingIds.has(finding.id)}
                        onSelectedChange={(selected) =>
                          toggleFinding(finding.id, selected)
                        }
                      />
                    ))}
                  </ul>
                )}
              </>
            )}

            {!run && (
              <div className="mt-3 rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-600 dark:border-zinc-700 dark:text-zinc-300">
                Run the deterministic local checks to classify source and
                rendered-viewport findings for this version, option, code hash,
                and viewport set.
              </div>
            )}
          </div>
          <DesignInspectorPanel html={html} sourcePath={sourcePath} />
          <section
            className="border-t border-gray-200 px-3 py-4 dark:border-zinc-800 sm:px-4"
            aria-labelledby="ai-review-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2
                  id="ai-review-heading"
                  className="text-sm font-semibold text-gray-950 dark:text-zinc-50"
                >
                  AI-assisted review
                </h2>
                <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-300">
                  Uses the exact model recorded for this option. No tools, MCP,
                  skills, web search, or writes are available. This may consume
                  provider quota.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={isAiReviewing || !modelId}
                onClick={() => void runAiReview()}
              >
                {isAiReviewing ? "Reviewing…" : "Review with AI"}
              </Button>
            </div>

            {aiReviewError && (
              <p
                role="alert"
                className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
              >
                {aiReviewError}
              </p>
            )}

            {aiFindings.length > 0 && (
              <>
                <p className="notranslate mt-3 text-[11px] text-gray-500 dark:text-zinc-400" translate="no">
                  Reviewed by {aiReviewModel ?? modelId}
                </p>
                <ul className="mt-2 space-y-2">
                  {aiFindings.map((finding, index) => (
                    <li key={`${finding.title}-${index}`}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${severityClasses(
                          finding.severity
                        )}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAiFindingIds.has(index)}
                          onChange={(event) =>
                            setSelectedAiFindingIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(index);
                              else next.delete(index);
                              return next;
                            })
                          }
                          className="mt-0.5 h-5 w-5 accent-violet-600"
                        />
                        <span className="min-w-0">
                          <strong className="block text-sm">
                            {finding.title}
                          </strong>
                          <span className="mt-1 block text-xs">
                            {finding.evidence}
                          </span>
                          <span className="mt-1 block text-xs">
                            <strong>Fix:</strong> {finding.guidance}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  onClick={fixSelectedAiFindings}
                  disabled={selectedAiFindingIds.size === 0}
                  className="mt-3 min-h-11 w-full bg-violet-600 text-white hover:bg-violet-700"
                >
                  Fix selected AI findings ({selectedAiFindingIds.size})
                </Button>
              </>
            )}
          </section>
        </aside>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

export default ReviewWorkspace;
