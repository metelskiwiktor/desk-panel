# Display resolution helper for Desk Panel kiosk scripts (ASCII only for PS 5.1).
# Resolves monitor by friendly name (e.g. 'P16'), hardware ID, or GDI display number.
Add-Type -AssemblyName System.Windows.Forms

$code = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DeskPanel {
    public static class DisplayResolver {
        [StructLayout(LayoutKind.Sequential)]
        public struct LUID {
            public uint LowPart;
            public int HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DISPLAYCONFIG_SOURCE_INFO {
            public LUID adapterId;
            public uint id;
            public uint modeInfoIdx;
            public uint statusFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DISPLAYCONFIG_TARGET_INFO {
            public LUID adapterId;
            public uint id;
            public uint modeInfoIdx;
            public uint outputTechnology;
            public uint rotation;
            public uint scaling;
            public uint refreshRateNumerator;
            public uint refreshRateDenominator;
            public uint scanLineOrdering;
            public bool targetAvailable;
            public uint statusFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DISPLAYCONFIG_PATH_INFO {
            public DISPLAYCONFIG_SOURCE_INFO sourceInfo;
            public DISPLAYCONFIG_TARGET_INFO targetInfo;
            public uint flags;
        }

        public enum DISPLAYCONFIG_MODE_INFO_TYPE : uint {
            SOURCE = 1,
            TARGET = 2,
            DESKTOP_IMAGE = 3
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct DISPLAYCONFIG_MODE_INFO_UNION {
            [FieldOffset(0)]
            public DISPLAYCONFIG_SOURCE_MODE sourceMode;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DISPLAYCONFIG_SOURCE_MODE {
            public uint width;
            public uint height;
            public uint pixelFormat;
            public long position;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DISPLAYCONFIG_MODE_INFO {
            public DISPLAYCONFIG_MODE_INFO_TYPE infoType;
            public uint id;
            public LUID adapterId;
            public DISPLAYCONFIG_MODE_INFO_UNION modeInfo;
        }

        public enum DISPLAYCONFIG_DEVICE_INFO_TYPE : uint {
            GET_SOURCE_NAME = 1,
            GET_TARGET_NAME = 2
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct DISPLAYCONFIG_TARGET_DEVICE_NAME {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public uint flags;
            public uint outputTechnology;
            public ushort edidManufactureId;
            public ushort edidProductCodeId;
            public uint connectorInstance;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string monitorFriendlyDeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string monitorDevicePath;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct DISPLAYCONFIG_SOURCE_DEVICE_NAME {
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string viewGdiDeviceName;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DISPLAYCONFIG_DEVICE_INFO_HEADER {
            public DISPLAYCONFIG_DEVICE_INFO_TYPE type;
            public uint size;
            public LUID adapterId;
            public uint id;
        }

        [DllImport("user32.dll")]
        public static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);

        [DllImport("user32.dll")]
        public static extern int QueryDisplayConfig(uint flags, ref uint numPathArrayElements, [Out] DISPLAYCONFIG_PATH_INFO[] pathArray, ref uint numModeInfoArrayElements, [Out] DISPLAYCONFIG_MODE_INFO[] modeInfoArray, IntPtr currentTopologyId);

        [DllImport("user32.dll")]
        public static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_TARGET_DEVICE_NAME requestPacket);

        [DllImport("user32.dll")]
        public static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_SOURCE_DEVICE_NAME requestPacket);

        public const uint QDC_ONLY_ACTIVE_PATHS = 0x00000002;

        public class DisplayMapping {
            public string GdiDeviceName;
            public string FriendlyName;
            public string DevicePath;
        }

        public static List<DisplayMapping> QueryActiveDisplays() {
            var list = new List<DisplayMapping>();
            try {
                uint pathCount, modeCount;
                int err = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCount, out modeCount);
                if (err != 0 || pathCount == 0) return list;

                var paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
                var modes = new DISPLAYCONFIG_MODE_INFO[modeCount];
                err = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
                if (err != 0) return list;

                for (int i = 0; i < pathCount; i++) {
                    var p = paths[i];

                    var src = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
                    src.header.type = DISPLAYCONFIG_DEVICE_INFO_TYPE.GET_SOURCE_NAME;
                    src.header.size = (uint)Marshal.SizeOf(src);
                    src.header.adapterId = p.sourceInfo.adapterId;
                    src.header.id = p.sourceInfo.id;
                    DisplayConfigGetDeviceInfo(ref src);

                    var tgt = new DISPLAYCONFIG_TARGET_DEVICE_NAME();
                    tgt.header.type = DISPLAYCONFIG_DEVICE_INFO_TYPE.GET_TARGET_NAME;
                    tgt.header.size = (uint)Marshal.SizeOf(tgt);
                    tgt.header.adapterId = p.targetInfo.adapterId;
                    tgt.header.id = p.targetInfo.id;
                    DisplayConfigGetDeviceInfo(ref tgt);

                    list.Add(new DisplayMapping {
                        GdiDeviceName = src.viewGdiDeviceName ?? "",
                        FriendlyName = tgt.monitorFriendlyDeviceName ?? "",
                        DevicePath = tgt.monitorDevicePath ?? ""
                    });
                }
            } catch {
            }
            return list;
        }
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'DeskPanel.DisplayResolver').Type) {
    Add-Type -TypeDefinition $code -ErrorAction Stop
}

function Get-DeskPanelDisplays {
    $mappings = [DeskPanel.DisplayResolver]::QueryActiveDisplays()
    $screens = [System.Windows.Forms.Screen]::AllScreens

    $results = @()
    foreach ($screen in $screens) {
        $devName = $screen.DeviceName
        $map = $mappings | Where-Object { $_.GdiDeviceName -eq $devName } | Select-Object -First 1

        $friendly = if ($map -and $map.FriendlyName) { $map.FriendlyName } else { "" }
        $path = if ($map -and $map.DevicePath) { $map.DevicePath } else { "" }

        $dispNum = if ($devName -match 'DISPLAY(\d+)') { [int]$matches[1] } else { 0 }

        $results += [PSCustomObject]@{
            Screen = $screen
            DeviceName = $devName
            DisplayNumber = $dispNum
            FriendlyName = $friendly
            DevicePath = $path
            Bounds = $screen.Bounds
            Primary = [bool]$screen.Primary
        }
    }
    return $results
}

function Resolve-DeskPanelScreen([string]$Target = 'P16') {
    $displays = Get-DeskPanelDisplays
    if (-not $displays -or $displays.Count -eq 0) {
        return $null
    }

    # 1. Exact match by FriendlyName (case-insensitive)
    $match = $displays | Where-Object { $_.FriendlyName -ieq $Target } | Select-Object -First 1
    if ($match) { return $match }

    # 2. Exact match by DisplayNumber or DeviceName (e.g. '2' -> DISPLAY2, 'DISPLAY2' -> DISPLAY2)
    if ($Target -match '^\d+$') {
        $num = [int]$Target
        $match = $displays | Where-Object { $_.DisplayNumber -eq $num } | Select-Object -First 1
        if ($match) { return $match }
    } elseif ($Target -match '^(\\\\.\\)?DISPLAY\d+$') {
        $match = $displays | Where-Object { $_.DeviceName -imatch "(^|\\)$Target$" } | Select-Object -First 1
        if ($match) { return $match }
    }

    # 3. Match by DevicePath / hardware ID (e.g. YZA0001)
    $match = $displays | Where-Object { $_.DevicePath -ilike "*$Target*" } | Select-Object -First 1
    if ($match) { return $match }

    # 4. Partial substring match by FriendlyName (only if Target is not purely numeric)
    if ($Target -notmatch '^\d+$') {
        $match = $displays | Where-Object { $_.FriendlyName -ilike "*$Target*" } | Select-Object -First 1
        if ($match) { return $match }
    }

    return $null
}
