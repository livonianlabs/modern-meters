# Assembles the gadgets, packs them into dist\*.gadget and (with -Install) copies them into the
# per-user Sidebar gadgets folder so they appear in the gadget gallery.
# $Version is the single version number: it goes into every gadget.xml and into common.js, which
# compares it with the latest GitHub release.
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$Version = '1.8.0'
$root = $PSScriptRoot
$names = 'CPU_Meter_Modern.gadget', 'GPU_Meter_Modern.gadget', 'Network_Meter_Modern.gadget', 'Drives_Meter_Modern.gadget', 'Weather_Meter_Modern.gadget'
$utf8 = New-Object System.Text.UTF8Encoding $false
$utf8Bom = New-Object System.Text.UTF8Encoding $true

function Set-Text($path, $pattern, $replacement) {
    $text = [IO.File]::ReadAllText($path)
    [IO.File]::WriteAllText($path, ($text -replace $pattern, $replacement), $utf8)
}

& (Join-Path $root 'tools\make-images.ps1') -Root $root | Out-Null

# .NET helpers: Core Temp reader for CPU Meter, D3DKMT sensor reader for GPU Meter, and the panel
# painter for the colored themes, which every gadget gets through shared\ (csc.exe of
# .NET Framework 4 ships with Windows). Rebuilt only when the source changes: every build gets a
# new timestamp, and the Sidebar keeps the installed copy locked while the gadget runs.
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$libs = @(
    @{ Source = 'tools\coretemp\CoreTempReader.cs'; Out = 'CPU_Meter_Modern.gadget\ModernMetersCoreTemp.dll' },
    @{ Source = 'tools\gpu\GpuReader.cs'; Out = 'GPU_Meter_Modern.gadget\ModernMetersGpu.dll' },
    @{ Source = 'tools\panel\PanelPainter.cs'; Out = 'shared\ModernMetersPanel.dll' }
)
foreach ($lib in $libs) {
    $dll = Join-Path $root $lib.Out
    $cs = Join-Path $root $lib.Source
    if (-not (Test-Path $dll) -or (Get-Item $cs).LastWriteTime -gt (Get-Item $dll).LastWriteTime) {
        & $csc /nologo /target:library /optimize "/out:$dll" $cs
        if ($LASTEXITCODE) { throw "csc failed on $($lib.Source)" }
    }
}

Set-Text (Join-Path $root 'shared\common.js') 'var VERSION = "[^"]*";' "var VERSION = `"$Version`";"
foreach ($n in $names) {
    $dir = Join-Path $root $n
    Set-Text (Join-Path $dir 'gadget.xml') '<version>[^<]*</version>' "<version>$Version</version>"
    Copy-Item (Join-Path $root 'shared\*') $dir -Recurse -Force
    # The Sidebar reads HTML without a BOM as ANSI, which garbles Cyrillic
    Get-ChildItem $dir -Filter *.html | ForEach-Object {
        $text = [IO.File]::ReadAllText($_.FullName)
        [IO.File]::WriteAllText($_.FullName, $text, $utf8Bom)
    }
}

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item (Join-Path $root 'README.md') $dist -Force
foreach ($n in $names) {
    $zip = Join-Path $dist ($n -replace '\.gadget$', '.zip')
    Compress-Archive -Path (Join-Path $root "$n\*") -DestinationPath $zip -Force
    Move-Item $zip (Join-Path $dist $n) -Force
}

if ($Install) {
    $target = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Sidebar\Gadgets'
    foreach ($n in $names) {
        $dst = Join-Path $target $n
        New-Item -ItemType Directory -Force $dst | Out-Null
        Copy-Item (Join-Path $root "$n\*") $dst -Recurse -Force -Exclude '*.dll'
        # A DLL in use can't be replaced, so only copy it when it differs
        Get-ChildItem (Join-Path $root $n) -Filter *.dll | ForEach-Object {
            $to = Join-Path $dst $_.Name
            if (-not (Test-Path $to) -or (Get-FileHash $_.FullName).Hash -ne (Get-FileHash $to).Hash) {
                try { Copy-Item $_.FullName $to -Force } catch { Write-Warning "$($_.Exception.Message) Close the Sidebar and run again." }
            }
        }
    }
    "Installed to $target"
}
"Version $Version, packages: $dist"
