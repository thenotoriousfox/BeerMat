; Windows installer for the native BeerMat Desk (Inno Setup 6): per-user install (no admin), Start menu and optional
; desktop shortcuts, clean uninstall. Quizzes and settings live in %APPDATA%\BeerMat\BeerMat Desk and are kept on
; uninstall. Built by build.py with /DAppVersion and /DSource.
[Setup]
AppId={{6F1C9F0E-7A0B-4C1E-9D7B-BEE12A7DE5C0}
AppName=BeerMat Desk
AppVersion={#AppVersion}
AppPublisher=Daniel Weatherall
DefaultDirName={localappdata}\Programs\BeerMat Desk
DefaultGroupName=BeerMat
PrivilegesRequired=lowest
OutputBaseFilename=BeerMat-Desk-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\BeerMat-Desk.exe
MinVersion=10.0
; An update from the desk (updates.py) runs this silently with /UPDATE=1: the desk closes itself, and the new one starts.
CloseApplications=force

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\BeerMat Desk"; Filename: "{app}\BeerMat-Desk.exe"
Name: "{autodesktop}\BeerMat Desk"; Filename: "{app}\BeerMat-Desk.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\BeerMat-Desk.exe"; Description: "Start BeerMat Desk"; Flags: nowait postinstall skipifsilent
Filename: "{app}\BeerMat-Desk.exe"; Flags: nowait; Check: IsUpdate

[Code]
// Run by the desk's updater (/UPDATE=1): start the new desk once it's installed.
function IsUpdate: Boolean;
begin
  Result := ExpandConstant('{param:UPDATE|0}') = '1';
end;
