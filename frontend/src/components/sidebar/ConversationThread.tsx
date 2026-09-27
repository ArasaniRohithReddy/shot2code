import {
  LuAlertCircle,
  LuBan,
  LuCheck,
  LuCode2,
  LuLoader2,
  LuMousePointerClick,
} from "react-icons/lu";
import {
  buildConversationTurns,
  type ConversationTurn,
} from "./conversation-thread";
import type { Commit, CommitHash } from "../commits/types";

function AssistantState({ turn }: { turn: ConversationTurn }) {
  const common =
    "flex max-w-[88%] items-start gap-2 rounded-xl border px-3 py-2 text-xs";

  if (turn.imported) {
    return (
      <div className={`${common} border-gray-200 bg-white text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200`}>
        <LuCode2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>The project is open and ready to edit.</span>
      </div>
    );
  }

  if (turn.variantStatus === "generating") {
    return (
      <div className={`${common} border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-200`}>
        <LuLoader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        <span>Generating option {turn.variantIndex + 1}…</span>
      </div>
    );
  }

  if (turn.variantStatus === "error") {
    return (
      <div className={`${common} border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200`}>
        <LuAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Option {turn.variantIndex + 1} failed
          {turn.errorMessage ? `: ${turn.errorMessage}` : "."}
        </span>
      </div>
    );
  }

  if (turn.variantStatus === "cancelled") {
    return (
      <div className={`${common} border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300`}>
        <LuBan className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Option {turn.variantIndex + 1} was cancelled.</span>
      </div>
    );
  }

  return (
    <div className={`${common} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200`}>
      <LuCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Option {turn.variantIndex + 1} is ready
        {turn.model ? ` · ${turn.model}` : ""}.
      </span>
    </div>
  );
}

export default function ConversationThread({
  commits,
  head,
  onOpenImage,
}: {
  commits: Record<CommitHash, Commit>;
  head: CommitHash | null;
  onOpenImage: (image: string) => void;
}) {
  const turns = buildConversationTurns(commits, head);

  return (
    <ol
      className="space-y-4 pb-4"
      aria-label="Conversation history for the selected branch"
      data-testid="conversation-thread"
    >
      {turns.map((turn) => (
        <li key={turn.commitHash} className="space-y-2">
          <div className="flex flex-col items-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-violet-100 px-4 py-2.5 dark:bg-violet-900/30">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-violet-950 dark:text-violet-100">
                {turn.prompt}
              </p>
              {turn.selectedElementTag && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-violet-700 dark:text-violet-300">
                  <LuMousePointerClick className="h-3 w-3" aria-hidden="true" />
                  <span>
                    Selected{" "}
                    <code className="rounded bg-violet-200/60 px-1 py-0.5 font-mono text-[10px] dark:bg-violet-800/50">
                      &lt;{turn.selectedElementTag}&gt;
                    </code>
                  </span>
                </div>
              )}
            </div>

            {turn.images.length > 0 && (
              <div className="mt-2 flex max-w-full flex-wrap justify-end gap-2">
                {turn.images.slice(0, 4).map((image, imageIndex) => (
                  <button
                    key={`${turn.commitHash}-image-${imageIndex}`}
                    type="button"
                    onClick={() => onOpenImage(image)}
                    className="cursor-zoom-in rounded-lg border border-gray-200 bg-white p-1 transition-colors hover:border-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-violet-500"
                  >
                    <img
                      src={image}
                      alt={`Reference ${imageIndex + 1} for this message`}
                      className="h-20 w-20 object-contain"
                      loading="lazy"
                    />
                  </button>
                ))}
                {turn.images.length > 4 && (
                  <span className="self-center text-xs text-gray-500 dark:text-zinc-400">
                    +{turn.images.length - 4} more
                  </span>
                )}
              </div>
            )}

            {turn.videos.length > 0 && (
              <div className="mt-2 w-full max-w-[88%] space-y-2">
                {turn.videos.map((video, videoIndex) => (
                  <video
                    key={`${turn.commitHash}-video-${videoIndex}`}
                    src={video}
                    className="w-full rounded-lg border border-gray-200 dark:border-zinc-700"
                    controls
                    preload="metadata"
                  />
                ))}
              </div>
            )}
          </div>

          <AssistantState turn={turn} />
          {turn.assistantMessages.map((message, messageIndex) => (
            <details
              key={`${turn.commitHash}-assistant-${messageIndex}`}
              className="max-w-[92%] rounded-xl border border-gray-200 bg-white text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              open={message.kind === "message"}
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
                {message.kind === "code"
                  ? "Generated source response"
                  : "AI response"}
              </summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-gray-100 p-3 font-sans text-xs leading-5 dark:border-zinc-800">
                {message.text}
              </pre>
            </details>
          ))}
        </li>
      ))}
    </ol>
  );
}
