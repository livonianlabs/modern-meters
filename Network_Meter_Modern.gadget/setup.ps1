# Fixes for the system the gadgets depend on, run elevated (Windows asks for administrator
# approval) by a gadget or by Install-ModernMeters.cmd:
#   -Action CoreTemp  downloads the standalone Core Temp from its author's site into -Dir,
#                     starting minimized, and starts it now and at every sign-in of -User through
#                     a scheduled task (elevated, so no prompt each time)
#   -Action Counters  rebuilds the Windows performance counters (lodctr /R, winmgmt /resyncperf)
# Core Temp may not be redistributed, so it is always fetched from alcpu.com, never shipped.
# Writes state=running|done|failed, action and error=... to -Status (the gadgets' setup.txt).
param([string]$Action, [string]$Dir, [string]$User, [string]$Status)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Set-State($state, $err) {
    if (-not $Status) { return }
    New-Item -ItemType Directory -Force (Split-Path $Status) | Out-Null
    $text = "state=$state`r`naction=$Action`r`nat=" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds() + "`r`n"
    if ($err) { $text += 'error=' + ($err -replace '[\r\n]+', ' ') + "`r`n" }
    [IO.File]::WriteAllText($Status, $text)
}

$CoreTempTask = 'Modern Meters - Core Temp'

function Install-CoreTemp {
    if (-not $Dir) { throw 'no folder' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $zipName = if ([Environment]::Is64BitOperatingSystem) { 'CoreTemp64.zip' } else { 'CoreTemp32.zip' }
    $work = Join-Path $env:TEMP ('ModernMetersCoreTemp-' + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Force $work | Out-Null
        $zip = Join-Path $work $zipName
        Invoke-WebRequest -UseBasicParsing "https://www.alcpu.com/CoreTemp/$zipName" -OutFile $zip
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $unpacked = Join-Path $work 'x'
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpacked)
        if (-not (Test-Path (Join-Path $unpacked 'Core Temp.exe'))) { throw 'Core Temp.exe is not in the download' }
        # A running copy keeps its exe locked
        Get-Process 'Core Temp' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Dir\*" } | Stop-Process -Force
        New-Item -ItemType Directory -Force $Dir | Out-Null
        Copy-Item (Join-Path $unpacked '*') $Dir -Recurse -Force
    } finally {
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }
    # To the notification area instead of a window, unless set up before
    $ini = Join-Path $Dir 'CoreTemp.ini'
    if (-not (Test-Path $ini)) { [IO.File]::WriteAllText($ini, "[Display]`r`nMinimized=1;`r`n") }

    # What Core Temp's own "Start with Windows" does: a task at sign-in with the highest privileges
    $exe = Join-Path $Dir 'Core Temp.exe'
    $act = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $Dir
    $trig = New-ScheduledTaskTrigger -AtLogOn -User $User
    $prin = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $CoreTempTask -Action $act -Trigger $trig -Principal $prin -Settings $set -Force | Out-Null
    Start-ScheduledTask -TaskName $CoreTempTask
}

function Repair-Counters {
    foreach ($sys in 'System32', 'SysWOW64') {
        $lodctr = Join-Path $env:WINDIR "$sys\lodctr.exe"
        if (-not (Test-Path $lodctr)) { continue }
        Push-Location (Join-Path $env:WINDIR $sys)
        try {
            & $lodctr /R | Out-Null
            if ($LASTEXITCODE) { throw "lodctr /R ($sys) exit code $LASTEXITCODE" }
        } finally { Pop-Location }
    }
    & (Join-Path $env:WINDIR 'System32\wbem\winmgmt.exe') /resyncperf | Out-Null
    # WMI picks the rebuilt counters up on its next start; the gadgets reconnect after this
    Restart-Service winmgmt -Force
}

try {
    Set-State 'running'
    switch ($Action) {
        'CoreTemp' { Install-CoreTemp }
        'Counters' { Repair-Counters }
        default { throw "unknown action '$Action'" }
    }
    Set-State 'done'
} catch {
    Set-State 'failed' $_.Exception.Message
    exit 1
}
