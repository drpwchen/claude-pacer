# schedule-resume.ps1 — register a ONE-SHOT Windows scheduled task that resumes
# Claude work after the 5h rate-limit reset, even if the interactive session is closed.
# Default time = 5h resets_at from limits.json + 3 min. Requires handoff.md to exist.
param(
  [string]$At,   # optional: "23:20" or "2026-07-15 03:05"; default from limits.json
  [string]$Dir = $(if ($env:CLAUDE_PACER_DIR) { $env:CLAUDE_PACER_DIR } else { "$env:USERPROFILE\.claude\claude-pacer" }),
  [string]$Handoff
)

if (-not $Handoff) { $Handoff = "$Dir\handoff.md" }

if (-not (Test-Path $Handoff)) {
  Write-Error "Handoff file not found: $Handoff — write the resume instructions first."
  exit 1
}

if (-not $At) {
  $limits = Get-Content "$Dir\limits.json" -Raw | ConvertFrom-Json
  if (-not $limits.five_hour.resets_at) { Write-Error "No resets_at in limits.json; pass -At explicitly."; exit 1 }
  $when = ([DateTimeOffset]::FromUnixTimeSeconds($limits.five_hour.resets_at)).LocalDateTime.AddMinutes(3)
} else {
  $when = [datetime]::Parse($At)
  if ($when -lt (Get-Date)) { $when = $when.AddDays(1) }  # time-only string already past today
}

$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\resume-runner.ps1`""
$trigger  = New-ScheduledTaskTrigger -Once -At $when
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3)

Register-ScheduledTask -TaskName "Claude-Auto-Resume" -Action $action -Trigger $trigger `
  -Settings $settings -Force | Out-Null

Write-Host "OK: Claude-Auto-Resume scheduled at $when"
Write-Host "Handoff: $Handoff"
Write-Host "Log:     $Dir\resume-log.txt"
