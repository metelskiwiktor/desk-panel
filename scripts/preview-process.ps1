param([ValidateSet("identify", "terminate")][string]$Operation, [int]$ProcessId, [string]$Marker, [string]$Creation)
$ErrorActionPreference = 'Stop'
# Pin one kernel process object for both the creation-time check and termination.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PreviewProcess {
  [StructLayout(LayoutKind.Sequential)] public struct FILETIME { public uint Low, High; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static string Created(IntPtr h) {
    FILETIME a,b,c,d;
    if (!GetProcessTimes(h, out a, out b, out c, out d)) throw new System.ComponentModel.Win32Exception();
    return (((ulong)a.High << 32) | a.Low).ToString();
  }
}
"@
$handle = [PreviewProcess]::OpenProcess(0x1001, $false, $ProcessId)
if ($handle -eq [IntPtr]::Zero) {
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { Write-Output 'gone'; exit 0 }
  throw 'Cannot open preview process; refusing to terminate an unverified PID.'
}
try {
  $actual = [PreviewProcess]::Created($handle)
  if ($Operation -eq 'identify') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    if (-not $proc -or -not $proc.CommandLine.Contains($Marker)) { throw 'Preview process marker not found; refusing to record PID.' }
    Write-Output $actual
  } else {
    if ($actual -ne $Creation) { Write-Output 'mismatch'; exit 0 }
    if (-not [PreviewProcess]::TerminateProcess($handle, 1)) { throw 'Could not terminate verified preview process.' }
    Write-Output 'terminated'
  }
} finally { [void][PreviewProcess]::CloseHandle($handle) }
