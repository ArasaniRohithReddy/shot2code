import { useEffect, useRef } from "react";
import type { AppCommand } from "../lib/app-shortcuts";
import {
  getDesktopMenuBridge,
  publishDesktopMenuState,
  subscribeToDesktopMenuCommands,
  type DesktopMenuState,
} from "../lib/desktop-menu";

interface Options {
  /** The shared dispatcher, the same one the keyboard shortcuts call. */
  onCommand: (command: AppCommand) => void;
  state: DesktopMenuState;
}

/**
 * Connect the app to the native desktop menu.
 *
 * Commands arrive on one long-lived subscription and are dispatched through a
 * ref, so re-rendering the app never detaches and re-attaches the IPC listener
 * - a dropped click mid-generation would be invisible and maddening.
 *
 * The state flows the other way, and only when it changes: the effect's
 * dependencies are the three primitives themselves, so a render that changes
 * nothing sends nothing.
 *
 * Outside the desktop app there is no bridge and every call is a no-op; the
 * dispatcher still shows its own toast when a command needs a project.
 */
export function useDesktopMenu({ onCommand, state }: Options) {
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;

  useEffect(
    () =>
      subscribeToDesktopMenuCommands(getDesktopMenuBridge(), (command) =>
        commandRef.current(command)
      ),
    []
  );

  const { hasProject, canExport, isChatPanelVisible } = state;
  useEffect(() => {
    publishDesktopMenuState(getDesktopMenuBridge(), {
      hasProject,
      canExport,
      isChatPanelVisible,
    });
  }, [hasProject, canExport, isChatPanelVisible]);
}

export default useDesktopMenu;
