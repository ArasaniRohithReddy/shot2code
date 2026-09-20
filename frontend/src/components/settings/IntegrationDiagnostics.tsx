import { LuAlertTriangle, LuInfo } from "react-icons/lu";
import type { IntegrationDiagnostic } from "../../lib/integrations";

export interface IntegrationDiagnosticsProps {
  diagnostics: IntegrationDiagnostic[];
  /** Ties the list to whatever names it, e.g. the model picker heading. */
  idPrefix: string;
  className?: string;
}

const SCOPE_LABELS: Record<IntegrationDiagnostic["scope"], string> = {
  byok: "Copilot SDK BYOK",
  mcp: "MCP",
};

// Codes that mean "this is not running", which is worth a warning colour.
const WARNING_CODES = new Set(["invalid", "untrusted", "unsupported"]);

/**
 * Why part of the BYOK/MCP configuration is not in play.
 *
 * The backend sends these instead of failing a run, so they are the only place
 * a person finds out that a server is switched off or that Gemini stays on its
 * own key. Every message is produced by the backend from safe fields, so
 * nothing here can print a credential.
 */
export default function IntegrationDiagnostics({
  diagnostics,
  idPrefix,
  className = "",
}: IntegrationDiagnosticsProps) {
  if (diagnostics.length === 0) return null;

  return (
    <ul
      id={`${idPrefix}-integration-diagnostics`}
      aria-label="Integration notices"
      className={`space-y-1.5 ${className}`}
    >
      {diagnostics.map((diagnostic, index) => {
        const isWarning = WARNING_CODES.has(diagnostic.code);
        const Icon = isWarning ? LuAlertTriangle : LuInfo;
        return (
          <li
            key={`${diagnostic.scope}-${diagnostic.code}-${diagnostic.target ?? index}`}
            className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-4 ${
              isWarning
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
                : "border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
            }`}
          >
            <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{SCOPE_LABELS[diagnostic.scope]}</span>
              {diagnostic.target ? (
                <>
                  {" · "}
                  <span className="notranslate" translate="no">
                    {diagnostic.target}
                  </span>
                </>
              ) : null}
              {" — "}
              {diagnostic.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
