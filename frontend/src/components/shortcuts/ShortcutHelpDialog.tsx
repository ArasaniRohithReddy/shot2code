import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  APP_SHORTCUTS,
  displayShortcutKeys,
} from "../../lib/app-shortcuts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUPS = ["Project", "Workspace", "Help"] as const;

function ShortcutHelpDialog({ open, onOpenChange }: Props) {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Navigate the workspace without leaving the keyboard. Navigation
            shortcuts pause while you type or while another dialog is open.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group} aria-labelledby={`shortcut-group-${group}`}>
              <h3
                id={`shortcut-group-${group}`}
                className="mb-2 text-sm font-semibold text-gray-900 dark:text-zinc-100"
              >
                {group}
              </h3>
              <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-zinc-800 dark:border-zinc-700">
                {APP_SHORTCUTS.filter(
                  (shortcut) => shortcut.group === group
                ).map((shortcut) => (
                  <div
                    key={shortcut.command}
                    className="flex min-h-12 items-center justify-between gap-4 px-3 py-2"
                  >
                    <dt className="text-sm text-gray-700 dark:text-zinc-300">
                      {shortcut.label}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {displayShortcutKeys(shortcut.keys, isMac).map(
                        (key, index) => (
                          <kbd
                            key={`${shortcut.command}-${key}-${index}`}
                            className="min-w-7 rounded border border-gray-300 bg-gray-50 px-1.5 py-1 text-center font-mono text-[11px] font-semibold text-gray-700 shadow-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ShortcutHelpDialog;
