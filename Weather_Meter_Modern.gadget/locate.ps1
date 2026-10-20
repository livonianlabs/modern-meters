# Asks the Windows location service (Wi-Fi positioning, GPS where present) where this PC is
# and writes "lat;lon;accuracyMeters" to $Out, or "none" when the service is off, denied or
# has no fix. Run hidden by Weather Meter Modern every 30 minutes in Auto mode.
param([string]$Out)
$text = 'none'
try {
    Add-Type -AssemblyName System.Device
    $w = New-Object System.Device.Location.GeoCoordinateWatcher
    if ($w.TryStart($false, [TimeSpan]::FromSeconds(15))) {
        for ($i = 0; $i -lt 60; $i++) {
            if ($w.Status -eq 'Disabled' -or ($w.Status -eq 'Ready' -and -not $w.Position.Location.IsUnknown)) { break }
            Start-Sleep -Milliseconds 250
        }
        $c = $w.Position.Location
        if (-not $c.IsUnknown) {
            $inv = [Globalization.CultureInfo]::InvariantCulture
            $text = $c.Latitude.ToString($inv) + ';' + $c.Longitude.ToString($inv) + ';' + [Math]::Round($c.HorizontalAccuracy)
        }
        $w.Stop()
    }
} catch { }
[IO.File]::WriteAllText($Out, $text)
