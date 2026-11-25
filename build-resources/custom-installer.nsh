!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to aptPOS Setup"
  !define MUI_WELCOMEPAGE_TEXT "Install aptPOS ${VERSION}, your point-of-sale and inventory workspace.$\r$\n$\r$\nClose any running copy of aptPOS before continuing. The next steps let you review the license and choose where aptPOS is installed."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  CreateShortCut "$INSTDIR\aptPOS.lnk" "$INSTDIR\aptPOS.exe" "--screen=pos" "$INSTDIR\resources\aptpos.ico" 0 SW_SHOWNORMAL "" "aptPOS" "$INSTDIR"
  CreateShortCut "$INSTDIR\aptRPOS.lnk" "$INSTDIR\aptPOS.exe" "--screen=rpos" "$INSTDIR\resources\aptrpos.ico" 0 SW_SHOWNORMAL "" "aptRPOS" "$INSTDIR"
  CreateShortCut "$INSTDIR\aptERP.lnk" "$INSTDIR\aptPOS.exe" "--screen=erp" "$INSTDIR\resources\apterp.ico" 0 SW_SHOWNORMAL "" "aptERP" "$INSTDIR"
!macroend
