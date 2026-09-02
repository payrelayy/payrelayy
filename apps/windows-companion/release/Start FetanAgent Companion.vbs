Option Explicit

Dim shell, fileSystem, packageRoot, nodePath, entryPath, releasePath
Dim dataRoot, releaseSha, command, stream, exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

packageRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
nodePath = fileSystem.BuildPath(packageRoot, "runtime\node.exe")
entryPath = fileSystem.BuildPath(packageRoot, "app\dist\index.js")
releasePath = fileSystem.BuildPath(packageRoot, "RELEASE_SHA")

If Not fileSystem.FileExists(nodePath) Or Not fileSystem.FileExists(entryPath) Or Not fileSystem.FileExists(releasePath) Then
  MsgBox "This FetanAgent Companion package is incomplete. Download and extract it again.", 16, "FetanAgent Companion"
  WScript.Quit 1
End If

If fileSystem.DriveExists("D:") Then
  dataRoot = "D:\FetanAgent Companion"
Else
  dataRoot = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\FetanAgent Companion"
End If

If Not fileSystem.FolderExists(dataRoot) Then
  fileSystem.CreateFolder(dataRoot)
End If

Set stream = fileSystem.OpenTextFile(releasePath, 1, False)
releaseSha = Trim(stream.ReadAll)
stream.Close

If Len(releaseSha) <> 40 Then
  MsgBox "The FetanAgent Companion release identity is invalid. Download the package again.", 16, "FetanAgent Companion"
  WScript.Quit 1
End If

shell.Environment("Process")("FETANAGENT_COMPANION_DATA_ROOT") = dataRoot
shell.Environment("Process")("FETANAGENT_COMPANION_RELEASE_SHA") = releaseSha

MsgBox "FetanAgent Companion is starting a separate protected Chrome window." & vbCrLf & vbCrLf & _
  "Enter your KemerBet username, password, and CAPTCHA only in that Chrome window." & vbCrLf & _
  "The KemerBet transfer mutation is disabled in this release.", 64, "FetanAgent Companion"

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & entryPath & Chr(34)
On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  MsgBox "FetanAgent Companion could not launch. Confirm the full ZIP is extracted and Google Chrome is installed.", 16, "FetanAgent Companion"
  WScript.Quit 1
End If
On Error GoTo 0

If exitCode <> 0 Then
  MsgBox "The protected KemerBet browser stopped without completing this sign-in check." & vbCrLf & vbCrLf & _
    "If another Companion window is already open, use that window. Otherwise confirm Chrome is installed and your internet connection works, then reopen the Companion." & vbCrLf & _
    "Do not enter your password anywhere except the KemerBet Chrome window. No payment was enabled.", 48, "FetanAgent Companion"
End If
