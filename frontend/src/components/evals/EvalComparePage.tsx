import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BsBoxArrowUpRight,
  BsChevronLeft,
  BsChevronRight,
} from "react-icons/bs";

import { HTTP_BACKEND_URL } from "../../config";
import EvalNavigation from "./EvalNavigation";
import { formatCost, formatMs } from "./report-format";

interface EvalSession {
  session_id: string;
  name: string;
  eval_set: string;
  created_at: string;
  is_active: boolean;
}

interface MatrixRun {
  run_id: string;
  status: string;
  source: "eval" | "ui";
  total_duration_ms: number | null;
  total_cost_usd: number | null;
  created_at: string;
  is_stale: boolean;
}

interface MatrixCell {
  filename: string;
  model: string;
  runs: MatrixRun[];
}

interface MatrixRow {
  filename: string;
  sha256: string | null;
  image_url: string | null;
  title: string | null;
  brief: string | null;
}

interface SessionMatrix {
  session: EvalSession;
  eval_set: { name: string } | null;
  set_missing: boolean;
  rows: MatrixRow[];
  models: string[];
  model_notes: Record<string, string>;
  cells: MatrixCell[];
  unmatched_run_count: number;
}

// Stable chip colors so a model keeps its hue as you toggle selections.
const MODEL_COLORS = [
  "border-sky-500 bg-sky-950/60 text-sky-200",
  "border-emerald-500 bg-emerald-950/60 text-emerald-200",
  "border-violet-500 bg-violet-950/60 text-violet-200",
  "border-amber-500 bg-amber-950/60 text-amber-200",
  "border-rose-500 bg-rose-950/60 text-rose-200",
  "border-cyan-500 bg-cyan-950/60 text-cyan-200",
  "border-lime-500 bg-lime-950/60 text-lime-200",
  "border-fuchsia-500 bg-fuchsia-950/60 text-fuchsia-200",
];

function shortModelName(model: string): string {
  return model
    .replace("-preview", "")
    .replace(" thinking)", ")")
    .replace(" effort)", ")");
}

function EvalComparePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<EvalSession[]>([]);
  const [matrix, setMatrix] = useState<SessionMatrix | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  // 0 = source screenshot, 1..N = selected models in order.
  const [paneIndex, setPaneIndex] = useState(1);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const sessionId = searchParams.get("session");

  const bestRunFor = useCallback(
    (filename: string, model: string): MatrixRun | null => {
      if (!matrix) return null;
      const cell = matrix.cells.find(
        (c) => c.filename === filename && c.model === model
      );
      if (!cell) return null;
      // Only completed runs have viewable output; failed/running panes
      // would just render the API's 404 JSON.
      return cell.runs.find((run) => run.status === "completed") ?? null;
    },
    [matrix]
  );

  // Images that have at least one completed run among selected models,
  // in matrix (coverage-sorted upstream: filename) order.
  const images = useMemo(() => {
    if (!matrix) return [];
    return matrix.rows.filter((row) =>
      selectedModels.some(
        (model) => bestRunFor(row.filename, model)?.status === "completed"
      )
    );
  }, [matrix, selectedModels, bestRunFor]);

  const currentImage = images[Math.min(imageIndex, images.length - 1)] ?? null;

  // Panes for the current image: source + one per selected model with a run.
  const panes = useMemo(() => {
    if (!currentImage || !matrix) return [];
    const modelPanes = selectedModels
      .map((model) => ({
        model,
        run: bestRunFor(currentImage.filename, model),
      }))
      .filter((pane) => pane.run !== null);
    return [
      { model: "__source__", run: null as MatrixRun | null },
      ...modelPanes,
    ];
  }, [currentImage, matrix, selectedModels, bestRunFor]);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch(`${HTTP_BACKEND_URL}/eval-sessions`);
      const data = await response.json();
      setSessions(data.sessions);
      setConnectionFailed(false);
      return data.sessions as EvalSession[];
    } catch (error) {
      console.error("Error fetching sessions", error);
      setConnectionFailed(true);
      return [];
    }
  }, []);

  const loadMatrix = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          `${HTTP_BACKEND_URL}/eval-sessions/${encodeURIComponent(id)}/matrix`
        );
        if (!response.ok) throw new Error("Request failed");
        const data: SessionMatrix = await response.json();
        setMatrix(data);
        // Default: first two models that actually have runs.
        setSelectedModels((current) =>
          current.length > 0
            ? current.filter((m) => data.models.includes(m))
            : data.models.slice(0, 2)
        );
        setImageIndex(0);
        setPaneIndex(1);
      } catch (error) {
        console.error("Error loading matrix", error);
        toast.error("Failed to load session data.");
      }
    },
    []
  );

  useEffect(() => {
    fetchSessions().then((loaded) => {
      const target =
        (sessionId && loaded.find((s) => s.session_id === sessionId)) ||
        loaded.find((s) => s.is_active) ||
        loaded[0];
      if (target) {
        if (target.session_id !== sessionId) {
          setSearchParams({ session: target.session_id }, { replace: true });
        }
        loadMatrix(target.session_id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connectionFailed) return;
    const timer = window.setTimeout(() => {
      setRetryTick((n) => n + 1);
      fetchSessions().then((loaded) => {
        if (loaded.length === 0) return;
        const target =
          (sessionId && loaded.find((s) => s.session_id === sessionId)) ||
          loaded.find((s) => s.is_active) ||
          loaded[0];
        if (target && !matrix) loadMatrix(target.session_id);
      });
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionFailed, retryTick]);

  const switchSession = (id: string) => {
    setSearchParams({ session: id }, { replace: true });
    setMatrix(null);
    loadMatrix(id);
  };

  const toggleModel = (model: string) => {
    setSelectedModels((current) =>
      current.includes(model)
        ? current.filter((m) => m !== model)
        : [...current, model]
    );
    setPaneIndex(1);
  };

  const stepImage = useCallback(
    (delta: number) => {
      if (images.length === 0) return;
      setImageIndex((current) =>
        (current + delta + images.length) % images.length
      );
      setPaneIndex((current) => Math.min(current, 1));
    },
    [images.length]
  );

  const stepPane = useCallback(
    (delta: number) => {
      if (panes.length === 0) return;
      setPaneIndex((current) => (current + delta + panes.length) % panes.length);
    },
    [panes.length]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "ArrowRight") stepPane(1);
      else if (e.key === "ArrowLeft") stepPane(-1);
      else if (e.key === "ArrowDown" || e.key === "]") stepImage(1);
      else if (e.key === "ArrowUp" || e.key === "[") stepImage(-1);
      else if (e.key === "s" || e.key === "0") setPaneIndex(0);
      else if (/^[1-9]$/.test(e.key)) {
        const target = parseInt(e.key, 10);
        if (target < panes.length) setPaneIndex(target);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stepPane, stepImage, panes.length]);

  const activePane = panes[Math.min(paneIndex, panes.length - 1)] ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-white">
      <div className="shrink-0">
        <EvalNavigation />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-2">
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs">
          <h1 className="text-sm font-semibold tracking-tight">Compare</h1>
          <select
            value={matrix?.session.session_id ?? ""}
            onChange={(e) => switchSession(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200"
          >
            {sessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.name} · {session.eval_set}
              </option>
            ))}
          </select>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          {matrix?.models.map((model, index) => (
            <button
              key={model}
              onClick={() => toggleModel(model)}
              title={matrix.model_notes[model] || model}
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                selectedModels.includes(model)
                  ? MODEL_COLORS[index % MODEL_COLORS.length]
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {shortModelName(model)}
            </button>
          ))}
          <span className="ml-auto hidden text-[11px] text-zinc-600 lg:inline">
            ←/→ switch output · ↑/↓ image · S source
          </span>
        </div>

        {currentImage && (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <button
              onClick={() => stepImage(-1)}
              className="rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800"
              title="Previous image (↑)"
            >
              <BsChevronLeft />
            </button>
            <button
              onClick={() => stepImage(1)}
              className="rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800"
              title="Next image (↓)"
            >
              <BsChevronRight />
            </button>
            <span className="font-mono text-zinc-300">
              {currentImage.filename}
            </span>
            <span className="text-zinc-600">
              {images.indexOf(currentImage) + 1} / {images.length}
            </span>

            <div className="mx-2 h-4 w-px bg-zinc-800" />

            {panes.map((pane, index) => {
              const isActive = index === Math.min(paneIndex, panes.length - 1);
              const label =
                pane.model === "__source__"
                  ? currentImage?.image_url
                    ? "Source"
                    : "Brief"
                  : shortModelName(pane.model);
              const colorClass =
                pane.model === "__source__"
                  ? "border-zinc-400 bg-zinc-800 text-zinc-100"
                  : MODEL_COLORS[
                      (matrix?.models.indexOf(pane.model) ?? 0) %
                        MODEL_COLORS.length
                    ];
              return (
                <button
                  key={pane.model}
                  onClick={() => setPaneIndex(index)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-all ${
                    isActive
                      ? colorClass
                      : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {label}
                  {pane.run && (
                    <span className="text-[10px] opacity-70">
                      {formatMs(pane.run.total_duration_ms)} ·{" "}
                      {formatCost(pane.run.total_cost_usd)}
                    </span>
                  )}
                </button>
              );
            })}

            {activePane?.run && (
              <span className="ml-auto flex items-center gap-2">
                <button
                  onClick={() =>
                    navigate(
                      `/evals/agent-runs?run=${encodeURIComponent(
                        activePane.run!.run_id
                      )}`
                    )
                  }
                  className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                  Run details
                </button>
                <a
                  href={`${HTTP_BACKEND_URL}/agent-runs/${encodeURIComponent(
                    activePane.run.run_id
                  )}/output`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800"
                  title="Open output in new tab"
                >
                  <BsBoxArrowUpRight />
                </a>
              </span>
            )}
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-white">
          {!matrix && (
            <p className="py-8 text-center text-sm text-zinc-500">
              {connectionFailed ? "Backend unreachable — retrying…" : "Loading…"}
            </p>
          )}
          {matrix && images.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">
              No completed runs for the selected models. Toggle models above.
            </p>
          )}
          {/* All panes stay mounted; switching just flips visibility, so
              flipping is instant and each pane keeps its scroll position. */}
          {currentImage &&
            panes.map((pane, index) => {
              const isActive = index === Math.min(paneIndex, panes.length - 1);
              if (pane.model === "__source__") {
                return (
                  <div
                    key="__source__"
                    className={`absolute inset-0 overflow-auto bg-white ${
                      isActive ? "visible" : "invisible"
                    }`}
                  >
                    {currentImage.image_url ? (
                      <img
                        src={`${HTTP_BACKEND_URL}${currentImage.image_url}`}
                        alt={currentImage.filename}
                        className="w-full"
                      />
                    ) : (
                      <div className="mx-auto max-w-2xl px-8 py-12 text-zinc-900">
                        <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                          Brief
                        </div>
                        <h2 className="mt-1 text-2xl font-semibold">
                          {currentImage.title ?? currentImage.filename}
                        </h2>
                        <p className="mt-4 text-base leading-7">
                          {currentImage.brief}
                        </p>
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <iframe
                  key={pane.run!.run_id}
                  title={`${pane.model} output`}
                  src={`${HTTP_BACKEND_URL}/agent-runs/${encodeURIComponent(
                    pane.run!.run_id
                  )}/output`}
                  className={`absolute inset-0 h-full w-full bg-white ${
                    isActive ? "visible" : "invisible"
                  }`}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

export default EvalComparePage;
