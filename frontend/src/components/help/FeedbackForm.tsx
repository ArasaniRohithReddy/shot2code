import { useMemo, useState } from "react";
import copyToClipboard from "copy-to-clipboard";
import toast from "react-hot-toast";
import {
  LuCheckCircle2,
  LuClipboard,
  LuDownload,
  LuExternalLink,
  LuLoader2,
  LuSend,
} from "react-icons/lu";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  buildFeedbackReport,
  downloadFeedbackReport,
  type FeedbackPayload,
  type FeedbackSubmissionResult,
  type FeedbackType,
} from "../../lib/feedback";

const LABEL = "text-sm font-medium text-gray-900 dark:text-zinc-100";
const HELP = "text-xs leading-relaxed text-gray-600 dark:text-zinc-400";

export function FeedbackForm() {
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [includeSystemDetails, setIncludeSystemDetails] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<FeedbackSubmissionResult | null>(null);

  const payload = useMemo<FeedbackPayload>(
    () => ({
      type,
      title,
      details,
      steps,
      expected,
      actual,
      includeSystemDetails,
    }),
    [actual, details, expected, includeSystemDetails, steps, title, type]
  );
  const localReport = useMemo(() => buildFeedbackReport(payload), [payload]);
  const currentReport = result ?? localReport;
  const canSubmit = title.trim().length > 0 && details.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) {
      toast.error("Add a title and description before sending.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const bridge = window.__SHOT2CODE_APP__?.submitFeedback;
      if (!bridge) {
        setResult({
          kind: "fallback",
          reason:
            "Direct submission is available in the desktop app when GitHub CLI is installed and signed in.",
          ...localReport,
        });
        return;
      }
      const submission = await bridge(payload);
      setResult(submission);
      if (submission.kind === "submitted") {
        toast.success("Feedback submitted.");
      }
    } catch (error) {
      console.error("Could not prepare feedback", error);
      setResult({
        kind: "fallback",
        reason:
          error instanceof Error
            ? error.message
            : "The report could not be submitted directly.",
        ...localReport,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = () => {
    try {
      const copied = copyToClipboard(
        `# ${currentReport.title}\n\n${currentReport.body}\n`
      );
      if (!copied) throw new Error("Clipboard write was rejected.");
      toast.success("Copied the report.");
    } catch (error) {
      console.error("Could not copy feedback", error);
      toast.error("Could not copy the report.");
    }
  };

  return (
    <form
      className="space-y-5 px-2 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      data-testid="feedback-form"
    >
      <div className="max-w-2xl">
        <p className="text-sm leading-relaxed text-gray-700 dark:text-zinc-300">
          Report a bug, request a feature, or share feedback without leaving
          your current project. Direct submission uses an already signed-in
          GitHub CLI; otherwise shot2code prepares a private local copy and a
          prefilled browser issue.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          Do not paste API keys or other secrets. shot2code never attaches
          logs, source files, prompts, screenshots, history, or credentials
          automatically.
        </p>
      </div>

      <fieldset>
        <legend className={LABEL}>Report type</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["bug", "Bug"],
              ["feature", "Feature request"],
              ["feedback", "General feedback"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setType(value);
                setResult(null);
              }}
              aria-pressed={type === value}
              className={`min-h-11 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                type === value
                  ? "border-violet-600 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-500 dark:text-zinc-950"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="feedback-title" className={LABEL}>
          Short title
        </label>
        <Input
          id="feedback-title"
          value={title}
          maxLength={160}
          onChange={(event) => {
            setTitle(event.target.value);
            setResult(null);
          }}
          placeholder={
            type === "feature"
              ? "Add side-by-side variant comparison"
              : type === "bug"
                ? "Preview stays blank after generation"
                : "The new import flow is easy to use"
          }
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="feedback-details" className={LABEL}>
          {type === "feature" ? "What should this enable?" : "Details"}
        </label>
        <Textarea
          id="feedback-details"
          value={details}
          maxLength={12_000}
          rows={5}
          onChange={(event) => {
            setDetails(event.target.value);
            setResult(null);
          }}
          placeholder="What happened, or what would make the workflow better?"
          required
        />
      </div>

      {type === "bug" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label htmlFor="feedback-steps" className={LABEL}>
              Steps to reproduce
            </label>
            <Textarea
              id="feedback-steps"
              value={steps}
              rows={3}
              maxLength={6_000}
              onChange={(event) => {
                setSteps(event.target.value);
                setResult(null);
              }}
              placeholder={"1. Open ...\n2. Choose ...\n3. See ..."}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="feedback-expected" className={LABEL}>
              Expected
            </label>
            <Textarea
              id="feedback-expected"
              value={expected}
              rows={3}
              maxLength={4_000}
              onChange={(event) => {
                setExpected(event.target.value);
                setResult(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="feedback-actual" className={LABEL}>
              Actual
            </label>
            <Textarea
              id="feedback-actual"
              value={actual}
              rows={3}
              maxLength={4_000}
              onChange={(event) => {
                setActual(event.target.value);
                setResult(null);
              }}
            />
          </div>
        </div>
      )}

      <label className="flex min-h-11 items-start gap-3 rounded-md border border-gray-200 px-3 py-2.5 dark:border-zinc-800">
        <Checkbox
          checked={includeSystemDetails}
          onCheckedChange={(checked) => {
            setIncludeSystemDetails(checked === true);
            setResult(null);
          }}
          aria-describedby="feedback-system-details"
          className="mt-0.5"
        />
        <span>
          <span className={LABEL}>Include basic app details</span>
          <span id="feedback-system-details" className={`block ${HELP}`}>
            Version, operating system, and architecture only. No username,
            hostname, project data, or logs.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={!canSubmit || submitting}
          className="min-h-11"
        >
          {submitting ? (
            <LuLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LuSend className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {submitting ? "Sending..." : "Send report"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSubmit}
          onClick={copy}
          className="min-h-11"
        >
          <LuClipboard className="mr-2 h-4 w-4" aria-hidden="true" />
          Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSubmit}
          onClick={() =>
            downloadFeedbackReport(currentReport.title, currentReport.body)
          }
          className="min-h-11"
        >
          <LuDownload className="mr-2 h-4 w-4" aria-hidden="true" />
          Save .md
        </Button>
      </div>

      {result?.kind === "submitted" && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          <LuCheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-sm">
            {result.message}{" "}
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              View issue
              <LuExternalLink
                className="ml-1 inline h-3.5 w-3.5"
                aria-hidden="true"
              />
            </a>
          </span>
        </div>
      )}

      {result?.kind === "fallback" && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p className="text-sm">{result.reason}</p>
          <a
            href={result.issueUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-amber-400 px-3 text-sm font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-amber-700 dark:hover:bg-amber-900/40"
          >
            Open prefilled issue
            <LuExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      )}
    </form>
  );
}
