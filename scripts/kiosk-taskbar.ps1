# Hides or shows the Windows taskbar on a specific monitor (ASCII only for PS 5.1).
# Usage: scripts/kiosk-taskbar.ps1 [-Action HIDE|SHOW|STATUS] [-Display P16|1|2]
param(
  [ValidateSet('HIDE', 'SHOW', 'STATUS')][string]$Action = 'HIDE',
  [string]$Display = 'P16'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot 'display-helper.ps1')

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;

namespace DeskPanel {
    public static class TaskbarManager {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenDesktop(string lpszDesktop, int dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        public static List<string> ApplyAction(string action, int screenX, int screenY, int screenW, int screenH, bool isPrimary) {
            var log = new List<string>();
            Thread t = new Thread(() => {
                IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero) {
                    SetThreadDesktop(hDesk);
                }

                var matched = new List<IntPtr>();
                if (isPrimary) {
                    IntPtr main = FindWindow("Shell_TrayWnd", null);
                    if (main != IntPtr.Zero) matched.Add(main);
                } else {
                    IntPtr sec = FindWindow("Shell_SecondaryTrayWnd", null);
                    while (sec != IntPtr.Zero) {
                        RECT r;
                        if (GetWindowRect(sec, out r)) {
                            if (r.Left >= screenX && r.Left < (screenX + screenW)) {
                                matched.Add(sec);
                            }
                        }
                        sec = FindWindowEx(IntPtr.Zero, sec, "Shell_SecondaryTrayWnd", null);
                    }
                }

                if (matched.Count == 0) {
                    log.Add("NOT_FOUND");
                    return;
                }

                const int SW_HIDE = 0;
                const int SW_SHOW = 5;
                const uint SWP_FLAGS = 0x0047; // NOSIZE | NOMOVE | NOZORDER | FRAMECHANGED | SHOWWINDOW

                foreach (var h in matched) {
                    if (action == "HIDE") {
                        ShowWindow(h, SW_HIDE);
                        log.Add("Ukryto pasek zadan na monitorze (hwnd " + h + ").");
                    } else if (action == "SHOW") {
                        ShowWindow(h, SW_SHOW);
                        SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, SWP_FLAGS);
                        log.Add("Przywrocono pasek zadan na monitorze (hwnd " + h + ").");
                    } else if (action == "STATUS") {
                        bool vis = IsWindowVisible(h);
                        log.Add("Pasek zadan jest " + (vis ? "widoczny" : "ukryty") + " (hwnd " + h + ").");
                    }
                }
            });
            t.Start();
            t.Join();
            return log;
        }
    }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'DeskPanel.TaskbarManager').Type) {
  Add-Type -TypeDefinition $code -ErrorAction Stop
}

$target = Resolve-DeskPanelScreen $Display
if (-not $target) {
  $displays = Get-DeskPanelDisplays
  $avail = ($displays | ForEach-Object { "$($_.DeviceName) ($($_.FriendlyName)) $($_.Bounds.Width)x$($_.Bounds.Height)" }) -join '; '
  throw ("Brak monitora '$Display'. Dostepne: $avail")
}

$screen = $target.Screen
$b = $target.Bounds
$dispName = if ($target.FriendlyName) { "$($target.FriendlyName) ($($target.DeviceName))" } else { $target.DeviceName }
$res = [DeskPanel.TaskbarManager]::ApplyAction($Action, $b.X, $b.Y, $b.Width, $b.Height, [bool]$screen.Primary)

if ($res.Count -eq 0 -or $res[0] -eq 'NOT_FOUND') {
  Write-Host "Nie znaleziono paska zadan na monitorze $dispName ($($b.Width)x$($b.Height))."
} else {
  foreach ($msg in $res) { Write-Host "${dispName}: $msg" }
}
