import { z } from 'zod';
import raw from '../devices.json';

/**
 * Target screens. `resolution` is physical pixels as mounted (width × height);
 * `scales` are Windows display scaling factors, the first one being the one we
 * design for. Everything else (CSS viewport, PPI, DevTools values) is derived.
 * The UI layout never reads this — it only describes what a screen matches.
 */
export const deviceSchema = z.object({
  name: z.string().min(1),
  diagonalInches: z.number().positive(),
  resolution: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  scales: z.array(z.number().min(1).max(4)).min(1),
  touch: z.boolean(),
}).strict();
export type Device = z.infer<typeof deviceSchema>;
export const devices = z.record(z.string().regex(/^[a-z0-9.-]+$/), deviceSchema).parse(raw);

export interface Viewport {
  deviceId: string;
  device: Device;
  scale: number;
  /** CSS pixels the browser lays out in, full screen. */
  width: number;
  height: number;
  /** The scale the device is designed for. */
  primary: boolean;
  /** Used in screenshot file names, e.g. `medialove-14@1.25x`. */
  label: string;
}

export function viewportsOf(deviceId: string): Viewport[] {
  const device = devices[deviceId];
  if (!device) throw new Error(`Nieznane urządzenie ${deviceId}. Dostępne: ${Object.keys(devices).join(', ')}`);
  return device.scales.map((scale, i) => ({
    deviceId, device, scale, primary: i === 0, label: `${deviceId}@${scale}x`,
    width: Math.round(device.resolution[0] / scale), height: Math.round(device.resolution[1] / scale),
  }));
}
export const allViewports = () => Object.keys(devices).flatMap(viewportsOf);
export const ppi = (device: Device) => Math.round(Math.hypot(...device.resolution) / device.diagonalInches);

/** What the browser reports about the screen it is on (CSS px, as `window.screen`). */
export interface ScreenInfo { width: number; height: number; scale: number }
/** The configured viewport this screen is, if any (±1 px for rounding of fractional scales). */
export function matchScreen(screen: ScreenInfo): Viewport | undefined {
  return allViewports().find(v => Math.abs(v.scale - screen.scale) < 0.01
    && Math.abs(v.width - screen.width) <= 1 && Math.abs(v.height - screen.height) <= 1);
}
