import { useEffect } from "react";
import { useAppStore } from "../../store/app-store";

// Escape exits select-and-edit mode. Key presses inside the preview iframe
// are handled in PreviewComponent; this covers the rest of the app.
export function useEscapeToExitSelectMode() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target =
        event.target instanceof HTMLElement ? event.target : null;
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        target?.closest("[role='dialog']")
      ) {
        return;
      }
      const store = useAppStore.getState();
      if (store.inSelectAndEditMode) {
        store.disableInSelectAndEditMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
