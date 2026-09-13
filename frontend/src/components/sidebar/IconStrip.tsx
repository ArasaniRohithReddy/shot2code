import {
  LuClock,
  LuCode,
  LuKeyboard,
  LuPlus,
  LuSettings,
} from "react-icons/lu";

interface IconStripProps {
  isHistoryOpen: boolean;
  isEditorOpen: boolean;
  isSettingsOpen: boolean;
  showHistory: boolean;
  showEditor: boolean;
  onToggleHistory: () => void;
  onToggleEditor: () => void;
  onLogoClick: () => void;
  onNewProject: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
}

function IconStrip({
  isHistoryOpen,
  isEditorOpen,
  isSettingsOpen,
  showHistory,
  showEditor,
  onToggleHistory,
  onToggleEditor,
  onLogoClick,
  onNewProject,
  onOpenShortcuts,
  onOpenSettings,
}: IconStripProps) {
  return (
    <div className="flex w-full items-center justify-between border-b border-gray-200 bg-gray-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900 xl:h-full xl:w-16 xl:flex-col xl:items-center xl:gap-y-3 xl:border-b-0 xl:border-r xl:px-0 xl:py-4">
      {/* Logo */}
      <button
        onClick={onLogoClick}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors hover:bg-gray-200/70 dark:hover:bg-zinc-800 xl:mb-2 xl:p-1"
      >
        <img
          src="./favicon/main.png"
          alt="Logo"
          className="w-5 h-5 dark:invert"
        />
      </button>

      <div className="flex items-center gap-1 xl:contents xl:flex-col xl:gap-0">
        {/* Editor */}
        {showEditor && (
          <button
            onClick={onToggleEditor}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5 ${
              isEditorOpen
                ? "text-gray-900 dark:text-white"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            }`}
            title="Editor (Ctrl+1)"
            aria-pressed={isEditorOpen}
          >
            <LuCode className="w-[18px] h-[18px]" />
            <span className="hidden text-[10px] leading-none xl:block">Editor</span>
          </button>
        )}

        {/* Versions */}
        {showHistory && (
          <button
            onClick={onToggleHistory}
            className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5 ${
              isHistoryOpen
                ? "text-gray-900 dark:text-white"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            }`}
            title="Versions (Ctrl+4)"
            aria-pressed={isHistoryOpen}
          >
            <LuClock className="w-[18px] h-[18px]" />
            <span className="hidden text-[10px] leading-none xl:block">Versions</span>
          </button>
        )}

        <button
          onClick={onNewProject}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-violet-100 p-2 text-violet-700 transition-colors hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60 xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5"
          title="Start a new project (Ctrl+Alt+N)"
        >
          <LuPlus className="w-[18px] h-[18px]" />
          <span className="hidden text-[10px] font-medium leading-none xl:block">New</span>
        </button>
      </div>

      {/* Spacer pushes settings to bottom */}
      <div className="hidden flex-1 xl:block" />

      <div className="flex items-center gap-1 xl:contents">
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5"
          title="Keyboard shortcuts (Ctrl+/)"
        >
          <LuKeyboard className="h-[18px] w-[18px]" />
          <span className="hidden text-[10px] leading-none xl:block">
            Shortcuts
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-pressed={isSettingsOpen}
          className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5 ${
            isSettingsOpen
              ? "text-gray-900 dark:text-white"
              : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          }`}
          title="Settings (Ctrl+Alt+S)"
        >
          <LuSettings className="h-[18px] w-[18px]" />
          <span className="hidden text-[10px] leading-none xl:block">
            Settings
          </span>
        </button>
      </div>
    </div>
  );
}

export default IconStrip;
