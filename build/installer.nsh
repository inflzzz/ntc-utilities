; NTC Utilities — identidade visual do instalador NSIS.
; O template do electron-builder continua responsável pela lógica de instalação,
; atalhos, desinstalação e instalação silenciosa.
!define MUI_WELCOMEPAGE_TITLE "Instalar NTC Utilities"
!define MUI_WELCOMEPAGE_TEXT "Utilitários locais para baixar, editar e organizar seus arquivos."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Escolha a pasta onde o NTC Utilities será instalado."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Pasta de instalação:"
!define MUI_FINISHPAGE_TITLE "NTC Utilities instalado"
!define MUI_FINISHPAGE_TEXT "A instalação foi concluída. Você pode abrir o NTC Utilities agora ou pelo atalho criado."

!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var NTC_RemovePreviousCopies
Var NTC_RemovePreviousCopiesCheckbox
Var NTC_RegistryIndex
Var NTC_RegistryKey
Var NTC_RegistryDisplayName
Var NTC_RegistryProductPrefix
Var NTC_RegistryInstallLocation
Var NTC_RegistryUninstaller

!macro customInit
  StrCpy $NTC_RemovePreviousCopies "1"
!macroend

!ifndef BUILD_UNINSTALLER
Function NTC_PreviousCopiesPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 34u "A instalação atual será atualizada. Você também pode remover outras instalações registradas do NTC Utilities."
  Pop $1
  ${NSD_CreateCheckbox} 0 45u 100% 14u "Remover arquivos de outras instalações do NTC Utilities"
  Pop $NTC_RemovePreviousCopiesCheckbox
  ${NSD_Check} $NTC_RemovePreviousCopiesCheckbox
  ${NSD_CreateLabel} 12u 64u 100% 34u "Downloads, histórico e configurações pessoais serão mantidos."
  Pop $1
  nsDialogs::Show
FunctionEnd

Function NTC_PreviousCopiesPageLeave
  ${NSD_GetState} $NTC_RemovePreviousCopiesCheckbox $NTC_RemovePreviousCopies
FunctionEnd
!endif

!macro NTC_DefineRemoveRegisteredCopies ROOT_KEY SUFFIX UNINSTALL_MODE
Function NTC_RemoveRegisteredCopies_${SUFFIX}
  StrCpy $NTC_RegistryIndex 0

NTC_RemoveRegisteredCopiesLoop_${SUFFIX}:
  ClearErrors
  EnumRegKey $NTC_RegistryKey ${ROOT_KEY} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $NTC_RegistryIndex
  IfErrors NTC_RemoveRegisteredCopiesDone_${SUFFIX}
  StrCmp $NTC_RegistryKey "" NTC_RemoveRegisteredCopiesDone_${SUFFIX}
  IntOp $NTC_RegistryIndex $NTC_RegistryIndex + 1
  ReadRegStr $NTC_RegistryDisplayName ${ROOT_KEY} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$NTC_RegistryKey" DisplayName
  StrCpy $NTC_RegistryProductPrefix $NTC_RegistryDisplayName 13
  StrCmp $NTC_RegistryProductPrefix "NTC Utilities" 0 NTC_RemoveRegisteredCopiesLoop_${SUFFIX}
  ReadRegStr $NTC_RegistryInstallLocation ${ROOT_KEY} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$NTC_RegistryKey" InstallLocation
  StrCmp $NTC_RegistryInstallLocation "" NTC_RemoveRegisteredCopiesLoop_${SUFFIX}
  StrCmp $NTC_RegistryInstallLocation $INSTDIR NTC_RemoveRegisteredCopiesLoop_${SUFFIX}
  StrCpy $NTC_RegistryUninstaller "$NTC_RegistryInstallLocation\Uninstall NTC Utilities.exe"
  IfFileExists "$NTC_RegistryUninstaller" 0 NTC_RemoveRegisteredCopiesLoop_${SUFFIX}
  IfFileExists "$NTC_RegistryInstallLocation\NTC Utilities.exe" 0 NTC_RemoveRegisteredCopiesLoop_${SUFFIX}
  ExecWait '"$NTC_RegistryUninstaller" /S /KEEP_APP_DATA ${UNINSTALL_MODE} _?=$NTC_RegistryInstallLocation' $0
  ${If} $0 == 0
    IntOp $NTC_RegistryIndex $NTC_RegistryIndex - 1
  ${EndIf}
  Goto NTC_RemoveRegisteredCopiesLoop_${SUFFIX}

NTC_RemoveRegisteredCopiesDone_${SUFFIX}:
FunctionEnd
!macroend

!ifndef BUILD_UNINSTALLER
!insertmacro NTC_DefineRemoveRegisteredCopies HKCU CurrentUser /currentuser
!insertmacro NTC_DefineRemoveRegisteredCopies HKLM Machine /allusers
!endif

!macro customPageAfterChangeDir
  !ifndef BUILD_UNINSTALLER
  Page custom NTC_PreviousCopiesPageCreate NTC_PreviousCopiesPageLeave
  !endif
!macroend

!macro customInstall
  ${If} $NTC_RemovePreviousCopies == "1"
    Call NTC_RemoveRegisteredCopies_CurrentUser
    ${If} $installMode == "all"
      Call NTC_RemoveRegisteredCopies_Machine
    ${EndIf}
  ${EndIf}
!macroend
!endif
