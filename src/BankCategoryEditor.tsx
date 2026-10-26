import { useState } from 'react';
import { BANK_COLORS, BANK_ICONS, BANK_LABEL_LIMITS, type BankColor, type BankIcon } from './bank-labels-contract';
import { COLOR_NAMES, COLOR_VALUES, ICONS } from './bank-look';

/** A category's or source's name, colour and icon, for a new one (in the marking dialog) or an existing one (in the settings). */
export function BankCategoryEditor({ initial, submit, cancel, label, placeholder = 'Nazwa, np. Psycholog' }: {
  initial: { name: string; color: BankColor; icon: BankIcon }; submit: (value: { name: string; color: BankColor; icon: BankIcon }) => void; cancel: () => void; label: string; placeholder?: string;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [icon, setIcon] = useState(initial.icon);
  const ready = name.trim().length > 0;
  const send = () => { if (ready) submit({ name: name.trim(), color, icon }); };
  return <div className="bank-cat-editor" style={{ '--c': COLOR_VALUES[color] } as React.CSSProperties}>
    <input aria-label="Nazwa" value={name} maxLength={BANK_LABEL_LIMITS.name} placeholder={placeholder} autoFocus
      onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }} />
    <div className="bank-swatches" role="radiogroup" aria-label="Kolor">
      {BANK_COLORS.map(c => <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={COLOR_NAMES[c]} style={{ background: COLOR_VALUES[c] }} onClick={() => setColor(c)} />)}
    </div>
    <div className="bank-icons" role="radiogroup" aria-label="Ikona">
      {BANK_ICONS.map(i => { const Icon = ICONS[i]; return <button key={i} type="button" role="radio" aria-checked={i === icon} aria-label={`ikona ${i}`} onClick={() => setIcon(i)}><Icon size={16} aria-hidden="true" /></button>; })}
    </div>
    <div className="bank-cat-editor-actions">
      <button type="button" onClick={cancel}>Anuluj</button>
      <button type="button" className="save" disabled={!ready} onClick={send}>{label}</button>
    </div>
  </div>;
}
