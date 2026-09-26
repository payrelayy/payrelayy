param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $CompanionProcessId,
  [Parameter(Mandatory = $true)][string] $NodeExecutable,
  [Parameter(Mandatory = $true)][string] $EntryPoint
)

$ErrorActionPreference = 'Stop'

try {
  if (-not [IO.Path]::IsPathFullyQualified($NodeExecutable) -or
      -not [IO.Path]::IsPathFullyQualified($EntryPoint)) {
    throw 'Invalid expected paths.'
  }

  # This script observes an already-running process. It never starts, stops, or
  # changes the companion or its environment. Do not emit its command line.
  $matches = @(Get-CimInstance Win32_Process -Filter "ProcessId = $CompanionProcessId")
  if ($matches.Count -ne 1) { throw 'Process unavailable.' }
  $observed = $matches[0]
  $expectedCommand = '"' + $NodeExecutable + '" "' + $EntryPoint + '"'
  if ($observed.ProcessId -ne $CompanionProcessId -or
      -not [string]::Equals($observed.ExecutablePath, $NodeExecutable, [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals($observed.CommandLine, $expectedCommand, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Process identity mismatch.'
  }

  $started = $observed.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  "COMPANION_GUARDED_OS_PROCESS_OBSERVED|$CompanionProcessId|$started"
} catch {
  throw 'The guarded companion OS process is unavailable.'
}
