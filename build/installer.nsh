!macro customInstall
  # Tray-only background sync launcher. It must carry the same AppUserModelID the
  # app sets at runtime (`app.setAppUserModelId` in src/main/index.ts): Windows
  # resolves a toast's icon and display name from the Start Menu shortcut that
  # declares that AUMID, so without it notifications fall back to a generic icon
  # and attribution. electron-builder does this for the shortcuts it creates
  # (templates/nsis/include/installer.nsh) but not for ones added here.
  CreateShortCut "$SMPROGRAMS\MCO Background Sync.lnk" "$INSTDIR\MCO.exe" "--background" \
    "$INSTDIR\MCO.exe" 0 "" "" "MCO background sync (tray only)"
  # clear error (if shortcut already exists)
  ClearErrors
  WinShell::SetLnkAUMI "$SMPROGRAMS\MCO Background Sync.lnk" "${APP_ID}"
!macroend

!macro customUnInstall
  WinShell::UninstShortcut "$SMPROGRAMS\MCO Background Sync.lnk"
  Delete "$SMPROGRAMS\MCO Background Sync.lnk"
!macroend
