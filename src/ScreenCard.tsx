import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Card } from './components';
import { matchScreen, viewportsOf } from './devices';

const percent = (scale: number) => `${Math.round(scale * 100)}%`;
function readScreen() {
  return { width: window.screen.width, height: window.screen.height, scale: window.devicePixelRatio || 1,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight, touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window };
}

/** Describes the screen the panel is on and which devices.json entry it matches. Never affects layout. */
export function ScreenCard() {
  const [screen, setScreen] = useState(readScreen);
  useEffect(() => {
    // Moving the window to another monitor or changing Windows scaling fires resize.
    const update = () => setScreen(readScreen());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const match = matchScreen(screen);
  const primary = match && viewportsOf(match.deviceId)[0];
  const windowed = screen.innerWidth < screen.width - 1 || screen.innerHeight < screen.height - 1;
  return <Card title="Ekran" icon={<Monitor />}>
    <p className="card-intro">{screen.width} × {screen.height} px CSS · skalowanie {percent(screen.scale)} · {screen.touch ? 'dotyk' : 'bez dotyku'}</p>
    {match?.primary && <p className="meta">✔ Zgodny z: {match.device.name} przy {percent(match.scale)}</p>}
    {match && !match.primary && primary && <p className="warning">
      {match.device.name} przy {percent(match.scale)} to wariant zapasowy. Panel jest projektowany pod {percent(primary.scale)} (Ustawienia Windows → System → Ekran → Skala).
    </p>}
    {!match && <p className="meta">Ten ekran nie odpowiada żadnemu urządzeniu z devices.json.</p>}
    {windowed && <p className="meta">Okno przeglądarki: {screen.innerWidth} × {screen.innerHeight} px, czyli nie na pełnym ekranie.</p>}
  </Card>;
}
