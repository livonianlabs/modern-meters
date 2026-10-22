# Generates the panel backgrounds and gallery icons for both gadgets.
param([string]$Root = (Split-Path $PSScriptRoot -Parent))
Add-Type -AssemblyName System.Drawing

$R = 10          # corner radius

function New-RoundPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    $p
}

function Save-Icon([string]$file, [System.Drawing.Color]$accent, [string]$label) {
    $n = 100
    $bmp = New-Object System.Drawing.Bitmap $n, $n
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 21, 24, 29))), (New-RoundPath 4 4 92 92 16))
    # area chart
    $pts = @(
        (New-Object System.Drawing.PointF 14, 80), (New-Object System.Drawing.PointF 14, 66),
        (New-Object System.Drawing.PointF 28, 58), (New-Object System.Drawing.PointF 40, 64),
        (New-Object System.Drawing.PointF 54, 40), (New-Object System.Drawing.PointF 66, 50),
        (New-Object System.Drawing.PointF 86, 28), (New-Object System.Drawing.PointF 86, 80)
    )
    $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, $accent))), $pts)
    $line = $pts[1..6]
    $g.DrawLines((New-Object System.Drawing.Pen $accent, 3), [System.Drawing.PointF[]]$line)
    $font = New-Object System.Drawing.Font 'Segoe UI Semibold', 15
    $g.DrawString($label, $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 232, 234, 237))), 12, 9)
    $g.Dispose()
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# Rounded panels for every supported width and height (10px steps), drawn at 2x so they stay
# crisp when the Sidebar scales them for high-DPI screens. Only the rim shows: the gadget covers
# the interior with opaque divs of the same colors (see paintFrame in common.js).
#   bg_<w>_<h>.png     classic: flat fill, 1px grey border
#   glass_<w>_<h>.png  glass: navy vertical gradient, top gloss, 4px glowing blue border
function Save-Panels([string]$dir) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    $k = 2
    $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 21, 24, 29))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 58, 63, 70)), $k
    $top = [System.Drawing.Color]::FromArgb(255, 0x14, 0x22, 0x3a)       # THEMES.glass.panelTop
    $bottom = [System.Drawing.Color]::FromArgb(255, 0x0a, 0x11, 0x1e)    # THEMES.glass.panelBottom
    $glow = @(230, 90, 45, 20)                                           # border alpha, outside in
    foreach ($w in 170, 220, 260, 320, 400) {
        for ($h = $MinH; $h -le $MaxH; $h += 10) {
            $W2 = $w * $k; $H2 = $h * $k
            foreach ($style in 'bg', 'glass') {
                $bmp = New-Object System.Drawing.Bitmap $W2, $H2
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.SmoothingMode = 'AntiAlias'
                $g.Clear([System.Drawing.Color]::Transparent)
                if ($style -eq 'bg') {
                    $path = New-RoundPath ($k / 2) ($k / 2) ($W2 - $k) ($H2 - $k) (10 * $k)
                    $g.FillPath($fill, $path)
                    $g.DrawPath($pen, $path)
                } else {
                    $path = New-RoundPath 0 0 $W2 $H2 (12 * $k)
                    # Darkens over the top $GradH px, then stays flat (GLASS_GRADIENT_H in common.js)
                    $g.FillPath((New-Object System.Drawing.SolidBrush $bottom), $path)
                    $g.SetClip($path)
                    $gh = [Math]::Min($GradH, $h) * $k
                    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, $W2, $gh), $top, $bottom, 90
                    $g.FillRectangle($grad, 0, 0, $W2, $gh - 1)
                    # Gloss: white fading out over the top 70px below the rim
                    $gl = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, (4 * $k), $W2, (70 * $k)),
                        ([System.Drawing.Color]::FromArgb(22, 255, 255, 255)), ([System.Drawing.Color]::FromArgb(0, 255, 255, 255)), 90
                    # A little short of the brush, which would otherwise wrap around to its start color
                    $g.FillRectangle($gl, 0, 4 * $k, $W2, 70 * $k - 2)
                    $g.ResetClip()
                    for ($i = 0; $i -lt $glow.Count; $i++) {
                        $o = $i * $k + $k / 2
                        $gp = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($glow[$i], 80, 150, 240)), $k
                        $g.DrawPath($gp, (New-RoundPath $o $o ($W2 - 2 * $o) ($H2 - 2 * $o) ((12 - $i) * $k)))
                    }
                }
                $g.Dispose()
                $bmp.Save((Join-Path $dir "${style}_${w}_${h}.png"), [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()
            }
        }
    }
}

