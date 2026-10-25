<# :
@echo off
rem Modern Meters installer. A batch file that runs the PowerShell below it, so a double-click is enough.
set "MM_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Get-Content -LiteralPath $env:MM_SELF -Encoding UTF8 -Raw)"
exit /b
#>
# Installs or updates the Modern Meters gadgets from the latest GitHub release, and checks what
# they depend on first: 8GadgetPack (the Sidebar), the Windows performance counters (repaired
# with setup.ps1 if broken) and, if wanted, Core Temp for CPU temperatures (downloaded from its
# author's site by setup.ps1). Everything that needs administrator rights asks first.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'livonianlabs/modern-meters'
$ru = @('ru', 'be') -contains (Get-UICulture).TwoLetterISOLanguageName

function Say($en, $rus) { Write-Host $(if ($ru) { $rus } else { $en }) }
function Step($en, $rus) { Write-Host ''; Write-Host $(if ($ru) { $rus } else { $en }) -ForegroundColor Cyan }
function Ok($en, $rus) { Write-Host ('  ' + $(if ($ru) { $rus } else { $en })) -ForegroundColor Green }
function Warn($en, $rus) { Write-Host ('  ' + $(if ($ru) { $rus } else { $en })) -ForegroundColor Yellow }
function Ask($en, $rus) {
    $a = Read-Host ('  ' + $(if ($ru) { "$rus [Д/н]" } else { "$en [Y/n]" }))
    return -not ($a -match '^\s*(n|no|н|нет)\s*$')
}
function Finish($code) {
    Write-Host ''
    Read-Host $(if ($ru) { 'Нажмите Enter, чтобы закрыть' } else { 'Press Enter to close' }) | Out-Null
    exit $code
}

# Runs setup.ps1 elevated (Windows asks for administrator approval) and returns its result
function Invoke-Setup($script, $action, $extra) {
    $status = Join-Path $env:TEMP ('ModernMetersSetup-' + [Guid]::NewGuid().ToString('N') + '.txt')
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$script`"",
        '-Action', $action, '-Status', "`"$status`"") + $extra
    try {
        Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList $argList
    } catch {
        return @{ state = 'cancelled' }
    }
    $r = @{ state = 'failed'; error = 'no result' }
    if (Test-Path $status) {
        foreach ($line in Get-Content $status) { if ($line -match '^(\w+)=(.*)$') { $r[$matches[1]] = $matches[2] } }
        Remove-Item $status -Force -ErrorAction SilentlyContinue
    }
    return $r
}

Write-Host 'Modern Meters' -ForegroundColor White
Say 'Desktop gadgets for 8GadgetPack by Livonian Labs - github.com/livonianlabs/modern-meters' `
    'Гаджеты для рабочего стола (8GadgetPack) от Livonian Labs - github.com/livonianlabs/modern-meters'

# ---- 1. The Sidebar ---------------------------------------------------------
Step '1. 8GadgetPack' '1. 8GadgetPack'
$sidebar = Join-Path $env:ProgramFiles 'Windows Sidebar\sidebar.exe'
if (-not (Test-Path $sidebar)) {
    Warn '8GadgetPack is not installed. The gadgets run in its Sidebar: install it first, then run this again.' `
        '8GadgetPack не установлен. Гаджеты работают в его боковой панели: установите его и запустите этот файл снова.'
    if (Ask 'Open 8gadgetpack.net?' 'Открыть 8gadgetpack.net?') { Start-Process 'https://8gadgetpack.net/' }
    Finish 1
}
Ok 'found' 'найден'

# ---- 2. The gadgets ---------------------------------------------------------
Step '2. Gadgets' '2. Гаджеты'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$work = Join-Path $env:TEMP ('ModernMetersInstall-' + [Guid]::NewGuid().ToString('N'))
$gadgets = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Sidebar\Gadgets'
try {
    $rel = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'ModernMeters-Installer' }
    $assets = @($rel.assets | Where-Object { $_.name -like '*.gadget' })
    if (-not $assets) { throw 'the release has no .gadget files' }
    Say "  Modern Meters $($rel.tag_name): downloading $($assets.Count) gadgets..." "  Modern Meters $($rel.tag_name): скачиваю $($assets.Count) гаджетов..."
    New-Item -ItemType Directory -Force $work | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach ($a in $assets) {
        $zip = Join-Path $work ($a.name -replace '\.gadget$', '.zip')
        Invoke-WebRequest -UseBasicParsing $a.browser_download_url -OutFile $zip
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, (Join-Path $work $a.name))
    }
    # The Sidebar keeps the gadgets' DLLs locked while it runs
    $wasRunning = [bool](Get-Process sidebar -ErrorAction SilentlyContinue)
    if ($wasRunning) { Stop-Process -Name sidebar -Force; Start-Sleep -Seconds 2 }
    New-Item -ItemType Directory -Force $gadgets | Out-Null
    foreach ($a in $assets) {
        $to = Join-Path $gadgets $a.name
        New-Item -ItemType Directory -Force $to | Out-Null
        Copy-Item (Join-Path (Join-Path $work $a.name) '*') $to -Recurse -Force
    }
    Ok "installed to $gadgets" "установлены в $gadgets"
} catch {
    Warn "Couldn't install the gadgets: $($_.Exception.Message)" "Не удалось установить гаджеты: $($_.Exception.Message)"
    if ($wasRunning) { Start-Process $sidebar }
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    Finish 1
}
$setup = Join-Path $gadgets 'CPU_Meter_Modern.gadget\setup.ps1'
if (-not (Test-Path $setup)) { $setup = @(Get-ChildItem $gadgets -Filter setup.ps1 -Recurse | Where-Object { $_.FullName -like '*_Modern.gadget*' })[0].FullName }
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue

