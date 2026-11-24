// src/components/InstrumentSelect/index.jsx
// Instrument picker grouped like MuseScore (Keyboards, Woodwinds, Brass, …).
import { INSTRUMENT_GROUPS, getInstrument } from '../../audio/instruments'

export default function InstrumentSelect({ value, onChange, dark = false, style }) {
  const current = getInstrument(value)
  return (
    <select
      value={current.id}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      title={current.approx ? `${current.name} — plays the nearest General MIDI sound` : current.name}
      style={{
        fontSize: 11, padding: '3px 4px', borderRadius: 5, maxWidth: '100%',
        border: dark ? '1px solid #4b5563' : '1px solid #d1d5db',
        background: dark ? '#111827' : 'white', color: dark ? '#e5e7eb' : '#374151',
        ...style,
      }}
    >
      {INSTRUMENT_GROUPS.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map((it) => (
            <option key={it.id} value={it.id}>{it.name}{it.approx ? ' ≈' : ''}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}