!define APPNAME "Counterline POS"
!define COMPANYNAME "aptPOS"
!define DESCRIPTION "Retail Billing & Inventory Management"
!define VERSIONMAJOR 1
!define VERSIONMINOR 0
!define VERSIONBUILD 0
!define INSTALLDIR "C:\\Program Files\\Counterline POS"

RequestExecutionLevel admin
SetCompress auto
SetCompressor lzma

Name "${APPNAME}"
OutFile "release\installer.exe"
InstallDir "${INSTALLDIR}"

Page directory
Page instfiles

Section "MainSection" SEC01
    SetOutPath "$INSTDIR"
    File /r "release\win-unpacked\*.*"

    CreateDirectory "$SMPROGRAMS\${APPNAME}"
    CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\electron.exe"
    CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\electron.exe"

    WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
    Delete "$DESKTOP\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
    RMDir "$SMPROGRAMS\${APPNAME}"
    RMDir /r "$INSTDIR"
SectionEnd

Function .onInit
    SetSilent silent
FunctionEnd
