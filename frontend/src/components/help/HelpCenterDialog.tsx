import { useState, type ComponentType } from "react";
import toast from "react-hot-toast";
import {
  LuBookOpen,
  LuBug,
  LuDownload,
  LuExternalLink,
  LuFileText,
  LuGithub,
  LuHistory,
  LuLifeBuoy,
  LuPackage,
  LuRocket,
  LuScale,
  LuShieldCheck,
  LuWrench,
} from "react-icons/lu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { APP_SHORTCUTS, displayShortcutKeys } from "../../lib/app-shortcuts";
import {
  HELP_CONTEXTUAL_SHORTCUTS,
  HELP_GET_STARTED_STEPS,
  HELP_SECTIONS,
  type HelpIconName,
  type HelpResourceLink,
} from "../../lib/help-resources";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Which tab to land on. Help ▸ Keyboard shortcuts in the desktop menu opens
   * the same dialog straight on the keys.
   */
  initialTab?: HelpTabId;
  /**
   * Injected by tests. In the app this comes from the desktop preload bridge,
   * which resolves to an empty string on success and to the reason on failure.
   */
  openDiagnosticLogs?: (() => Promise<string>) | null;
}

export type HelpTabId = "get-started" | "guides" | "support" | "shortcuts";

const SHORTCUT_GROUPS = ["Project", "Workspace", "Help"] as const;

const ICONS: Record<HelpIconName, ComponentType<{ className?: string }>> = {
  book: LuBookOpen,
  bug: LuBug,
  download: LuDownload,
  github: LuGithub,
  history: LuHistory,
  package: LuPackage,
  question: LuLifeBuoy,
  rocket: LuRocket,
  scale: LuScale,
  shield: LuShieldCheck,
  support: LuLifeBuoy,
  wrench: LuWrench,
};

const ROW =
  "flex min-h-11 w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-zinc-800";
const ROW_TITLE =
  "flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-zinc-100";
const ROW_DETAIL =
  "mt-0.5 block text-xs leading-relaxed text-gray-600 dark:text-zinc-400";
const ROW_ICON = "mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300";
const KEY_CAP =
  "min-w-7 rounded border border-gray-300 bg-gray-50 px-1.5 py-1 text-center font-mono text-[11px] font-semibold text-gray-700 shadow-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200";
const SUB_HEADING =
  "mt-4 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400";

function HelpLinkRow({ link }: { link: HelpResourceLink }) {
  const Icon = ICONS[link.icon];
  return (
    <li>
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        data-testid={`help-link-${link.id}`}
        className={ROW}
      >
        <Icon className={ROW_ICON} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={ROW_TITLE}>
            {link.title}
            <LuExternalLink
              className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-zinc-500"
              aria-hidden="true"
            />
            <span className="sr-only">(opens in your browser)</span>
          </span>
          <span className={ROW_DETAIL}>{link.description}</span>
        </span>
      </a>
    </li>
  );
}

/**
 * The Help centre's tabbed body.
 *
 * Split from the dialog so it can be rendered - and asserted - without a
 * portal: Radix renders dialog content only after mount, which would make an
 * accessibility test of the markup impossible.
 */
