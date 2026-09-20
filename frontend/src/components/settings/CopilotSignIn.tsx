import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuAlertTriangle,
  LuExternalLink,
  LuGithub,
  LuLoader,
  LuX,
} from "react-icons/lu";
import {
  COPILOT_LOGIN_POLL_INTERVAL_MS,
  IDLE_COPILOT_LOGIN,
  cancelCopilotLogin,
  describeCopilotLoginMethod,
  isPollingLoginStatus,
  pollCopilotLogin,
  startCopilotLogin,
  type CopilotLoginState,
} from "../../lib/copilot-login";

export interface CopilotSignInProps {
  /** Called once the backend reports a session exists, to re-probe. */
  onSignedIn: () => void | Promise<void>;
  /** Injectable for tests; defaults to the real endpoints. */
  client?: {
    start: () => Promise<CopilotLoginState>;
    poll: () => Promise<CopilotLoginState>;
    cancel: () => Promise<CopilotLoginState>;
  };
  /** Seed state, used by tests to render a phase directly. */
  initialState?: CopilotLoginState;
}

const BUTTON_CLASS =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

/**
 * Start the official GitHub Copilot sign-in from Settings.
 *
 * The backend shells out to the Copilot CLI's web flow (or the GitHub CLI),
 * which opens a browser and stores the credential in that tool's own keychain.
 * shot2code never sees the token, so this component can only ever report the
 * status the backend polls out of the CLI - there is no path here that fakes a
 * success, and the signed-in line above is refreshed from the real capability
 * probe rather than from this flow's own optimism.
 *
 * It is purely additive: the token field and the `gh auth login` / `copilot`
 * instructions remain, and are the stated fallback whenever this is
 * unavailable.
 */
export default function CopilotSignIn({
  onSignedIn,
  client,
  initialState,
}: CopilotSignInProps) {
  const [state, setState] = useState<CopilotLoginState>(
    initialState ?? IDLE_COPILOT_LOGIN
  );
  const [isBusy, setIsBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Kept in a ref so the polling effect never restarts when the callback
  // identity changes mid-flow.
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const start = client?.start ?? startCopilotLogin;
  const poll = client?.poll ?? pollCopilotLogin;
  const abandon = client?.cancel ?? cancelCopilotLogin;
  const startRef = useRef(start);
  startRef.current = start;
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const cancelRef = useRef(abandon);
  cancelRef.current = abandon;

  const isPolling = isPollingLoginStatus(state.status);

  useEffect(() => {
    if (!isPolling) return;
    let active = true;
    const timer = setInterval(() => {
      void pollRef
        .current()
        .then((next) => {
          if (!active) return;
          setState(next);
          if (next.status === "succeeded") void onSignedInRef.current();
        })
        .catch((caught) => {
          if (!active) return;
          // A dropped poll is not a failed sign-in; the flow may still be
          // open in the browser, so only the message is surfaced.
          setRequestError(
            caught instanceof Error
              ? caught.message
              : "Lost contact with the backend while signing in."
          );
        });
    }, COPILOT_LOGIN_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isPolling]);

  const runStart = useCallback(async () => {
    setIsBusy(true);
    setRequestError(null);
    try {
      const next = await startRef.current();
      setState(next);
      if (next.status === "succeeded") await onSignedInRef.current();
    } catch (caught) {
      setRequestError(
        caught instanceof Error
          ? caught.message
          : "Could not start the sign-in flow."
      );
    } finally {
      setIsBusy(false);
    }
  }, []);

  const runCancel = useCallback(async () => {
    setIsBusy(true);
    try {
      setState(await cancelRef.current());
    } catch {
      setState((current) => ({
        ...current,
        status: "cancelled",
        canCancel: false,
        message: "Sign-in cancelled.",
      }));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const methodLabel = describeCopilotLoginMethod(state.method);
  const unavailable = state.status === "unavailable";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isPolling && (
          <button
            type="button"
            onClick={() => void runStart()}
            disabled={isBusy || unavailable}
            data-testid="copilot-signin-start"
            className={BUTTON_CLASS}
          >
            {isBusy ? (
              <LuLoader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LuGithub aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {state.status === "failed" || state.status === "cancelled"
              ? "Try signing in again"
              : "Sign in with GitHub"}
          </button>
        )}

        {isPolling && (
          <>
            <span
              data-testid="copilot-signin-progress"
              className="inline-flex min-h-11 items-center gap-2 text-xs text-gray-600 dark:text-zinc-300"
            >
              <LuLoader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              {state.status === "starting"
                ? "Starting the sign-in flow…"
                : "Waiting for you to finish in the browser…"}
            </span>
            {state.canCancel && (
              <button
                type="button"
                onClick={() => void runCancel()}
                disabled={isBusy}
                data-testid="copilot-signin-cancel"
                className={BUTTON_CLASS}
              >
                <LuX aria-hidden="true" className="h-3.5 w-3.5" />
                Cancel
              </button>
            )}
          </>
        )}
      </div>

      <p className="text-xs leading-5 text-gray-500 dark:text-zinc-400">
        This opens the official{" "}
        {methodLabel ?? "GitHub Copilot CLI"} sign-in page in your browser. The
        credential is stored by that tool on this device — shot2code never
        receives or saves your token.
      </p>

      <div aria-live="polite" className="space-y-2">
        {state.message && state.status !== "idle" && (
          <p
            data-testid="copilot-signin-message"
            role={
              state.status === "failed" || state.status === "unavailable"
                ? "alert"
                : undefined
            }
            className={
              state.status === "succeeded"
                ? "text-xs text-emerald-700 dark:text-emerald-300"
                : state.status === "failed"
                  ? "text-xs text-red-600 dark:text-red-400"
                  : "text-xs text-gray-600 dark:text-zinc-300"
            }
          >
            {state.message}
          </p>
        )}

        {requestError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {requestError}
          </p>
        )}

        {unavailable && (
          <div
            data-testid="copilot-signin-unavailable"
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
          >
            <LuAlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
            />
            <div className="min-w-0">
              <p>
                Browser sign-in isn't available here. You can still sign in from
                a terminal, or paste a token below.
              </p>
              {state.installUrl && (
                <a
                  href={state.installUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-testid="copilot-signin-install-link"
                  className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  Installation instructions
                  <LuExternalLink aria-hidden="true" className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
