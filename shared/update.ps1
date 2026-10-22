# Installs release $Tag over every Modern Meters gadget in $Folder (the folder that holds the
# installed .gadget folders). Run hidden by a gadget when its new-version badge is clicked.
# Writes state=running|done|failed (and error=...) to %APPDATA%\ModernMeters\updating.txt.
# common.js goes in last: its new date is what tells the running gadgets to reload.
param([string]$Tag, [string]$Folder)
$ErrorActionPreference = 'Stop'
# Windows PowerShell's progress bar slows downloads down many times over
$ProgressPreference = 'SilentlyContinue'
$names = 'CPU_Meter_Modern.gadget', 'GPU_Meter_Modern.gadget', 'Network_Meter_Modern.gadget', 'Drives_Meter_Modern.gadget', 'Weather_Meter_Modern.gadget'
$statusFile = Join-Path $env:APPDATA 'ModernMeters\updating.txt'

function Set-State($state, $err) {
    New-Item -ItemType Directory -Force (Split-Path $statusFile) | Out-Null
    $text = "state=$state`r`ntag=$Tag`r`nat=" + [DateTimeOffset]::Now.ToUnixTimeMilliseconds() + "`r`n"
    if ($err) { $text += 'error=' + ($err -replace '[\r\n]+', ' ') + "`r`n" }
    [IO.File]::WriteAllText($statusFile, $text)
}

$work = Join-Path $env:TEMP ('ModernMetersUpdate-' + [Guid]::NewGuid().ToString('N'))
try {
    Set-State 'running'
    if ($Tag -notmatch '^v?\d+\.\d+\.\d+$') { throw "bad version '$Tag'" }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $installed = @($names | Where-Object { Test-Path (Join-Path $Folder "$_\gadget.xml") })
    if (-not $installed) { throw "no gadgets in $Folder" }
    New-Item -ItemType Directory -Force $work | Out-Null
    # .NET directly: cmdlets from modules (Get-FileHash, Expand-Archive) don't always load when
    # the Sidebar starts this
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    # Everything is downloaded and checked before anything is replaced
    foreach ($n in $installed) {
        $zip = Join-Path $work ($n -replace '\.gadget$', '.zip')
        Invoke-WebRequest -UseBasicParsing "https://github.com/Silverenio/modern-meters/releases/download/$Tag/$n" -OutFile $zip
        $dir = Join-Path $work $n
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $dir)
        if (-not (Test-Path (Join-Path $dir 'gadget.xml')) -or -not (Test-Path (Join-Path $dir 'common.js'))) { throw "$n is incomplete" }
    }

    # What to copy, decided before anything is replaced. A DLL the Sidebar has loaded can't be
    # replaced, so one that is unchanged is skipped.
    $md5 = [Security.Cryptography.MD5]::Create()
    $hash = { param($f) [BitConverter]::ToString($md5.ComputeHash([IO.File]::ReadAllBytes($f))) }
    $copies = @()
    foreach ($n in $installed) {
        $src = Join-Path $work $n
        $dst = Join-Path $Folder $n
        foreach ($f in Get-ChildItem $src -Recurse | Where-Object { -not $_.PSIsContainer -and $_.Name -ne 'common.js' }) {
            $to = Join-Path $dst $f.FullName.Substring($src.Length + 1)
            if ($f.Extension -eq '.dll' -and (Test-Path $to) -and (& $hash $f.FullName) -eq (& $hash $to)) { continue }
            $copies += , @($f.FullName, $to)
        }
    }
    $locked = @()
    foreach ($c in $copies) {
        New-Item -ItemType Directory -Force (Split-Path $c[1]) | Out-Null
        try { Copy-Item $c[0] $c[1] -Force } catch { if ($c[1] -like '*.dll') { $locked += $c[1] } else { throw } }
    }
    # Dated now, not as in the package: the gadgets compare it with when they loaded
    foreach ($n in $installed) {
        $to = Join-Path $Folder "$n\common.js"
        Copy-Item (Join-Path $work "$n\common.js") $to -Force
        (Get-Item $to).LastWriteTime = Get-Date
    }
    if ($locked) { Set-State 'done' ('restart the Sidebar to finish: ' + (($locked | Split-Path -Leaf) -join ', ')) }
    else { Set-State 'done' }
} catch {
    Set-State 'failed' $_.Exception.Message
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
