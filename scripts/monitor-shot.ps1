# Screenshot of one physical monitor at full resolution into output/screenshots (git-ignored).
# Usage: scripts/monitor-shot.ps1 [-Display 1|2|...]  - default: the first non-primary monitor.
param([int]$Display = 0)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }
'@
# Per-monitor aware, otherwise a scaled monitor is captured as a cropped corner.
[Dpi]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null

$screens = [System.Windows.Forms.Screen]::AllScreens
$screen = if ($Display -gt 0) { $screens | Where-Object { $_.DeviceName -match "DISPLAY$Display$" } | Select-Object -First 1 }
          else { $screens | Where-Object { -not $_.Primary } | Select-Object -First 1 }
if (-not $screen) {
  Write-Error ("Brak monitora. Dostepne: " + (($screens | ForEach-Object { "$($_.DeviceName) $($_.Bounds.Width)x$($_.Bounds.Height)$(if ($_.Primary) { ' (glowny)' })" }) -join '; '))
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
