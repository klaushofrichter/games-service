; Game Table's Windows installer (D-256), built by .github/workflows/local-table-packages.yml:
;   iscc /DSource=dist\windows /DVersion=2026.11.01 /DOutputDir=dist scripts\package\windows.iss
; Per user, without administrator rights: the program goes to %LOCALAPPDATA%\Programs\Game Table; downloads and the
; table's data go to %LOCALAPPDATA%\GameTable (the launcher's), which uninstalling leaves alone.
#ifndef Source
  #define Source "..\..\dist\windows"
#endif
#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{8C3E4D6B-2F7A-4B1E-9C55-6A1D0E3F7B21}
AppName=Game Table
AppVersion={#Version}
AppPublisher=skylar.technology
AppPublisherURL=https://games.skylar.technology
DefaultDirName={localappdata}\Programs\Game Table
DefaultGroupName=Game Table
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=game-table-windows
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Game Table

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; A new version replaces the old runtime completely.
Type: filesandordirs; Name: "{app}\runtime"

[Icons]
Name: "{autoprograms}\Game Table"; Filename: "{app}\game-table.cmd"; WorkingDir: "{app}"; Comment: "Game Table on this computer"
Name: "{autodesktop}\Game Table"; Filename: "{app}\game-table.cmd"; WorkingDir: "{app}"; Comment: "Game Table on this computer"; Tasks: desktopicon

[Run]
Filename: "{app}\game-table.cmd"; Description: "Start Game Table"; Flags: postinstall nowait skipifsilent shellexec
