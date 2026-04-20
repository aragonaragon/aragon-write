# Creates a desktop shortcut for Aragon Write
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath    = Join-Path $scriptRoot "launch.bat"
$desktop    = [Environment]::GetFolderPath("Desktop")
$lnkPath    = Join-Path $desktop "Aragon Write.lnk"

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath       = $batPath
$shortcut.WorkingDirectory = $scriptRoot
$shortcut.Description      = "Aragon Write - Arabic AI Writing Editor"
$shortcut.WindowStyle      = 1
$shortcut.Save()

Write-Host "Shortcut created on Desktop: Aragon Write.lnk" -ForegroundColor Green
