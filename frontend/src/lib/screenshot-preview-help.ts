/**
 * What to tell someone whose screenshot preview is unavailable.
 *
 * The right answer depends entirely on how shot2code is running. From source,
 * the browser really is missing and one command installs it. In the packaged
 * desktop app the browser is bundled, so the same instruction is actively
 * wrong: there is no `backend/` directory, no `uv`, and running a Playwright
 * install would not touch the copy the app actually uses. A failure there means
 * the bundled shell could not start, which is a restart/reinstall problem.
 *
 * `window.__SHOT2CODE_APP__` is injected by the Electron preload, so its
 * presence is the discriminator. The pure function takes that as a flag to stay
 * testable in both shapes.
 */

export type PreviewRuntime = "packaged" | "source";

export interface PreviewRemediation {
  runtime: PreviewRuntime;
  title: string;
  /** Prose shown above any command. */
  body: string;
  /** The exact command to run, or null when there is nothing to run. */
  command: string | null;
  /** What to do after the command, or after a restart. */
  followUp: string;
  /** Offer the desktop diagnostic log. */
  showLogAction: boolean;
}

export const PLAYWRIGHT_INSTALL_COMMAND =
  "cd backend && uv run playwright install chromium-headless-shell";

export function previewRuntimeOf(isPackagedDesktop: boolean): PreviewRuntime {
  return isPackagedDesktop ? "packaged" : "source";
}

export function describePreviewRemediation(
  isPackagedDesktop: boolean
): PreviewRemediation {
  if (isPackagedDesktop) {
    return {
      runtime: "packaged",
      title: "Screenshot preview is unavailable",
      body: "shot2code ships with its own headless browser, but this copy could not start it. Nothing needs to be installed.",
      command: null,
      followUp:
        "Restart shot2code and check again. If it still fails, reinstall the app and open the diagnostic log — antivirus software quarantining the bundled browser is the usual cause.",
      showLogAction: true,
    };
  }

  return {
    runtime: "source",
    title: "Screenshot preview is unavailable",
    body: "Headless Chromium isn't installed for the backend, so the agent can't render and visually check its own output. Install it with:",
    command: PLAYWRIGHT_INSTALL_COMMAND,
    followUp:
      "Restart the backend, then choose Check again.",
    showLogAction: false,
  };
}

/** True when running inside the packaged Electron shell. */
export function isPackagedDesktopRuntime(): boolean {
  return (
    typeof window !== "undefined" && Boolean(window.__SHOT2CODE_APP__)
  );
}
