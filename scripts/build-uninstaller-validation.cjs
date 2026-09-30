// Isolated NSIS installation validation, not a release. Uses the production resource filters.
const { build, Platform } = require('electron-builder');
const config = require('../package.json').build;
build({ targets: Platform.WINDOWS.createTarget('nsis'), publish: 'never', prepackaged: process.argv[2], config: {
  publish: null, appId: 'com.ntccorporation.uninstaller.validation', productName: 'NTC Uninstaller Validation', artifactName: 'NTC.Uninstaller.Validation.${ext}',
  directories: { output: 'tmp/uninstaller-installed-validation-build' },
  extraMetadata: { name: 'ntc-uninstaller-validation' },
  nsis: { ...config.nsis, include: 'test/uninstaller-installer.nsh', createStartMenuShortcut: false, createDesktopShortcut: false, runAfterFinish: false, shortcutName: 'NTC Uninstaller Validation', deleteAppDataOnUninstall: false },
} }).catch(error => { console.error(error); process.exitCode = 1; });
