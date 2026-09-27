import { LuCheck, LuLoader2 } from "react-icons/lu";
import {
  formatStitchElapsed,
  type StitchUiPhase,
} from "./stitch-generation-status";

const STITCH_GENERATION_STEPS: Array<{
  phase: StitchUiPhase;
  label: string;
}> = [
  { phase: "connecting", label: "Connect to Stitch" },
  { phase: "creating-project", label: "Create project" },
  { phase: "generating-screen", label: "Generate screen" },
  { phase: "downloading-output", label: "Download output" },
  { phase: "importing-code", label: "Open in shot2code" },
];

export default function StitchGenerationStatus({
  phase,
  message,
  elapsedSeconds,
}: {
  phase: StitchUiPhase;
  message: string;
  elapsedSeconds: number;
}) {
  const activeIndex =
    phase === "complete"
      ? STITCH_GENERATION_STEPS.length
      : Math.max(
          0,
          STITCH_GENERATION_STEPS.findIndex((step) => step.phase === phase)
        );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="stitch-generation-status"
      className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-100"
    >
      <div className="flex items-start gap-2">
        <LuLoader2
          className="mt-0.5 h-4 w-4 shrink-0 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{message}</p>
          <p className="mt-1 text-violet-700 dark:text-violet-300">
            Step {Math.min(activeIndex + 1, STITCH_GENERATION_STEPS.length)} of{" "}
            {STITCH_GENERATION_STEPS.length}
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums">
              {formatStitchElapsed(elapsedSeconds)}
            </span>
          </p>
        </div>
      </div>
      <ol className="mt-3 grid gap-1 sm:grid-cols-5">
        {STITCH_GENERATION_STEPS.map((step, index) => {
          const completed = index < activeIndex;
          const current = index === activeIndex;
          return (
            <li
              key={step.phase}
              className={`flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 ${
                current
                  ? "bg-violet-100 font-medium text-violet-950 dark:bg-violet-900/50 dark:text-white"
                  : "text-violet-700 dark:text-violet-300"
              }`}
            >
              {completed ? (
                <LuCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    current
                      ? "bg-violet-600 dark:bg-violet-300"
                      : "bg-violet-200 dark:bg-violet-900"
                  }`}
                  aria-hidden="true"
                />
              )}
              <span className="truncate" title={step.label}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] leading-4 text-violet-700 dark:text-violet-300">
        Stitch does not provide a percentage. These phases are reported by the
        SDK call itself; keep shot2code open while generation is active.
      </p>
    </div>
  );
}