# ---- 3. Performance counters ------------------------------------------------
Step '3. Windows performance counters' '3. Счётчики производительности Windows'
$broken = $false
try { Get-CimInstance Win32_PerfRawData_PerfOS_Processor -ErrorAction Stop | Out-Null } catch { $broken = $true }
if (-not $broken) {
    Ok 'working' 'работают'
} else {
    Warn 'They are damaged (usually by a failed update or a registry cleaner): CPU, Drives, Network and GPU need them.' `
        'Они повреждены (обычно после неудачного обновления или «чистилки» реестра), а они нужны CPU, Drives, Network и GPU.'
    if (Ask 'Repair them now? Windows asks for administrator approval.' 'Починить сейчас? Windows спросит права администратора.') {
        Say '  Repairing (up to a minute)...' '  Чиню (до минуты)...'
        $r = Invoke-Setup $setup 'Counters' @()
        if ($r.state -eq 'done') { Ok 'repaired' 'починены' }
        elseif ($r.state -eq 'cancelled') { Warn 'skipped: no administrator approval' 'пропущено: права администратора не даны' }
        else { Warn "failed: $($r.error)" "не получилось: $($r.error)" }
    }
}

# ---- 4. Core Temp -------------------------------------------------------------
Step '4. Core Temp (CPU temperatures)' '4. Core Temp (температура процессора)'
$ctTask = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { @($_.Actions | Where-Object { $_.Execute -match 'Core Temp\.exe' }).Count }
$ctExe = @("$env:ProgramFiles\Core Temp\Core Temp.exe", "${env:ProgramFiles(x86)}\Core Temp\Core Temp.exe",
    "$env:LOCALAPPDATA\ModernMeters\CoreTemp\Core Temp.exe") | Where-Object { Test-Path $_ }
if ($ctTask) {
    Ok 'installed and starts with Windows' 'установлен и запускается вместе с Windows'
} else {
    if ($ctExe) {
        Warn "found ($($ctExe[0])), but it doesn't start with Windows." "найден ($($ctExe[0])), но не запускается вместе с Windows."
    } else {
        Say '  CPU Meter shows processor temperatures from Core Temp, a free program by Arthur Liberman.' `
            '  CPU Meter показывает температуру процессора из Core Temp - бесплатной программы Артура Либермана.'
    }
    Say '  It can be downloaded from alcpu.com (the standalone version, without the installer''s offers) and set to start minimized with Windows. By downloading it you accept its license.' `
        '  Можно скачать его с alcpu.com (портативная версия, без рекламы из установщика) и настроить запуск свёрнутым вместе с Windows. Скачивая, вы принимаете его лицензию.'
    if (Ask 'Download and set up Core Temp? Windows asks for administrator approval.' 'Скачать и настроить Core Temp? Windows спросит права администратора.') {
        $dir = Join-Path $env:LOCALAPPDATA 'ModernMeters\CoreTemp'
        $r = Invoke-Setup $setup 'CoreTemp' @('-Dir', "`"$dir`"", '-User', "`"$env:USERDOMAIN\$env:USERNAME`"")
        if ($r.state -eq 'done') { Ok "installed to $dir and started" "установлен в $dir и запущен" }
        elseif ($r.state -eq 'cancelled') { Warn 'skipped: no administrator approval' 'пропущено: права администратора не даны' }
        else { Warn "failed: $($r.error)" "не получилось: $($r.error)" }
    }
}

# ---- 5. Done --------------------------------------------------------------------
Step '5. Done' '5. Готово'
Start-Process $sidebar
Start-Sleep -Seconds 3
Start-Process $sidebar -ArgumentList '/showGadgets'
Say '  Gadgets already on the desktop are updated. New ones: drag them from the gadget gallery that just opened onto the desktop.' `
    '  Гаджеты, которые уже стоят на рабочем столе, обновлены. Новые перетащите на рабочий стол из открывшейся галереи гаджетов.'
Finish 0
