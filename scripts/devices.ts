// `just devices`: derived sizes of every screen in devices.json, ready for Chrome DevTools
// (Settings → Devices → Add custom device: width, height, device pixel ratio, type "Desktop (touch)").
import { devices, ppi, viewportsOf } from '../src/devices';

for (const [id, device] of Object.entries(devices)) {
  console.log(`\n${device.name} (${id}) · ${device.resolution.join(' × ')} px · ${device.diagonalInches}" · ${ppi(device)} PPI${device.touch ? ' · dotyk' : ''}`);
  for (const v of viewportsOf(id))
    console.log(`  ${`${Math.round(v.scale * 100)}%`.padStart(5)}  ${`${v.width} × ${v.height} px CSS`.padEnd(22)} DevTools: ${v.width}, ${v.height}, DPR ${v.scale}${v.primary ? '   ← główne' : ''}`);
}
