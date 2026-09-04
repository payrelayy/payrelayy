Option Explicit

Dim shell, fileSystem, packageRoot, nodePath, entryPath, releasePath, pairingDialogPath
Dim dataRoot, releaseSha, identityBindingPath, enrollmentPath, expectedIdentity
Dim pairingPackage, pairingCommand, pairingProcess, command, stream, exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

packageRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
nodePath = fileSystem.BuildPath(packageRoot, "runtime\node.exe")
entryPath = fileSystem.BuildPath(packageRoot, "app\dist\index.js")
releasePath = fileSystem.BuildPath(packageRoot, "RELEASE_SHA")
pairingDialogPath = fileSystem.BuildPath(packageRoot, "Enter FetanAgent Pairing Package.ps1")

If Not fileSystem.FileExists(nodePath) Or Not fileSystem.FileExists(entryPath) Or Not fileSystem.FileExists(releasePath) Or Not fileSystem.FileExists(pairingDialogPath) Then
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

enrollmentPath = fileSystem.BuildPath(fileSystem.BuildPath(dataRoot, "device"), "companion-primary.enrollment.json")
If Not fileSystem.FileExists(enrollmentPath) Then
  If MsgBox( _
    "This Windows companion is not paired with the FetanAgent server yet." & vbCrLf & vbCrLf & _
    "If you already created a ten-minute Windows pairing package on the Owner page, select Yes and paste it now. Select No to open KemerBet without server pairing; no lookup or payment will be enabled.", _
    36, "FetanAgent Companion") = 6 Then
    pairingCommand = Chr(34) & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & Chr(34) & _
      " -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File " & Chr(34) & pairingDialogPath & Chr(34)
    On Error Resume Next
    Set pairingProcess = shell.Exec(pairingCommand)
    If Err.Number = 0 Then
      pairingPackage = Trim(pairingProcess.StdOut.ReadAll)
      If Len(pairingPackage) > 0 Then
        shell.Environment("Process")("FETANAGENT_COMPANION_PAIRING_PACKAGE") = pairingPackage
      End If
    End If
    Err.Clear
    On Error GoTo 0
  End If
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

identityBindingPath = fileSystem.BuildPath(fileSystem.BuildPath(dataRoot, "identity"), "kemerbet-primary.binding.json")
If Not fileSystem.FileExists(identityBindingPath) Then
  expectedIdentity = Trim(InputBox( _
    "First-use local identity binding" & vbCrLf & vbCrLf & _
    "Enter the exact agent identity displayed in the KemerBet account header." & vbCrLf & _
    "This is not your password. It stays on this Windows account and is stored only as a protected fingerprint.", _
    "FetanAgent Companion"))
  If Len(expectedIdentity) = 0 Then
    MsgBox "The companion did not start because first-use identity confirmation was cancelled. No payment was enabled.", 48, "FetanAgent Companion"
    WScript.Quit 1
  End If
  shell.Environment("Process")("FETANAGENT_COMPANION_EXPECTED_AGENT_IDENTITY") = expectedIdentity
End If

MsgBox "FetanAgent Companion is starting a separate protected Chrome window." & vbCrLf & vbCrLf & _
  "Enter your KemerBet username, password, and CAPTCHA only in that Chrome window." & vbCrLf & _
  "The companion will locally verify the exact bound agent header." & vbCrLf & _
  "Any supplied pairing package will be consumed only after that verification." & vbCrLf & _
  "Only a separate expiring server-signed command can run exactly five Find-only Player-ID lookups." & vbCrLf & _
  "Amount, Notes, Transfer, settlement, and money movement remain disabled.", 64, "FetanAgent Companion"

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & entryPath & Chr(34)
On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  MsgBox "FetanAgent Companion could not launch. Confirm the full ZIP is extracted and Google Chrome is installed.", 16, "FetanAgent Companion"
  WScript.Quit 1
End If
On Error GoTo 0

If exitCode <> 0 Then
  MsgBox "The protected KemerBet browser stopped without completing local identity verification." & vbCrLf & vbCrLf & _
    "If another Companion window is already open, use that window. Otherwise confirm Chrome is installed and your internet connection works, then reopen the Companion." & vbCrLf & _
    "Do not enter your password anywhere except the KemerBet Chrome window. No payment was enabled.", 48, "FetanAgent Companion"
End If
