import {
  useCallback,
  useEffect,
  useMemo,
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
  LuTrash2,
} from "react-icons/lu";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  DEFAULT_REVIEW_VIEWPORTS,
  REVIEW_MAX_VIEWPORTS,
  REVIEW_MIN_VIEWPORTS,
  REVIEW_VIEWPORTS_STORAGE_KEY,
  buildFixFindingsInstruction,
  classifyAuditFindings,
  createReviewBinding,
  createReviewViewportPreset,
  formatHorizontalOverflowMessage,
  getReviewViewportDimensions,
  isReviewRunStale,
  normalizeReviewViewportPresets,
  serializeReviewReport,
  validateReviewWidth,
  type ReviewRun,
} from "../../lib/review";
import {
  auditComposedPreviewSource,
  type AuditFinding,
  type AuditSeverity,
} from "../../lib/source-audit";
import type { PreviewRuntimeMetrics } from "../../lib/preview-bridge";
import { Button } from "../ui/button";
import SandboxedPreviewFrame from "./SandboxedPreviewFrame";

interface Props {
  active: boolean;
  html: string;
  codeHash: string;
  sourcePath: string | null;
  commitHash: string | null;
  variantIndex: number;
  refreshToken: number;
  onFixSelectedFindings: (instruction: string) => void;
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
  const [runtimeMetrics, setRuntimeMetrics] = useState<
    Record<string, PreviewRuntimeMetrics>
  >({});
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(
    () => new Set()
  );
  const [announcement, setAnnouncement] = useState(
    "Review has not been run."
  );

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
  const selectedFindings = useMemo(
    () =>
      run?.findings.filter((finding) =>
        selectedFindingIds.has(finding.id)
      ) ?? [],
    [run, selectedFindingIds]
  );

  useEffect(() => {
    if (JSON.stringify(storedPresets) !== JSON.stringify(presets)) {
      setStoredPresets(presets);
    }
  }, [presets, setStoredPresets, storedPresets]);

  useEffect(() => {
    setRuntimeMetrics({});
  }, [currentBinding.codeHash, refreshToken, viewportSignature]);

  useEffect(() => {
    if (run && stale) {
      setAnnouncement(
        "Review results are stale because the code, version, option, or viewport set changed."
      );
    }
  }, [run, stale]);

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
    const findings = auditComposedPreviewSource({
      html,
      sourcePath,
      viewportWidths,
    });
    const nextRun: ReviewRun = {
      binding: currentBinding,
      createdAt: new Date().toISOString(),
      artifactPath: sourcePath ?? "composed-preview.html",
      findings,
      counts: classifyAuditFindings(findings),
    };
    setRun(nextRun);
    setSelectedFindingIds(
      new Set(findings.map((finding) => finding.id))
    );
    setAnnouncement(
      `Review complete: ${nextRun.counts.error} errors, ${nextRun.counts.warning} warnings, and ${nextRun.counts.info} informational findings.`
    );
  }, [currentBinding, html, sourcePath, viewportWidths]);

  const toggleFinding = (id: string, selected: boolean) => {
    setSelectedFindingIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const fixSelected = () => {
    if (stale || selectedFindings.length === 0) return;
    onFixSelectedFindings(
      buildFixFindingsInstruction(selectedFindings, viewportWidths)
    );
    setAnnouncement(
      `Added ${selectedFindings.length} selected review finding${
        selectedFindings.length === 1 ? "" : "s"
      } to Chat without sending.`
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
                const metrics = runtimeMetrics[preset.id];
                const overflowMessage = formatHorizontalOverflowMessage(
                  preset.width,
                  metrics
                );
                const hasOverflow = metrics?.horizontalOverflow === true;
                return (
                  <article
                    key={preset.id}
                    style={{ width: `${dimensions.width + 2}px` }}
                    className={`flex-none overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-zinc-900 ${
                      hasOverflow
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
                            hasOverflow
                              ? "text-red-700 dark:text-red-300"
                              : metrics
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-gray-500 dark:text-zinc-400"
                          }`}
                          title={overflowMessage}
                          aria-label={overflowMessage}
                          data-testid={`overflow-status-${preset.width}`}
                        >
                          {hasOverflow ? (
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
                          {hasOverflow
                            ? "Overflow"
                            : metrics
                              ? "Fits"
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
                      onRuntimeMetrics={(nextMetrics) =>
                        setRuntimeMetrics((current) => {
                          const previous = current[preset.id];
                          if (
                            previous &&
                            previous.viewportWidth ===
                              nextMetrics.viewportWidth &&
                            previous.documentWidth ===
                              nextMetrics.documentWidth &&
                            previous.horizontalOverflow ===
                              nextMetrics.horizontalOverflow
                          ) {
                            return current;
                          }
                          return {
                            ...current,
                            [preset.id]: nextMetrics,
                          };
                        })
                      }
                    />
                  </article>
                );
              })}
          </div>
        </section>

        <aside
          aria-labelledby="source-audit-heading"
          className="min-w-0 bg-white dark:bg-zinc-950 lg:min-h-0 lg:overflow-y-auto"
        >
          <div className="p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2
                  id="source-audit-heading"
                  className="text-sm font-semibold text-gray-950 dark:text-zinc-50"
                >
                  Automated source audit
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
                Automated source audit only—not WCAG certification.
              </span>{" "}
              It checks the composed preview source locally. Runtime/framework
              DOM may differ, so combine this with keyboard, screen-reader, and
              browser testing.
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
                      Results are stale. Code, version, option, or viewport set
                      changed; rerun before fixing or exporting.
                    </span>
                  ) : (
                    <span>
                      Current for commit{" "}
                      <code>{run.binding.commitHash ?? "uncommitted"}</code>,
                      option {run.binding.variantIndex + 1}, code{" "}
                      <code>{run.binding.codeHash}</code>, at{" "}
                      {run.binding.viewportWidths.join(", ")}px.
                    </span>
                  )}
                </div>

                <div
                  className="mt-3 grid grid-cols-3 gap-2"
                  aria-label={`${run.counts.error} errors, ${run.counts.warning} warnings, ${run.counts.info} informational findings`}
                >
                  <div className="rounded-lg border border-red-200 p-2 text-center dark:border-red-900">
                    <span className="block text-lg font-bold tabular-nums text-red-700 dark:text-red-300">
                      {run.counts.error}
                    </span>
                    <span className="text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-300">
                      Errors
                    </span>
                  </div>
                  <div className="rounded-lg border border-amber-200 p-2 text-center dark:border-amber-900">
                    <span className="block text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">
                      {run.counts.warning}
                    </span>
                    <span className="text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-300">
                      Warnings
                    </span>
                  </div>
                  <div className="rounded-lg border border-blue-200 p-2 text-center dark:border-blue-900">
                    <span className="block text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">
                      {run.counts.info}
                    </span>
                    <span className="text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-300">
                      Info
                    </span>
                  </div>
                </div>

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
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFindingIds(
                          new Set(
                            run.findings.map((finding) => finding.id)
                          )
                        )
                      }
                      className="min-h-11 rounded-lg px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-950/30"
                    >
                      Select all
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
                      No findings from these deterministic checks.
                    </span>
                    <p className="mt-1 text-xs">
                      This does not certify accessibility; test the runtime
                      experience manually too.
                    </p>
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2" aria-label="Audit findings">
                    {run.findings.map((finding) => (
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
                Run the deterministic local checks to classify source findings
                for this version, option, code hash, and viewport set.
              </div>
            )}
          </div>
        </aside>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

export default ReviewWorkspace;