# Glass layout glyphs, drawn at 2x (32px) once per accent color: <prefix>_<kind>_<accent>.png, and with
# -Light in the light theme's accents as <prefix>l_<kind>_<accent>.png (ACCENT_SETS in common.js).
# Only strokes and fills in the accent, so they sit on any panel color.
# Title icons: cpu, gpu, net, disk, sky. Row icons: ram, commit, bus, power, fan, ip, globe, shield, pulse, ping.
function Save-Glyphs([string]$dir, [string]$prefix, [string[]]$kinds, [switch]$Light) {
    $accents = if ($Light) {
        @{ blue = '0a7fd0'; teal = '0b9c86'; green = '3f9a1e'; purple = '7f56e0'; orange = 'e06c00'; pink = 'd63384'; red = 'd63a3a'; yellow = 'b58900' }
    } else {
        @{ blue = '4cc2ff'; teal = '2ee6c5'; green = '76c442'; purple = 'b18cff'; orange = 'ff9f43'; pink = 'ff6fb5'; red = 'ff6b6b'; yellow = 'ffd43b' }
    }
    if ($Light) { $prefix += 'l' }
    foreach ($kind in $kinds) {
        foreach ($name in $accents.Keys) {
            $c = [System.Drawing.ColorTranslator]::FromHtml('#' + $accents[$name])
            $bmp = New-Object System.Drawing.Bitmap 32, 32
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.SmoothingMode = 'AntiAlias'
            $g.Clear([System.Drawing.Color]::Transparent)
            $pen = New-Object System.Drawing.Pen $c, 2.6
            $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
            $brush = New-Object System.Drawing.SolidBrush $c
            $pt = { param($x, $y) New-Object System.Drawing.PointF $x, $y }
            switch ($kind) {
                'cpu' {
                    $g.DrawPath($pen, (New-RoundPath 8 8 16 16 3))
                    $g.FillRectangle($brush, 13, 13, 6, 6)
                    foreach ($q in 11, 16, 21) {
                        $g.DrawLine($pen, $q, 3, $q, 7); $g.DrawLine($pen, $q, 25, $q, 29)
                        $g.DrawLine($pen, 3, $q, 7, $q); $g.DrawLine($pen, 25, $q, 29, $q)
                    }
                }
                'gpu' {
                    $g.DrawPath($pen, (New-RoundPath 3 8 26 15 2))
                    $g.DrawEllipse($pen, 7, 11, 9, 9)
                    $g.FillRectangle($brush, 20, 12, 5, 7)
                    $g.DrawLine($pen, 7, 23, 7, 27); $g.DrawLine($pen, 7, 27, 18, 27)
                }
                'net' {
                    foreach ($r in 6, 12, 18) { $g.DrawArc($pen, 16 - $r, 26 - $r, 2 * $r, 2 * $r, 225, 90) }
                    $g.FillEllipse($brush, 13.5, 23.5, 5, 5)
                }
                'disk' {
                    $g.DrawEllipse($pen, 6, 3, 20, 7)
                    $g.DrawArc($pen, 6, 12, 20, 7, 0, 180)
                    $g.DrawArc($pen, 6, 21, 20, 7, 0, 180)
                    $g.DrawLine($pen, 6, 6.5, 6, 24.5); $g.DrawLine($pen, 26, 6.5, 26, 24.5)
                }
                'ram' {
                    $g.DrawRectangle($pen, 4, 8, 24, 13)
                    foreach ($q in 8, 14, 20) { $g.FillRectangle($brush, $q, 11.5, 4, 6) }
                    foreach ($q in 8, 13, 18, 23) { $g.DrawLine($pen, $q, 22, $q, 26) }
                }
                'commit' {
                    # The back sheet stops where the front one covers it
                    $g.SetClip((New-Object System.Drawing.RectangleF 2.5, 10.5, 21, 16), [System.Drawing.Drawing2D.CombineMode]::Exclude)
                    $g.DrawRectangle($pen, 10, 5, 18, 13)
                    $g.ResetClip()
                    $g.DrawRectangle($pen, 4, 12, 18, 13)
                }
                'bus' {
                    $g.DrawLine($pen, 4, 11, 27, 11); $g.DrawLine($pen, 22, 6, 27, 11); $g.DrawLine($pen, 22, 16, 27, 11)
                    $g.DrawLine($pen, 28, 22, 5, 22); $g.DrawLine($pen, 10, 17, 5, 22); $g.DrawLine($pen, 10, 27, 5, 22)
                }
                'power' {
                    $g.FillPolygon($brush, [System.Drawing.PointF[]]@((& $pt 19 2), (& $pt 7 18), (& $pt 15 18), (& $pt 12 30), (& $pt 25 13), (& $pt 17 13), (& $pt 21 2)))
                }
                'fan' {
                    $g.DrawEllipse($pen, 4, 4, 24, 24)
                    $g.FillEllipse($brush, 13, 13, 6, 6)
                    foreach ($ang in 90, 210, 330) {
                        $rad = $ang * [Math]::PI / 180
                        $g.DrawArc($pen, 16 + 9 * [Math]::Cos($rad) - 5, 16 - 9 * [Math]::Sin($rad) - 5, 10, 10, - $ang - 90, 140)
                    }
                }
                'ip' {
                    $g.DrawRectangle($pen, 4, 5, 24, 16)
                    $g.DrawLine($pen, 16, 21, 16, 26); $g.DrawLine($pen, 10, 27, 22, 27)
                }
                'globe' {
                    $g.DrawEllipse($pen, 4, 4, 24, 24)
                    $g.DrawEllipse($pen, 10.5, 4, 11, 24)
                    $g.DrawLine($pen, 4, 16, 28, 16)
                }
                'shield' {
                    $g.DrawPolygon($pen, [System.Drawing.PointF[]]@((& $pt 16 3), (& $pt 27 7), (& $pt 26 17), (& $pt 16 29), (& $pt 6 17), (& $pt 5 7)))
                }
                'ping' {
                    # A stopwatch
                    $g.DrawEllipse($pen, 5, 8, 22, 22)
                    $g.DrawLine($pen, 16, 19, 16, 13); $g.DrawLine($pen, 16, 19, 20, 22)
                    $g.DrawLine($pen, 13, 3, 19, 3); $g.DrawLine($pen, 16, 3, 16, 8)
                }
                'pulse' {
                    $g.DrawLines($pen, [System.Drawing.PointF[]]@((& $pt 3 17), (& $pt 10 17), (& $pt 13 8), (& $pt 18 26), (& $pt 21 17), (& $pt 29 17)))
                }
                'sky' {
                    # Sun peeking out from behind a cloud (the cloud is drawn first only to clip the sun)
                    $cloud = New-Object System.Drawing.Drawing2D.GraphicsPath ([System.Drawing.Drawing2D.FillMode]::Winding)
                    $cloud.AddArc(3, 17, 10, 10, 90, 180)
                    $cloud.AddArc(8, 11, 12, 12, 180, 180)
                    $cloud.AddArc(16, 15, 12, 12, 270, 180)
                    $cloud.CloseFigure()
                    $outline = $cloud.Clone()
                    $outline.Widen((New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 4))
                    $behind = New-Object System.Drawing.Region $cloud
                    $behind.Union($outline)
                    $g.SetClip($behind, [System.Drawing.Drawing2D.CombineMode]::Exclude)
                    $g.DrawArc($pen, 13, 4, 14, 14, 160, 230)
                    foreach ($ang in 0, 45, 90, 135) {
                        $rad = $ang * [Math]::PI / 180
                        $g.DrawLine($pen, 20 + 10 * [Math]::Cos($rad), 11 - 10 * [Math]::Sin($rad), 20 + 12.5 * [Math]::Cos($rad), 11 - 12.5 * [Math]::Sin($rad))
                    }
                    $g.ResetClip()
                    $g.DrawPath($pen, $cloud)
                }
            }
            $g.Dispose()
            $bmp.Save((Join-Path $dir "${prefix}_${kind}_${name}.png"), [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
        }
    }
}

# Weather icons in their own colors (the same in every theme): wx_<kind>.png at 96px for the
# current conditions (shown at 48) and wxs_<kind>.png at 44px for the day strip (shown at 22); with
# -Light wxl_/wxsl_ with darker clouds and moon for the light theme.
# Kinds match wxKind() in Weather Meter's gadget.js.
function Save-WeatherIcons([string]$dir, [switch]$Light) {
    $sunC = [System.Drawing.Color]::FromArgb(255, 255, 201, 60)
    if ($Light) {
        $moonC = [System.Drawing.Color]::FromArgb(255, 132, 146, 168)
        $pale = [System.Drawing.Color]::FromArgb(255, 184, 194, 207)
        $mid = [System.Drawing.Color]::FromArgb(255, 146, 158, 174)
        $dark = [System.Drawing.Color]::FromArgb(255, 95, 107, 122)
        $rainC = [System.Drawing.Color]::FromArgb(255, 10, 127, 208)
    } else {
        $moonC = [System.Drawing.Color]::FromArgb(255, 222, 230, 245)
        $pale = [System.Drawing.Color]::FromArgb(255, 234, 240, 247)
        $mid = [System.Drawing.Color]::FromArgb(255, 176, 188, 204)
        $dark = [System.Drawing.Color]::FromArgb(255, 112, 126, 146)
        $rainC = [System.Drawing.Color]::FromArgb(255, 76, 194, 255)
    }
    $suffix = if ($Light) { 'l' } else { '' }
    $kinds = 'clear_d', 'clear_n', 'partly_d', 'partly_n', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'sleet', 'thunder'
    foreach ($size in 96, 44) {
        $k = $size / 96   # everything below is laid out on a 96px grid
        foreach ($kind in $kinds) {
            $bmp = New-Object System.Drawing.Bitmap $size, $size
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.SmoothingMode = 'AntiAlias'
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.ScaleTransform($k, $k)
            $sun = {
                param($cx, $cy, $r)
                $b = New-Object System.Drawing.SolidBrush $sunC
                $p = New-Object System.Drawing.Pen $sunC, ($r * 0.22)
                $p.StartCap = 'Round'; $p.EndCap = 'Round'
                for ($a = 0; $a -lt 360; $a += 45) {
                    $rad = $a * [Math]::PI / 180
                    $g.DrawLine($p, $cx + $r * 1.35 * [Math]::Cos($rad), $cy + $r * 1.35 * [Math]::Sin($rad), $cx + $r * 1.75 * [Math]::Cos($rad), $cy + $r * 1.75 * [Math]::Sin($rad))
                }
                $g.FillEllipse($b, $cx - $r, $cy - $r, 2 * $r, 2 * $r)
            }
            $moon = {
                param($cx, $cy, $r)
                $p = New-Object System.Drawing.Drawing2D.GraphicsPath
                $p.AddEllipse($cx - $r, $cy - $r, 2 * $r, 2 * $r)
                $cut = New-Object System.Drawing.Drawing2D.GraphicsPath
                $cut.AddEllipse($cx - $r * 0.35, $cy - $r * 1.25, 2 * $r, 2 * $r)
                $reg = New-Object System.Drawing.Region $p
                $reg.Exclude($cut)
                $g.FillRegion((New-Object System.Drawing.SolidBrush $moonC), $reg)
            }
            $cloud = {
                param($x, $y, $w, $color)
                # A cloud $w wide with its flat bottom at $y
                $h = $w * 0.62
                # Winding: the overlapping shapes fill as one instead of cancelling out
                $p = New-Object System.Drawing.Drawing2D.GraphicsPath ([System.Drawing.Drawing2D.FillMode]::Winding)
                $p.AddEllipse($x, $y - $h * 0.62, $w * 0.42, $h * 0.62)
                $p.AddEllipse($x + $w * 0.2, $y - $h, $w * 0.5, $w * 0.5)
                $p.AddEllipse($x + $w * 0.5, $y - $h * 0.72, $w * 0.5, $h * 0.72)
                $p.AddRectangle((New-Object System.Drawing.RectangleF ($x + $w * 0.15), ($y - $h * 0.35), ($w * 0.7), ($h * 0.35)))
                $g.FillRegion((New-Object System.Drawing.SolidBrush $color), (New-Object System.Drawing.Region $p))
            }
            $drops = {
                param($n, $y)
                $p = New-Object System.Drawing.Pen $rainC, 5
                $p.StartCap = 'Round'; $p.EndCap = 'Round'
                for ($i = 0; $i -lt $n; $i++) { $x = 34 + $i * 16 - ($n - 3) * 8; $g.DrawLine($p, $x, $y, $x - 5, $y + 14) }
            }
            $flakes = {
                param($xs, $y)
                $p = New-Object System.Drawing.Pen $pale, 3.5
                $p.StartCap = 'Round'; $p.EndCap = 'Round'
                foreach ($x in $xs) {
                    for ($a = 0; $a -lt 180; $a += 60) {
                        $rad = $a * [Math]::PI / 180
                        $g.DrawLine($p, $x - 7 * [Math]::Cos($rad), $y - 7 * [Math]::Sin($rad), $x + 7 * [Math]::Cos($rad), $y + 7 * [Math]::Sin($rad))
                    }
                }
            }
            switch ($kind) {
                'clear_d' { & $sun 48 48 20 }
                'clear_n' { & $moon 48 48 26 }
                'partly_d' { & $sun 60 34 15; & $cloud 10 78 64 $pale }
                'partly_n' { & $moon 62 32 18; & $cloud 10 78 64 $pale }
                'cloudy' { & $cloud 30 62 56 $mid; & $cloud 8 80 64 $pale }
                'fog' {
                    & $cloud 16 56 64 $mid
                    $p = New-Object System.Drawing.Pen $pale, 6
                    $p.StartCap = 'Round'; $p.EndCap = 'Round'
                    $g.DrawLine($p, 14, 68, 82, 68); $g.DrawLine($p, 22, 82, 74, 82)
                }
                'drizzle' { & $cloud 14 60 68 $pale; & $drops 2 70 }
                'rain' { & $cloud 14 60 68 $mid; & $drops 3 70 }
                'snow' { & $cloud 14 60 68 $pale; & $flakes @(30, 50, 70) 78 }
                'sleet' { & $cloud 14 60 68 $mid; & $drops 1 70; & $flakes @(62) 78 }
                'thunder' {
                    & $cloud 14 60 68 $dark
                    $bolt = [System.Drawing.PointF[]]@(
                        (New-Object System.Drawing.PointF 52, 52), (New-Object System.Drawing.PointF 38, 74),
                        (New-Object System.Drawing.PointF 48, 74), (New-Object System.Drawing.PointF 42, 92),
                        (New-Object System.Drawing.PointF 62, 66), (New-Object System.Drawing.PointF 51, 66),
                        (New-Object System.Drawing.PointF 58, 52))
                    $g.FillPolygon((New-Object System.Drawing.SolidBrush $sunC), $bolt)
                }
            }
            $g.Dispose()
            $bmp.Save((Join-Path $dir "$(if ($size -eq 96) { 'wx' } else { 'wxs' })${suffix}_$kind.png"), [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
        }
    }
}

# Glass ring gauges: gauge_<level>.png per status color (LEVELS in common.js), 51 frames of 64px
# (drawn at 2x) stacked vertically for 0..100% in 2% steps. The ring opens at the bottom.
# Frame size must match GAUGE_SIZE in common.js.
function Save-Gauges([string]$dir) {
    $levels = '4cc2ff', '7ee787', 'f5d547', 'ff9f43', 'ff5f56'
    $n = 104
    for ($l = 0; $l -lt $levels.Count; $l++) {
        $c = [System.Drawing.ColorTranslator]::FromHtml('#' + $levels[$l])
        $bmp = New-Object System.Drawing.Bitmap $n, ($n * 51)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = 'AntiAlias'
        $g.Clear([System.Drawing.Color]::Transparent)
        $track = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0x1a, 0x28, 0x40)), 8
        $track.StartCap = 'Round'; $track.EndCap = 'Round'
        $glowPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(45, $c)), 15
        $glowPen.StartCap = 'Round'; $glowPen.EndCap = 'Round'
        $arc = New-Object System.Drawing.Pen $c, 8
        $arc.StartCap = 'Round'; $arc.EndCap = 'Round'
        for ($f = 0; $f -le 50; $f++) {
            $y = $f * $n
            $g.DrawArc($track, 10, $y + 10, $n - 20, $n - 20, 135, 270)
            if ($f -gt 0) {
                $g.DrawArc($glowPen, 10, $y + 10, $n - 20, $n - 20, 135, 270 * $f / 50)
                $g.DrawArc($arc, 10, $y + 10, $n - 20, $n - 20, 135, 270 * $f / 50)
            }
        }
        $g.Dispose()
        $bmp.Save((Join-Path $dir "gauge_$l.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    }
}
# Terminal theme scanlines: scan.png, tiled over the panel; one dark translucent row in three
function Save-Scanlines([string]$dir) {
    $bmp = New-Object System.Drawing.Bitmap 4, 3
    for ($x = 0; $x -lt 4; $x++) {
        $bmp.SetPixel($x, 0, [System.Drawing.Color]::FromArgb(110, 0, 0, 0))
        $bmp.SetPixel($x, 1, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        $bmp.SetPixel($x, 2, [System.Drawing.Color]::FromArgb(25, 0, 0, 0))
    }
    $bmp.Save((Join-Path $dir 'scan.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$MinH = 150; $MaxH = 1100   # must match BG_MIN_H / BG_MAX_H in common.js
$GradH = 300                # must match GLASS_GRADIENT_H in common.js
# Panels are the same for every gadget: render once, then copy
$cache = Join-Path $env:TEMP 'modern_meters_panels'
if (Test-Path $cache) { Remove-Item $cache -Recurse -Force }
Save-Panels $cache
$gadgets = @{ 'CPU_Meter_Modern.gadget' = 'cpu'; 'GPU_Meter_Modern.gadget' = 'gpu'; 'Network_Meter_Modern.gadget' = 'net'; 'Drives_Meter_Modern.gadget' = 'disk'; 'Weather_Meter_Modern.gadget' = 'sky' }
foreach ($name in $gadgets.Keys) {
    $dir = Join-Path $Root "$name\img"
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Force $dir | Out-Null
    Copy-Item (Join-Path $cache '*') $dir
    Save-Scanlines $dir
    foreach ($light in $false, $true) {
        Save-Glyphs $dir 'hdr' @($gadgets[$name]) -Light:$light
        Save-Glyphs $dir 'row' @('ram', 'commit', 'bus', 'power', 'fan', 'ip', 'globe', 'shield', 'pulse', 'ping') -Light:$light
    }
    if ($name -eq 'GPU_Meter_Modern.gadget') { Save-Gauges $dir }
    if ($name -eq 'Weather_Meter_Modern.gadget') { Save-WeatherIcons $dir; Save-WeatherIcons $dir -Light }
}
Remove-Item $cache -Recurse -Force
Save-Icon (Join-Path $Root 'CPU_Meter_Modern.gadget\icon.png') ([System.Drawing.Color]::FromArgb(255, 76, 194, 255)) 'CPU'
Save-Icon (Join-Path $Root 'GPU_Meter_Modern.gadget\icon.png') ([System.Drawing.Color]::FromArgb(255, 118, 185, 0)) 'GPU'
Save-Icon (Join-Path $Root 'Network_Meter_Modern.gadget\icon.png') ([System.Drawing.Color]::FromArgb(255, 46, 230, 197)) 'NET'
Save-Icon (Join-Path $Root 'Drives_Meter_Modern.gadget\icon.png') ([System.Drawing.Color]::FromArgb(255, 177, 140, 255)) 'DISK'
Save-Icon (Join-Path $Root 'Weather_Meter_Modern.gadget\icon.png') ([System.Drawing.Color]::FromArgb(255, 255, 159, 67)) 'SKY'
"Images written under $Root"
