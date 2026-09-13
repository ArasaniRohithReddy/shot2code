import { LuArrowUpRight, LuMousePointerClick, LuSparkles } from "react-icons/lu";
import {
  getConversationStarters,
  type ConversationStarterVariant,
} from "../../lib/conversation-starters";

interface Props {
  variant: ConversationStarterVariant;
  onUseStarter: (instruction: string) => void;
  onOpenCode: () => void;
}

/**
 * The first thing a user sees after importing or generating. An empty column
 * teaches nothing, so this names what the panel does and offers concrete
 * openers that land in the composer, still editable before sending.
 */
export function ConversationEmptyState({
  variant,
  onUseStarter,
  onOpenCode,
}: Props) {
  const starters = getConversationStarters(variant);

  return (
    <section
      aria-labelledby="conversation-empty-title"
      data-testid="conversation-empty-state"
      className="mb-4 rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <div className="flex items-center gap-2">
        <LuSparkles
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300"
        />
        <h2
          id="conversation-empty-title"
          className="text-[13px] font-semibold text-gray-900 dark:text-zinc-100"
        >
          {variant === "imported"
            ? "Your project is loaded. What should change?"
            : "First version is ready. What should change?"}
        </h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-zinc-400">
        Describe a change below and every edit becomes a new version you can
        compare or roll back. Start from one of these:
      </p>

      <ul className="mt-2.5 space-y-1">
        {starters.map((starter) => (
          <li key={starter.id}>
            <button
              type="button"
              onClick={() => onUseStarter(starter.instruction)}
              title={starter.instruction}
              className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 text-left text-xs font-medium text-gray-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-violet-500/60 dark:hover:bg-violet-950/40 dark:hover:text-violet-100"
            >
              <span className="min-w-0 truncate">{starter.label}</span>
              <LuArrowUpRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors group-hover:text-violet-600 dark:text-zinc-500 dark:group-hover:text-violet-300"
              />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-zinc-500">
        <span className="inline-flex items-start gap-1">
          <LuMousePointerClick
            aria-hidden="true"
            className="mt-0.5 h-3 w-3 shrink-0"
          />
          <span>Pick an element in the preview to target one edit</span>
        </span>
        <button
          type="button"
          onClick={onOpenCode}
          className="rounded font-medium text-violet-700 underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300"
        >
          Or read the source in Code
        </button>
      </div>
    </section>
  );
}

export default ConversationEmptyState;
