Option Explicit

Dim shell, files, packageRoot, launcherPath, desktopPath, shortcutPath, shortcut
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
packageRoot = files.GetParentFolderName(WScript.ScriptFullName)
launcherPath = files.BuildPath(packageRoot, "Open FetanAgent.cmd")

If Not files.FileExists(launcherPath) Or _
   Not files.FileExists(files.BuildPath(packageRoot, "RELEASE_SHA")) Or _
   Not files.FileExists(files.BuildPath(packageRoot, "INSTALLATION_TREE_SHA256")) Or _
   Not files.FileExists(files.BuildPath(packageRoot, "runtime\node.exe")) Then
  MsgBox "The FetanAgent package is incomplete. Extract the full ZIP first.", 16, "FetanAgent"
  WScript.Quit 1
End If

desktopPath = shell.SpecialFolders("Desktop")
shortcutPath = files.BuildPath(desktopPath, "FetanAgent - Deposits and Player ID.lnk")
If files.FileExists(shortcutPath) Then
  If MsgBox("Replace the existing FetanAgent desktop shortcut with this package?", _
            36, "FetanAgent") <> 6 Then
    WScript.Quit 0
  End If
End If

Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = launcherPath
shortcut.WorkingDirectory = packageRoot
shortcut.Description = "Open one guarded FetanAgent Chrome session for deposits and Player ID checks"
shortcut.Save
MsgBox "FetanAgent is ready on your desktop. Double-click the new shortcut to open it. Keep the extracted package in this folder.", _
       64, "FetanAgent"
