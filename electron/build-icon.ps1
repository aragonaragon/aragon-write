#
# Generates electron/icon.ico from electron/logo-source.png by:
#   1. Cropping a square focused on the alef (excludes the "Aragon Write" text)
#   2. Resizing to multiple sizes (16..256)
#   3. Packing into a multi-resolution .ico file (PNG-encoded entries)
#
# Run from project root:  powershell -ExecutionPolicy Bypass -File electron\build-icon.ps1
#

Add-Type -AssemblyName System.Drawing

$scriptDir   = $PSScriptRoot
$sourcePath  = Join-Path $scriptDir 'logo-source.png'
$icoPath     = Join-Path $scriptDir 'icon.ico'
$pngPath     = Join-Path $scriptDir 'logo.png'

if (-not (Test-Path $sourcePath)) {
    throw "Source logo not found at $sourcePath. Copy a square-friendly logo source there first."
}

# Multi-size icon (Windows picks the right size at render time)
$sizes = 16, 32, 48, 64, 128, 256

# Load the source image once and figure out a clean square crop that contains
# the alef letterform but excludes the "Aragon Write" text underneath. The
# source banner is 1672x941 (16:9). The alef sits in the upper ~75% centered
# horizontally — so we take a square equal to ~75% of the height (706px),
# centered horizontally, starting at the top.
$source = [System.Drawing.Image]::FromFile($sourcePath)
$sw = $source.Width
$sh = $source.Height

# Crop dimensions — height = 75% (drops the text band), then center horizontally
$cropSize = [int]([Math]::Round($sh * 0.75))
$cropX    = [int]([Math]::Round(($sw - $cropSize) / 2.0))
$cropY    = 0
$cropRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)

Write-Host ("Source: {0}x{1}, crop: {2}x{2} at ({3},{4})" -f $sw, $sh, $cropSize, $cropX, $cropY)

# Save the cropped square as logo.png too — useful for in-app branding.
$cropped = New-Object System.Drawing.Bitmap($cropSize, $cropSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$cg = [System.Drawing.Graphics]::FromImage($cropped)
$cg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cg.DrawImage($source, (New-Object System.Drawing.Rectangle(0, 0, $cropSize, $cropSize)), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$cg.Dispose()
$cropped.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Cropped logo saved: $pngPath"

$pngBytesList = @()

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $g.DrawImage($cropped, (New-Object System.Drawing.Rectangle(0, 0, $s, $s)), (New-Object System.Drawing.Rectangle(0, 0, $cropSize, $cropSize)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesList += ,$ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
}

$cropped.Dispose()
$source.Dispose()

# Hand-pack ICO file (ref: https://en.wikipedia.org/wiki/ICO_(file_format))
$header = [System.IO.MemoryStream]::new()
$bw     = [System.IO.BinaryWriter]::new($header)

# ICONDIR
$bw.Write([UInt16]0)               # reserved
$bw.Write([UInt16]1)               # type = icon
$bw.Write([UInt16]$sizes.Count)    # image count

$dataOffset = 6 + (16 * $sizes.Count)

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s   = $sizes[$i]
    $png = $pngBytesList[$i]

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

foreach ($png in $pngBytesList) { $bw.Write($png) }

[System.IO.File]::WriteAllBytes($icoPath, $header.ToArray())
$bw.Dispose()
$header.Dispose()

$icoBytes = [System.IO.File]::ReadAllBytes($icoPath)
Write-Host ("Icon written: {0} ({1:N0} bytes, {2} sizes)" -f $icoPath, $icoBytes.Length, $sizes.Count)
