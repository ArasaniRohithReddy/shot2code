import { HTTP_BACKEND_URL } from "../config";
import { toByokWirePayload } from "./copilot-sdk-byok";
import type { Settings } from "../types";

export interface AiReviewFinding {
  severity: "error" | "warning" | "info";
  title: string;
  evidence: string;
  guidance: string;
}

export async function requestAiReview({
  source,
  sourcePath,
  viewportWidths,
  model,
  settings,
}: {
  source: string;
  sourcePath: string | null;
  viewportWidths: number[];
  model: string;
  settings: Settings;
}): Promise<{ model: string; findings: AiReviewFinding[] }> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/review/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      sourcePath,
      viewportWidths,
      model,
      openAiApiKey: settings.openAiApiKey,
      openAiBaseURL: settings.openAiBaseURL,
      anthropicApiKey: settings.anthropicApiKey,
      geminiApiKey: settings.geminiApiKey,
      copilotGithubToken: settings.copilotGithubToken,
      copilotUseLoggedInUser: settings.copilotUseLoggedInUser !== false,
      copilotSdkByok: toByokWirePayload(settings.copilotSdkByok),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : `AI review failed (HTTP ${response.status}).`
    );
  }
  return {
    model: typeof payload.model === "string" ? payload.model : model,
    findings: Array.isArray(payload.findings) ? payload.findings : [],
  };
}
