# Installs (or with -Uninstall removes) the scheduled task that gives Drives Meter Modern the SSD
# wear and temperature. Run as administrator. The script goes to Program Files so that only
# administrators can change what runs as SYSTEM; its output goes to ProgramData.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$task = 'ModernMeters Disk Health'
$bin = Join-Path $env:ProgramFiles 'ModernMeters'
$data = Join-Path $env:ProgramData 'ModernMeters'
$out = Join-Path $data 'disk_health.txt'

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item $bin -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $out, (Join-Path $data 'diskhealth_state.txt') -Force -ErrorAction SilentlyContinue
    "Removed"
    return
}

New-Item -ItemType Directory -Force $bin, $data | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'diskhealth.js') $bin -Force

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$bin\diskhealth.js`" `"$out`""
$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $task -Action $action -Trigger $triggers -Principal $principal `
    -Settings $settings -Description 'SSD wear and temperature for the Drives Meter Modern gadget' -Force | Out-Null

# The first run only records disk activity; hard drives that were busy in between show up on the second
Start-ScheduledTask -TaskName $task
Start-Sleep 10
Start-ScheduledTask -TaskName $task
Start-Sleep 4
if (Test-Path $out) { Get-Content $out } else { "No output yet" }
