"use strict";

const { spawn } = require("child_process");

const FEEDBACK_REPOSITORY = "ArasaniRohithReddy/app-releases";
const FEEDBACK_TYPES = new Map([
  ["bug", "Bug"],
  ["feature", "Feature request"],
  ["feedback", "Feedback"],
]);
const MAX_TITLE_LENGTH = 160;
const MAX_DETAIL_LENGTH = 12_000;
const MAX_PREFILLED_BODY_LENGTH = 1_200;

function cleanSingleLine(value, maxLength = MAX_TITLE_LENGTH) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanMultiline(value, maxLength = MAX_DETAIL_LENGTH) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function normalizeFeedback(payload = {}, appDetails = {}) {
  const type = FEEDBACK_TYPES.has(payload.type) ? payload.type : "feedback";
  const title = cleanSingleLine(payload.title);
  const details = cleanMultiline(payload.details);
  if (!title) throw new Error("Add a short title before sending.");
  if (!details) throw new Error("Describe the report before sending.");

  return {
    type,
    typeLabel: FEEDBACK_TYPES.get(type),
    title,
    details,
    steps: cleanMultiline(payload.steps, 6_000),
    expected: cleanMultiline(payload.expected, 4_000),
    actual: cleanMultiline(payload.actual, 4_000),
    includeSystemDetails: payload.includeSystemDetails === true,
    appVersion: cleanSingleLine(appDetails.appVersion, 40),
    platform: cleanSingleLine(appDetails.platform, 40),
    arch: cleanSingleLine(appDetails.arch, 40),
  };
}

function buildFeedbackReport(payload, appDetails = {}) {
  const normalized = normalizeFeedback(payload, appDetails);
  const title = `[shot2code ${normalized.typeLabel}] ${normalized.title}`;
  const sections = [
    `## ${normalized.typeLabel}`,
    normalized.details,
  ];

  if (normalized.type === "bug" && normalized.steps) {
    sections.push("## Steps to reproduce", normalized.steps);
  }
  if (normalized.type === "bug" && normalized.expected) {
    sections.push("## Expected behavior", normalized.expected);
  }
  if (normalized.type === "bug" && normalized.actual) {
    sections.push("## Actual behavior", normalized.actual);
  }
  if (normalized.includeSystemDetails) {
    const details = [
      normalized.appVersion ? `- shot2code: ${normalized.appVersion}` : null,
      normalized.platform ? `- Platform: ${normalized.platform}` : null,
      normalized.arch ? `- Architecture: ${normalized.arch}` : null,
    ].filter(Boolean);
    if (details.length > 0) sections.push("## App details", details.join("\n"));
  }

  sections.push(
    "---",
    "Submitted from the shot2code in-app feedback form. No logs, project files, history, prompts, screenshots, or credentials were attached automatically."
  );
  const body = sections.join("\n\n");
  const prefilledBody =
    body.length <= MAX_PREFILLED_BODY_LENGTH
      ? body
      : `${body.slice(
          0,
          MAX_PREFILLED_BODY_LENGTH - 116
        ).trimEnd()}\n\n[The browser-prefilled copy was shortened. Use the in-app Copy or Save .md action for the complete report.]`;
  const issueUrl =
    `https://github.com/${FEEDBACK_REPOSITORY}/issues/new?` +
    new URLSearchParams({ title, body: prefilledBody }).toString();
  return { title, body, issueUrl };
}

function runGh(args, input = "", { spawnImpl = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "gh.exe" : "gh";
    const child = spawnImpl(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      const error = new Error("GitHub CLI timed out.");
      error.code = "ETIMEDOUT";
      finish(() => reject(error));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) =>
      finish(() => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
    );
    child.stdin.end(input);
  });
}

function fallbackReason(errorOrResult) {
  if (errorOrResult?.code === "ENOENT") {
    return "GitHub CLI is not installed on this machine.";
  }
  if (errorOrResult?.code === "ETIMEDOUT") {
    return "GitHub CLI did not respond in time.";
  }
  const detail = cleanSingleLine(errorOrResult?.stderr || errorOrResult?.message, 240);
  return detail
    ? `GitHub CLI could not submit the report: ${detail}`
    : "GitHub CLI is not signed in or could not submit the report.";
}

async function submitFeedback(
  payload,
  appDetails = {},
  { runGhImpl = runGh } = {}
) {
  const report = buildFeedbackReport(payload, appDetails);
  try {
    const auth = await runGhImpl(["auth", "status", "--hostname", "github.com"]);
    if (auth.code !== 0) {
      return { kind: "fallback", reason: fallbackReason(auth), ...report };
    }

    const created = await runGhImpl(
      [
        "issue",
        "create",
        "--repo",
        FEEDBACK_REPOSITORY,
        "--title",
        report.title,
        "--body-file",
        "-",
      ],
      report.body
    );
    const issueUrl = created.stdout
      .split(/\s+/)
      .find((value) =>
        /^https:\/\/github\.com\/ArasaniRohithReddy\/app-releases\/issues\/\d+$/.test(
          value
        )
      );
    if (created.code !== 0 || !issueUrl) {
      return { kind: "fallback", reason: fallbackReason(created), ...report };
    }
    return {
      kind: "submitted",
      message: "Report submitted to the shot2code issue tracker.",
      url: issueUrl,
      ...report,
    };
  } catch (error) {
    return { kind: "fallback", reason: fallbackReason(error), ...report };
  }
}

module.exports = {
  FEEDBACK_REPOSITORY,
  buildFeedbackReport,
  normalizeFeedback,
  runGh,
  submitFeedback,
};
