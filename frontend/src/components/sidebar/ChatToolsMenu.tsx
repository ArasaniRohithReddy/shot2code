import { useEffect, useMemo, useState } from "react";
import {
  LuCheck,
  LuExternalLink,
  LuLoader2,
  LuSettings,
  LuWrench,
} from "react-icons/lu";
import { HTTP_BACKEND_URL } from "../../config";
import { listInstalledSkills } from "../../lib/skills-client";
import { Button } from "../ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import {
  buildChatToolRows,
  type ChatToolAccess,
} from "./chat-tools";

export default function ChatToolsMenu({
  access,
  onManage,
}: {
  access: ChatToolAccess;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [screenshotPreviewAvailable, setScreenshotPreviewAvailable] = useState<
    boolean | null
  >(null);
  const [enabledSkills, setEnabledSkills] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void Promise.all([
      fetch(`${HTTP_BACKEND_URL}/api/capabilities`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) =>
          typeof payload?.screenshot_preview === "boolean"
            ? payload.screenshot_preview
            : null
        )
        .catch(() => null),
      listInstalledSkills(controller.signal)
        .then((skills) => skills.filter((skill) => skill.enabled).length)
        .catch(() => null),
    ]).then(([previewAvailable, skillCount]) => {
      if (controller.signal.aborted) return;
      setScreenshotPreviewAvailable(previewAvailable);
      setEnabledSkills(skillCount);
    });
    return () => controller.abort();
  }, [open]);

  const rows = useMemo(
    () =>
      buildChatToolRows(
        access,
        screenshotPreviewAvailable,
        enabledSkills
      ),
    [access, enabledSkills, screenshotPreviewAvailable]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="chat-tools-menu"
          className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Show tools available to Chat"
          title="Tools available to Chat"
        >
          <LuWrench className="h-[18px] w-[18px]" aria-hidden="true" />
          <span>Tools</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
      >
        <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-gray-950 dark:text-zinc-50">
            Tools available to this Chat
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400">
            Nothing paid, external, trusted or write-capable is enabled here
            without its separate Settings permission.
          </p>
        </div>
        <ul className="max-h-[min(28rem,65vh)] space-y-1 overflow-y-auto p-2">
          {rows.map((row) => (
            <li
              key={row.name}
              className="grid grid-cols-[1fr_auto] gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/70"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 dark:text-zinc-100">
                  {row.name}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-gray-500 dark:text-zinc-400">
                  {row.detail}
                </p>
              </div>
              <span
                className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-semibold ${
                  row.enabled === true
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : row.enabled === null
                      ? "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                }`}
              >
                {row.enabled === null ? (
                  <LuLoader2
                    className="h-3 w-3 animate-spin"
                    aria-hidden="true"
                  />
                ) : row.enabled ? (
                  <LuCheck className="h-3 w-3" aria-hidden="true" />
                ) : null}
                {row.status}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 p-3 dark:border-zinc-700">
          <a
            href="https://arasanirohithreddy.github.io/app-releases/shot2code/docs/user-guide/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 px-2 text-xs font-medium text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300"
          >
            Tool safety guide
            <LuExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <Button
            type="button"
            size="sm"
            className="min-h-11 gap-1.5"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <LuSettings className="h-3.5 w-3.5" aria-hidden="true" />
            Manage tools
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
