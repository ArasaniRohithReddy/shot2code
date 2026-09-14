!macro customInit
  ; initMultiUser has already resolved the existing per-user/per-machine
  ; installation directory into $INSTDIR. Run before uninstallOldVersion and
  ; installApplicationFiles so even older clients cannot leave the frozen
  ; backend, Playwright driver, or Chromium tree locking the payload.
  ;
  ; Run this even when the main backend exe is already missing. A previously
  ; interrupted update can leave only a child executable or a partial backend
  ; directory behind, and those processes can still lock files in the payload.
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-installed-backend.ps1 "${BUILD_RESOURCES_DIR}\stop-installed-backend.ps1"

  StrCpy $2 "$TEMP\shot2code-installer-preinstall.log"
  DetailPrint "Stopping the installed shot2code backend process tree..."
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-installed-backend.ps1" -InstallDir "$INSTDIR" -LogPath "$2"'
  Pop $0
  Pop $1
  DetailPrint "$1"

  ${If} $0 != "0"
    DetailPrint "Pre-install shutdown failed with exit code $0. Log: $2"
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "shot2code could not stop its installed backend safely, so no files were replaced.$\r$\n$\r$\nClose shot2code and try the installation again.$\r$\n$\r$\nDiagnostic log: $2"
    ${EndIf}
    SetErrorLevel 23
    Quit
  ${EndIf}
!macroend
