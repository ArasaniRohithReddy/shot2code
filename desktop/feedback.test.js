"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  FEEDBACK_REPOSITORY,
  buildFeedbackReport,
  submitFeedback,
} = require("./feedback");
const fs = require("node:fs");
const path = require("node:path");

const payload = {
  type: "bug",
  title: "  Preview   is blank  ",
  details: "The preview stays empty after generation.",
  steps: "1. Generate\n2. Open Preview",
  expected: "The generated page appears.",
  actual: "The pane is blank.",
  includeSystemDetails: true,
};

test("builds a bounded report without attaching private application data", () => {
  const report = buildFeedbackReport(payload, {
    appVersion: "0.5.1",
    platform: "win32",
    arch: "x64",
  });

  assert.equal(report.title, "[shot2code Bug] Preview is blank");
  assert.match(report.body, /## Steps to reproduce/);
  assert.match(report.body, /shot2code: 0\.5\.1/);
  assert.doesNotMatch(report.body, /history\.sqlite3|API[_ -]?KEY|diagnostic log/i);
  const url = new URL(report.issueUrl);
  assert.equal(url.hostname, "github.com");
  assert.equal(url.pathname, `/${FEEDBACK_REPOSITORY}/issues/new`);
  assert.equal(url.searchParams.get("title"), report.title);
  assert.equal(url.searchParams.get("body"), report.body);
});

test("keeps very long browser fallback URLs bounded without truncating direct reports", () => {
  const report = buildFeedbackReport({
    type: "feedback",
    title: "Detailed report",
    details: "A".repeat(10_000),
    includeSystemDetails: false,
  });

  assert.ok(report.body.length > 9_000);
  assert.ok(report.issueUrl.length < 2_000);
  assert.match(
    new URL(report.issueUrl).searchParams.get("body"),
    /browser-prefilled copy was shortened/
  );
});

test("submits through an authenticated GitHub CLI using stdin for the body", async () => {
  const calls = [];
  const result = await submitFeedback(
    payload,
    { appVersion: "0.5.1", platform: "win32", arch: "x64" },
    {
      runGhImpl: async (args, input = "") => {
        calls.push({ args, input });
        if (args[0] === "auth") return { code: 0, stdout: "", stderr: "" };
        return {
          code: 0,
          stdout:
            "https://github.com/ArasaniRohithReddy/app-releases/issues/42",
          stderr: "",
        };
      },
    }
  );

  assert.equal(result.kind, "submitted");
  assert.equal(
    result.url,
    "https://github.com/ArasaniRohithReddy/app-releases/issues/42"
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args.slice(0, 4), [
    "issue",
    "create",
    "--repo",
    FEEDBACK_REPOSITORY,
  ]);
  assert.ok(calls[1].input.includes("No logs, project files"));
  assert.ok(!calls[1].args.includes(calls[1].input));
});

test("returns a complete browser fallback when GitHub CLI is unavailable", async () => {
  const error = Object.assign(new Error("missing"), { code: "ENOENT" });
  const result = await submitFeedback(payload, {}, {
    runGhImpl: async () => {
      throw error;
    },
  });

  assert.equal(result.kind, "fallback");
  assert.match(result.reason, /not installed/i);
  assert.match(result.issueUrl, /^https:\/\/github\.com\//);
  assert.match(result.body, /Preview stays empty/i);
});

test("rejects empty reports before invoking an external command", async () => {
  let invoked = false;
  await assert.rejects(
    submitFeedback(
      { type: "feedback", title: "", details: "" },
      {},
      {
        runGhImpl: async () => {
          invoked = true;
          return { code: 0, stdout: "", stderr: "" };
        },
      }
    ),
    /short title/
  );
  assert.equal(invoked, false);
});

test("registers feedback IPC at application startup, outside Stitch handlers", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const registration = main
    .split(/\r?\n/)
    .find((line) =>
      line.includes('ipcMain.handle("shot2code:submit-feedback"')
    );

  assert.ok(registration, "feedback IPC registration is missing");
  assert.match(registration, /^ {4}ipcMain\.handle/);
});
