$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Pair FetanAgent Companion'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(760, 430)
$form.MinimumSize = New-Object System.Drawing.Size(640, 360)
$form.MaximizeBox = $false
$form.TopMost = $true

$message = New-Object System.Windows.Forms.Label
$message.AutoSize = $false
$message.Location = New-Object System.Drawing.Point(18, 16)
$message.Size = New-Object System.Drawing.Size(708, 66)
$message.Text = "Paste the one-use Windows pairing package created on the FetanAgent Owner page. It expires after ten minutes. It grants public-key enrollment only; Player lookup, Amount, Notes, Transfer, settlement, and money movement remain disabled."
$form.Controls.Add($message)

$input = New-Object System.Windows.Forms.TextBox
$input.AcceptsReturn = $true
$input.AcceptsTab = $false
$input.Anchor = 'Top,Bottom,Left,Right'
$input.Font = New-Object System.Drawing.Font('Consolas', 9)
$input.Location = New-Object System.Drawing.Point(18, 88)
$input.MaxLength = 8192
$input.Multiline = $true
$input.ScrollBars = 'Vertical'
$input.Size = New-Object System.Drawing.Size(708, 236)
$input.WordWrap = $true
$form.Controls.Add($input)

$pair = New-Object System.Windows.Forms.Button
$pair.Anchor = 'Bottom,Right'
$pair.Location = New-Object System.Drawing.Point(526, 340)
$pair.Size = New-Object System.Drawing.Size(96, 32)
$pair.Text = 'Pair device'
$form.Controls.Add($pair)

$skip = New-Object System.Windows.Forms.Button
$skip.Anchor = 'Bottom,Right'
$skip.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$skip.Location = New-Object System.Drawing.Point(630, 340)
$skip.Size = New-Object System.Drawing.Size(96, 32)
$skip.Text = 'Not now'
$form.Controls.Add($skip)

$form.CancelButton = $skip
$form.AcceptButton = $pair

$pair.Add_Click({
  $candidate = $input.Text.Trim()
  if (
    $candidate.Length -lt 64 -or
    $candidate.Length -gt 8192 -or
    -not $candidate.StartsWith('fetanagent-companion-pairing-v1.') -or
    $candidate.IndexOf([char] 0) -ge 0 -or
    $candidate.Contains("`r") -or
    $candidate.Contains("`n")
  ) {
    [System.Windows.Forms.MessageBox]::Show(
      'This is not a valid single-line FetanAgent Windows pairing package. Copy a new package from the Owner page and paste it without changing it.',
      'FetanAgent Companion',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return
  }
  $form.Tag = $candidate
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

$result = $form.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $form.Tag -is [string]) {
  [Console]::Out.Write([string] $form.Tag)
  exit 0
}
exit 2
