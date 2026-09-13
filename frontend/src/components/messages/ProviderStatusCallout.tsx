import { LuExternalLink, LuKeyRound, LuSettings } from "react-icons/lu";
import {
  summarizeProviderStatus,
  type ProviderSettings,
} from "../../lib/provider-status";

const SETUP_GUIDE_URL =
  "https://github.com/ArasaniRohithReddy/shot2code/blob/main/Troubleshooting.md";

interface Props {
  settings: ProviderSettings;
  onOpenSettings: () => void;
}

/**
 * Shown only while this browser has no saved credential. It states what is and
 * is not known rather than predicting success or failure, because the backend
 * may hold credentials the frontend cannot see.
 */
export function ProviderStatusCallout({ settings, onOpenSettings }: Props) {
  const status = summarizeProviderStatus(settings);
  if (status.hasLocalCredentials) return null;

  return (
    <section
      aria-labelledby="provider-status-title"
      className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start gap-2.5">
        <LuKeyRound
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300"
        />
        <div className="min-w-0">
          <h2
            id="provider-status-title"
            className="text-[13px] font-semibold text-gray-900 dark:text-zinc-100"
          >
            {status.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-zinc-400">
            {status.detail}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-950/40"
        >
          <LuSettings aria-hidden="true" className="h-3.5 w-3.5" />
          Add a key in Settings
        </button>
        <a
          href={SETUP_GUIDE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <LuExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          Setup guide
        </a>
      </div>
    </section>
  );
}

export default ProviderStatusCallout;
