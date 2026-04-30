#
# Generates electron/icon.ico from scratch using .NET System.Drawing.
# Run from project root:  powershell -ExecutionPolicy Bypass -File electron\build-icon.ps1
#

Add-Type -AssemblyName System.Drawing

$outDir  = Join-Path $PSScriptRoot ''
$icoPath = Join-Path $outDir 'icon.ico'

# Multi-size icon (Windows picks the right size at render time)
$sizes = 16, 32, 48, 64, 128, 256

# Brand colors
$bgTop    = [System.Drawing.Color]::FromArgb(255, 200, 149, 108)   # #c8956c warm tan
$bgBottom = [System.Drawing.Color]::FromArgb(255, 168, 116,  74)   # darker tan
$letter   = [System.Drawing.Color]::FromArgb(255, 253, 248, 240)   # ivory

$pngBytesList = @()

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Rounded square background with vertical gradient
    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgTop, $bgBottom, 90)

    $r   = [int]([Math]::Round($s * 0.18))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0,         0,         $r * 2, $r * 2, 180, 90)
    $path.AddArc($s - $r*2, 0,         $r * 2, $r * 2, 270, 90)
    $path.AddArc($s - $r*2, $s - $r*2, $r * 2, $r * 2,   0, 90)
    $path.AddArc(0,         $s - $r*2, $r * 2, $r * 2,  90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)

    # Draw Arabic "أ" centered
    $fontSize = [single]([Math]::Round($s * 0.62))
    $font = $null
    foreach ($name in 'Amiri', 'Traditional Arabic', 'Tahoma', 'Arial') {
        try {
            $font = New-Object System.Drawing.Font($name, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            break
        } catch {}
    }
    if (-not $font) { $font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }

    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = New-Object System.Drawing.SolidBrush($letter)
    $g.DrawString([char]0x0623, $font, $textBrush, [System.Drawing.RectangleF]::FromLTRB(0, 0, $s, $s), $sf)

    $textBrush.Dispose()
    $font.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $g.Dispose()

    # Encode to PNG in-memory
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesList += ,$ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
}

# Hand-pack ICO file
# Reference: https://en.wikipedia.org/wiki/ICO_(file_format)
$header = [System.IO.MemoryStream]::new()
$bw     = [System.IO.BinaryWriter]::new($header)

# ICONDIR
$bw.Write([UInt16]0)               # reserved
$bw.Write([UInt16]1)               # type = icon
$bw.Write([UInt16]$sizes.Count)    # image count

# Compute offsets (header is 6 + 16*N bytes)
$dataOffset = 6 + (16 * $sizes.Count)

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s   = $sizes[$i]
    $png = $pngBytesList[$i]

    # Width / height: 0 means 256
    $w = if ($s -ge 256) { 0 } else { $s }
    $h = if ($s -ge 256) { 0 } else { $s }

    $bw.Write([byte]$w)             # width
    $bw.Write([byte]$h)             # height
    $bw.Write([byte]0)              # palette
    $bw.Write([byte]0)              # reserved
    $bw.Write([UInt16]1)            # color planes
    $bw.Write([UInt16]32)           # bits-per-pixel
    $bw.Write([UInt32]$png.Length)  # bytes in resource
    $bw.Write([UInt32]$dataOffset)  # offset to image data
    $dataOffset += $png.Length
}

# Append PNG payloads
foreach ($png in $pngBytesList) { $bw.Write($png) }

[System.IO.File]::WriteAllBytes($icoPath, $header.ToArray())
$bw.Dispose()
$header.Dispose()

Write-Host "Icon written: $icoPath ($([System.IO.File]::ReadAllBytes($icoPath).Length) bytes, $($sizes.Count) sizes)"
