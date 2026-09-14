import {
  LuHistory,
  LuKeyboard,
  LuMessageSquare,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPlus,
  LuSettings,
} from "react-icons/lu";

interface IconStripProps {
  isHistoryOpen: boolean;
  isConversationOpen: boolean;
  isSettingsOpen: boolean;
  showHistory: boolean;
  showConversation: boolean;
  /** `true` once the layout is wide enough for the conversation to be a column. */
  canCollapseConversation: boolean;
  onToggleHistory: () => void;
  onToggleConversation: () => void;
  onLogoClick: () => void;
  onNewProject: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
}

const RAIL_BUTTON =
  "flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5";
const RAIL_ACTIVE = "text-gray-900 dark:text-white";
const RAIL_IDLE =
  "text-gray-500 hover:bg-gray-200/70 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

function IconStrip({
  isHistoryOpen,
  isConversationOpen,
  isSettingsOpen,
  showHistory,
  showConversation,
  canCollapseConversation,
  onToggleHistory,
  onToggleConversation,
  onLogoClick,
  onNewProject,
  onOpenShortcuts,
  onOpenSettings,
}: IconStripProps) {
  const ConversationIcon = !canCollapseConversation
    ? LuMessageSquare
    : isConversationOpen
      ? LuPanelLeftClose
      : LuPanelLeftOpen;

  const conversationTitle = !canCollapseConversation
    ? "Chat (Ctrl+3)"
    : isConversationOpen
      ? "Hide chat panel (Ctrl+3)"
      : "Show chat panel (Ctrl+3)";

  return (
    <div className="flex w-full items-center justify-between border-b border-gray-200 bg-gray-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900 xl:h-full xl:w-16 xl:flex-col xl:items-center xl:gap-y-3 xl:border-b-0 xl:border-r xl:px-0 xl:py-4">
      {/* Logo */}
      <button
        onClick={onLogoClick}
        title="Back to the workspace"
        aria-label="Back to the workspace"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors duration-200 hover:bg-gray-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-zinc-800 xl:mb-2 xl:p-1"
      >
        <img
          src="./favicon/main.png"
          alt="Logo"
          className="w-5 h-5 dark:invert"
        />
      </button>

      <div className="flex items-center gap-1 xl:contents xl:flex-col xl:gap-0">
        {showConversation && (
          <button
            onClick={onToggleConversation}
            className={`${RAIL_BUTTON} ${
              isConversationOpen ? RAIL_ACTIVE : RAIL_IDLE
            }`}
            title={conversationTitle}
            aria-label={conversationTitle}
            aria-pressed={isConversationOpen}
            aria-controls="conversation-panel"
            aria-expanded={
              canCollapseConversation ? isConversationOpen : undefined
            }
            data-testid="toggle-conversation"
          >
            <ConversationIcon className="w-[18px] h-[18px]" aria-hidden="true" />
            <span className="hidden text-[10px] leading-none xl:block">
              Chat
            </span>
          </button>
        )}

        {showHistory && (
          <button
            onClick={onToggleHistory}
            className={`${RAIL_BUTTON} ${isHistoryOpen ? RAIL_ACTIVE : RAIL_IDLE}`}
            title="History (Ctrl+4)"
            aria-label="History (Ctrl+4)"
            aria-pressed={isHistoryOpen}
            data-testid="toggle-history"
          >
            <LuHistory className="w-[18px] h-[18px]" aria-hidden="true" />
            <span className="hidden text-[10px] leading-none xl:block">
              History
            </span>
          </button>
        )}

        <button
          onClick={onNewProject}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-violet-100 p-2 text-violet-700 transition-colors duration-200 hover:bg-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60 xl:flex-col xl:gap-1 xl:px-2 xl:py-1.5"
          title="Start a new project (Ctrl+Alt+N)"
          aria-label="Start a new project (Ctrl+Alt+N)"
        >
          <LuPlus className="w-[18px] h-[18px]" aria-hidden="true" />
          <span className="hidden text-[10px] font-medium leading-none xl:block">
            New
          </span>
        </button>
      </div>

      {/* Spacer pushes settings to bottom */}
      <div className="hidden flex-1 xl:block" />

      <div className="flex items-center gap-1 xl:contents">
        <button
          type="button"
          onClick={onOpenShortcuts}
          className={`${RAIL_BUTTON} ${RAIL_IDLE}`}
          title="Keyboard shortcuts (Ctrl+/)"
          aria-label="Keyboard shortcuts (Ctrl+/)"
        >
          <LuKeyboard className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="hidden text-[10px] leading-none xl:block">
            Shortcuts
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-pressed={isSettingsOpen}
          className={`${RAIL_BUTTON} ${isSettingsOpen ? RAIL_ACTIVE : RAIL_IDLE}`}
          title="Settings (Ctrl+Alt+S)"
          aria-label="Settings (Ctrl+Alt+S)"
        >
          <LuSettings className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="hidden text-[10px] leading-none xl:block">
            Settings
          </span>
        </button>
      </div>
    </div>
  );
}

export default IconStrip;
