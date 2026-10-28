# Screenshot of one physical monitor at full resolution into output/screenshots (git-ignored).
# Usage: scripts/monitor-shot.ps1 [-Display P16|1|2|0]  - default: 0 (the first non-primary monitor).
param([string]$Display = '0')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
. (Join-Path $PSScriptRoot 'display-helper.ps1')

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }
'@
# Per-monitor aware, otherwise a scaled monitor is captured as a cropped corner.
[Dpi]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null

$screen = if ($Display -ne '0' -and $Display -ne '') {
  $target = Resolve-DeskPanelScreen $Display
  if ($target) { $target.Screen } else { $null }
} else {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
}

if (-not $screen) {
  $displays = Get-DeskPanelDisplays
  $avail = ($displays | ForEach-Object { "$($_.DeviceName) ($($_.FriendlyName)) $($_.Bounds.Width)x$($_.Bounds.Height)$(if ($_.Primary) { ' (glowny)' })" }) -join '; '
  Write-Error ("Brak monitora '$Display'. Dostepne: $avail")
  exit 1
}
$b = $screen.Bounds
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'output/screenshots'
New-Item -ItemType Directory -Force $dir | Out-Null
$name = $screen.DeviceName.TrimStart('\', '.').ToLower()
$path = Join-Path $dir "monitor-$name.png"
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output $path
