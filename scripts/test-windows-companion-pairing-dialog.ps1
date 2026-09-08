param(
  [string] $DialogPath = (Join-Path $PSScriptRoot '..\apps\windows-companion\release\Enter FetanAgent Pairing Package.ps1')
)

$ErrorActionPreference = 'Stop'
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  throw 'Run the pairing dialog regression check with Windows PowerShell -STA.'
}

# Construct the actual shipped controls and event handlers without opening a
# window, reading the clipboard, starting Chrome, or sending a pairing request.
$dialogSource = Get-Content -LiteralPath $DialogPath -Raw
$dialogTokens = $null
$dialogParseErrors = $null
$dialogAst = [Management.Automation.Language.Parser]::ParseInput(
  $dialogSource, [ref] $dialogTokens, [ref] $dialogParseErrors
)
if ($dialogParseErrors.Count -ne 0) { throw 'The shipped pairing dialog does not parse.' }
$showStatements = @($dialogAst.EndBlock.Statements | Where-Object {
  $_.Extent.Text -eq '$result = $form.ShowDialog()'
})
if ($showStatements.Count -ne 1) { throw 'Expected one dialog display boundary.' }
$dialogSetup = [ScriptBlock]::Create($dialogSource.Substring(0, $showStatements[0].Extent.StartOffset))
$testPrefix = 'fetanagent-companion-pairing-v1.'
$testPackage = $testPrefix + ('x' * 100)
$testCases = @(
  @{ Name = 'valid'; Value = $testPackage; Accept = $true },
  @{ Name = 'surrounding-spaces'; Value = "  $testPackage  "; Accept = $true },
  @{ Name = 'minimum-length'; Value = $testPrefix + ('x' * (64 - $testPrefix.Length)); Accept = $true },
  @{ Name = 'maximum-length'; Value = $testPrefix + ('x' * (8192 - $testPrefix.Length)); Accept = $true },
  @{ Name = 'empty'; Value = ''; Accept = $false },
  @{ Name = 'whitespace'; Value = '   '; Accept = $false },
  @{ Name = 'incomplete'; Value = $testPrefix; Accept = $false },
  @{ Name = 'wrong-prefix'; Value = 'another-package.' + ('x' * 100); Accept = $false },
  @{ Name = 'too-long'; Value = $testPrefix + ('x' * 8192); Accept = $false },
  @{ Name = 'embedded-lf'; Value = $testPackage + "`n" + 'x'; Accept = $false },
  @{ Name = 'embedded-cr'; Value = $testPackage + "`r" + 'x'; Accept = $false }
)

foreach ($testCase in $testCases) {
  . $dialogSetup
  try {
    $testTextBox = @($form.Controls | Where-Object { $_ -is [Windows.Forms.TextBox] })[0]
    $testTextBox.Text = $testCase.Value
    $clickMethod = [Windows.Forms.Button].GetMethod('OnClick', [Reflection.BindingFlags]'Instance,NonPublic')
    if ($form.AcceptButton -ne $pair -or $form.CancelButton -ne $skip -or
        $skip.DialogResult -ne [Windows.Forms.DialogResult]::Cancel) {
      throw 'The pairing dialog keyboard actions are not wired to its buttons.'
    }
    # Calling the real .NET event invokes PowerShell's callback scope. Merely
    # evaluating its text would miss the automatic $input variable collision.
    $clickMethod.Invoke($pair, @([EventArgs]::Empty)) | Out-Null
    if ($testCase.Accept) {
      if ($form.Tag -cne $testCase.Value.Trim() -or $form.DialogResult -ne [Windows.Forms.DialogResult]::OK -or $pair.Enabled) {
        throw "Pair device failed the $($testCase.Name) acceptance check."
      }
    } else {
      if ($null -ne $form.Tag -or $form.DialogResult -ne [Windows.Forms.DialogResult]::None -or
          [string]::IsNullOrWhiteSpace($pairingValidation.Text) -or -not $pair.Enabled) {
        throw "Pair device failed the $($testCase.Name) rejection check."
      }
      $testTextBox.Text = $testPackage
      if ($pairingValidation.Text -ne '') { throw 'Editing did not clear the inline validation error.' }
      $clickMethod.Invoke($pair, @([EventArgs]::Empty)) | Out-Null
      if ($form.Tag -cne $testPackage -or $form.DialogResult -ne [Windows.Forms.DialogResult]::OK) {
        throw 'The same window did not recover after correcting invalid input.'
      }
    }
  } finally {
    $form.Dispose()
  }
}

Write-Output "WINDOWS_COMPANION_PAIRING_CALLBACK_OK cases=$($testCases.Count)"
