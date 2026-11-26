!macro customHeader
  !ifndef MUI_HEADERIMAGE_RIGHT
    !define MUI_HEADERIMAGE_RIGHT
  !endif
  !ifndef MUI_LICENSEPAGE_CHECKBOX
    !define MUI_LICENSEPAGE_CHECKBOX
  !endif
  !ifdef MUI_FINISHPAGE_RUN_TEXT
    !undef MUI_FINISHPAGE_RUN_TEXT
  !endif
  !define MUI_FINISHPAGE_RUN_TEXT "Launch aptPOS now"
  !ifdef MUI_FINISHPAGE_TITLE
    !undef MUI_FINISHPAGE_TITLE
  !endif
  !define MUI_FINISHPAGE_TITLE "aptPOS ${VERSION} is ready"
  !ifdef MUI_FINISHPAGE_TEXT
    !undef MUI_FINISHPAGE_TEXT
  !endif
  !define MUI_FINISHPAGE_TEXT "aptPOS has been installed on your computer.$\r$\n$\r$\nYour business data and backups remain safely stored in your Windows application data folder.$\r$\n$\r$\nClick Finish to complete setup."
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to aptPOS ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "aptPOS is your all-in-one retail billing, inventory, and VAT-ready point-of-sale workspace.$\r$\n$\r$\nSetup will guide you through a quick installation. Please close any running copy of aptPOS before continuing."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  Delete "$INSTDIR\aptPOS.lnk"
  Delete "$INSTDIR\aptRPOS.lnk"
  Delete "$INSTDIR\aptERP.lnk"
!macroend
