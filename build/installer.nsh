!macro customInstall
  CreateShortCut "$SMPROGRAMS\MCO Background Sync.lnk" "$INSTDIR\MCO.exe" "--background"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\MCO Background Sync.lnk"
!macroend