export function HelpCenterPanels({
  initialTab = "get-started",
  openDiagnosticLogs,
}: {
  initialTab?: HelpTabId;
  openDiagnosticLogs?: (() => Promise<string>) | null;
}) {
  const [tab, setTab] = useState<HelpTabId>(initialTab);
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  // Present only in the packaged desktop app; the browser build writes no log
  // file, so the action says so instead of pretending to work.
  const openLogs =
    openDiagnosticLogs ??
    (typeof window === "undefined"
      ? null
      : (window.__SHOT2CODE_APP__?.openLogs ?? null));

  const handleOpenLogs = async () => {
    if (!openLogs) return;
    try {
      // Electron's shell.openPath resolves to "" on success, or to the reason
      // it failed. Reporting success either way would be a lie.
      const failure = await openLogs();
      if (failure) {
        toast.error(`Could not open the diagnostic log: ${failure}`);
        return;
      }
      toast.success("Opened the diagnostic log in your default application.");
    } catch (error) {
      console.error("Could not open the diagnostic log", error);
      toast.error("Could not open the diagnostic log.");
    }
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as HelpTabId)}
      className="flex min-h-0 min-w-0 flex-col"
    >
      {/* The list scrolls sideways rather than shrinking its targets, so
          every tab keeps a 44px hit area on a narrow phone. */}
      <div className="shrink-0 overflow-x-auto px-4 pt-4 sm:px-6">
        <TabsList className="w-max">
          <TabsTrigger value="get-started" data-testid="help-tab-get-started">
            Get started
          </TabsTrigger>
          <TabsTrigger value="guides" data-testid="help-tab-guides">
            Guides
          </TabsTrigger>
          <TabsTrigger value="support" data-testid="help-tab-support">
            Support
          </TabsTrigger>
          <TabsTrigger value="shortcuts" data-testid="help-tab-shortcuts">
            Keyboard shortcuts
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        {HELP_SECTIONS.map((section) => (
          <TabsContent key={section.id} value={section.id}>
            <p className="px-2 pt-1 text-sm text-gray-600 dark:text-zinc-400">
              {section.intro}
            </p>

            {section.id === "get-started" && (
              <ol className="mt-3 space-y-3 px-2">
                {HELP_GET_STARTED_STEPS.map((step, index) => (
                  <li key={step.id} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 dark:text-zinc-100">
                        {step.title}
                      </span>
                      <span className={ROW_DETAIL}>{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <h3 className={SUB_HEADING}>
              {section.id === "support" ? "Where to go" : "Read more"}
            </h3>
            <ul className="mt-1">
              {section.links.map((link) => (
                <HelpLinkRow key={link.id} link={link} />
              ))}
            </ul>

            {section.id === "support" && (
              <>
                <h3 className={SUB_HEADING}>On this machine</h3>
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={handleOpenLogs}
                    disabled={!openLogs}
                    aria-disabled={!openLogs}
                    data-testid="open-diagnostic-logs"
                    className={`${ROW} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent`}
                  >
                    <LuFileText className={ROW_ICON} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={ROW_TITLE}>Open diagnostic logs</span>
                      <span className={ROW_DETAIL}>
                        {openLogs
                          ? "Opens the log this app writes for backend startup, renderer crashes and console errors. Attach it to a bug report."
                          : "Only the desktop app writes a log file. Running in a browser, there is nothing to open."}
                      </span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </TabsContent>
        ))}

        <TabsContent value="shortcuts">
          <p className="px-2 pt-1 text-sm text-gray-600 dark:text-zinc-400">
            Navigation shortcuts pause while you type or while another dialog is
            open.
          </p>

          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} aria-labelledby={`help-shortcut-group-${group}`}>
              <h3 id={`help-shortcut-group-${group}`} className={SUB_HEADING}>
                {group}
              </h3>
              <dl className="mt-1 divide-y divide-gray-100 dark:divide-zinc-800">
                {APP_SHORTCUTS.filter(
                  (shortcut) => shortcut.group === group
                ).map((shortcut) => (
                  <div
                    key={shortcut.command}
                    className="flex min-h-11 items-center justify-between gap-4 px-2 py-2"
                  >
                    <dt className="text-sm text-gray-700 dark:text-zinc-300">
                      {shortcut.label}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {displayShortcutKeys(shortcut.keys, isMac).map(
                        (key, index) => (
                          <kbd
                            key={`${shortcut.command}-${key}-${index}`}
                            className={KEY_CAP}
                          >
                            {key}
                          </kbd>
                        )
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section aria-labelledby="help-shortcut-group-contextual">
            <h3 id="help-shortcut-group-contextual" className={SUB_HEADING}>
              While a control has focus
            </h3>
            <dl className="mt-1 divide-y divide-gray-100 dark:divide-zinc-800">
              {HELP_CONTEXTUAL_SHORTCUTS.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex min-h-11 items-center justify-between gap-4 px-2 py-2"
                >
                  <dt className="min-w-0">
                    <span className="block text-sm text-gray-700 dark:text-zinc-300">
                      {shortcut.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-zinc-500">
                      {shortcut.detail}
                    </span>
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key, index) => (
                      <kbd
                        key={`${shortcut.id}-${key}-${index}`}
                        className={KEY_CAP}
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </TabsContent>
      </div>
    </Tabs>
  );
}

/**
 * The single place a user goes for help.
 *
 * It replaced a shortcuts-only dialog, so Ctrl+/ still opens it and every
 * shortcut is still here - now alongside the setup path, the published
 * documents and the support routes. Links point at the release hub and open in
 * the system browser: the desktop shell turns a `target="_blank"` http(s) link
 * into `shell.openExternal`, and the browser build opens a tab.
 */
function HelpCenterDialog({
  open,
  onOpenChange,
  initialTab = "get-started",
  openDiagnosticLogs,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-gray-200 px-4 py-4 pr-14 dark:border-zinc-800 sm:px-6">
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>
            Set shot2code up, read the published guides, get support, or learn
            the keyboard. Links open in your browser.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the requested tab so asking for the shortcuts while Help
            is already open actually moves to them. */}
        <HelpCenterPanels
          key={initialTab}
          initialTab={initialTab}
          openDiagnosticLogs={openDiagnosticLogs}
        />
      </DialogContent>
    </Dialog>
  );
}

export default HelpCenterDialog;
