!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to aptPOS Setup"
  !define MUI_WELCOMEPAGE_TEXT "Install aptPOS ${VERSION}, your point-of-sale and inventory workspace.$\r$\n$\r$\nClose any running copy of aptPOS before continuing. The next steps let you review the license and choose where aptPOS is installed."
  !insertmacro MUI_PAGE_WELCOME
!macroend
