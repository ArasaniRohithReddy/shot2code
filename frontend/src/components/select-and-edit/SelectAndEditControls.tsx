import { LuMousePointerClick, LuX } from "react-icons/lu";
import { useAppStore } from "../../store/app-store";

// Select-and-edit toggle in the preview toolbar, next to the device/code
// tabs — the "inspect element" spot users know from devtools. While select
// mode is on it becomes an explicit exit button.
export function SelectAndEditToolbarButton() {
  const { inSelectAndEditMode, toggleInSelectAndEditMode } = useAppStore();
  return (
    <button
      type="button"
      onClick={toggleInSelectAndEditMode}
      data-testid="select-edit-toggle"
      title={
        inSelectAndEditMode
          ? "Exit selection mode"
          : "Select an element in the preview to target your edit"
      }
      aria-label={
        inSelectAndEditMode
          ? "Exit selection mode"
          : "Select an element in the preview to target your edit"
      }
      className={`inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-lg border p-0 text-xs font-medium transition-colors sm:w-auto sm:px-3 ${
        inSelectAndEditMode
          ? "bg-violet-600 border-violet-600 text-white hover:bg-violet-700"
          : "bg-white border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-violet-500 dark:hover:text-violet-300"
      }`}
    >
      {inSelectAndEditMode ? (
        <>
          <LuX className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Exit select mode</span>
        </>
      ) : (
        <>
          <LuMousePointerClick className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Select & edit</span>
        </>
      )}
    </button>
  );
}
