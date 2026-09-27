export type FeedbackType = "bug" | "feature" | "feedback";

export interface FeedbackPayload {
  type: FeedbackType;
  title: string;
  details: string;
  steps?: string;
  expected?: string;
  actual?: string;
  includeSystemDetails: boolean;
}

export type FeedbackSubmissionResult =
  | {
      kind: "submitted";
      message: string;
      url: string;
      title: string;
      body: string;
      issueUrl: string;
    }
  | {
      kind: "fallback";
      reason: string;
      title: string;
      body: string;
      issueUrl: string;
    };

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature request",
  feedback: "Feedback",
};
const MAX_PREFILLED_BODY_LENGTH = 1_200;

function cleanSingleLine(value: string, maxLength = 160): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMultiline(value: string | undefined, maxLength: number): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

export function buildFeedbackReport(payload: FeedbackPayload): {
  title: string;
  body: string;
  issueUrl: string;
} {
  const titleText = cleanSingleLine(payload.title);
  const details = cleanMultiline(payload.details, 12_000);
  const typeLabel = TYPE_LABELS[payload.type];
  const title = `[shot2code ${typeLabel}] ${titleText}`;
  const sections = [`## ${typeLabel}`, details];

  if (payload.type === "bug" && (payload.steps ?? "").trim()) {
    sections.push("## Steps to reproduce", cleanMultiline(payload.steps, 6_000));
  }
  if (payload.type === "bug" && (payload.expected ?? "").trim()) {
    sections.push("## Expected behavior", cleanMultiline(payload.expected, 4_000));
  }
  if (payload.type === "bug" && (payload.actual ?? "").trim()) {
    sections.push("## Actual behavior", cleanMultiline(payload.actual, 4_000));
  }
  if (payload.includeSystemDetails) {
    sections.push(
      "## App details",
      "shot2code will add only its version, operating system, and architecture when direct desktop submission is available."
    );
  }
  sections.push(
    "---",
    "Submitted from the shot2code in-app feedback form. No logs, project files, history, prompts, screenshots, or credentials were attached automatically."
  );
  const body = sections.join("\n\n");
  const prefilledBody =
    body.length <= MAX_PREFILLED_BODY_LENGTH
      ? body
      : `${body
          .slice(0, MAX_PREFILLED_BODY_LENGTH - 116)
          .trimEnd()}\n\n[The browser-prefilled copy was shortened. Use the in-app Copy or Save .md action for the complete report.]`;
  const issueUrl =
    "https://github.com/ArasaniRohithReddy/app-releases/issues/new?" +
    new URLSearchParams({ title, body: prefilledBody }).toString();
  return { title, body, issueUrl };
}

export function downloadFeedbackReport(title: string, body: string): void {
  const safeName =
    title
      .replace(/^\[shot2code [^\]]+\]\s*/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "shot2code-feedback";
  const url = URL.createObjectURL(
    new Blob([`# ${title}\n\n${body}\n`], {
      type: "text/markdown;charset=utf-8",
    })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
