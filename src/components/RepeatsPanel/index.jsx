// src/components/RepeatsPanel/index.jsx
// Shared sidebar panel for repeats and 1st / 2nd-time endings — used by both
// the Staff and the Solfa sidebars. Store-agnostic: the caller passes the
// score's repeats/voltas, the bar selection and the store actions.
import { useState } from 'react'
import { barNumberOf, indexOfBarNumber, voltaLabel } from '../../utils/segnoNavigation'

const small = { width: 44, fontSize: 11, padding: '3px 4px', border: '1px solid #d1d5db', borderRadius: 4 }
const btn = (disabled) => ({
  flex: 1, fontSize: 11, fontWeight: 600, padding: '6px 4px', borderRadius: 6, border: '1px solid #e5e7eb',
  background: 'white', color: '#374151', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
})
const tiny = { border: '1px solid #e5e7eb', background: 'white', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '0 5px' }
const del = { border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }

// range: [firstBar, lastBar] selected (0-based), or null. When a single bar is
// selected, "Cover N bar(s)" extends it forwards.
export default function RepeatsPanel({ measures = [], repeats = [], voltas = [], range = null, actions }) {
  const { addRepeat, updateRepeat, removeRepeat, addVolta, updateVolta, removeVolta } = actions
  const [count, setCount] = useState(1)
  const [passes, setPasses] = useState('1')
  const noSel = !range
  const single = !range || range[0] === range[1]
  const start = range ? range[0] : null
  const end = !range ? null : single ? Math.min(measures.length - 1, range[0] + Math.max(1, count) - 1) : range[1]
  const nums = [...new Set(passes.split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n >= 1))].sort((a, b) => a - b)
  const bn = (i) => barNumberOf(measures, i)
  const rangeText = (a, b) => (a === b ? `bar ${bn(a)}` : `bars ${bn(a)}–${bn(b)}`)
  const sorted = [...voltas].sort((a, b) => a.startMeasure - b.startMeasure)

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        Repeats &amp; 1st / 2nd endings
      </div>
      {single ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#374151', marginBottom: 6 }}>
          Cover
          <input type="number" min={1} value={count} style={small}
            onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))} />
          bar(s) from the selected bar
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#374151', marginBottom: 6 }}>
          Covers the selected {rangeText(range[0], range[1])}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button disabled={noSel} style={btn(noSel)} onClick={() => addRepeat(start, end)}>Add repeat</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#374151', marginBottom: 6 }}>
        Ending plays on time(s)
        <input value={passes} style={{ ...small, width: 56 }} placeholder="1" onChange={e => setPasses(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button disabled={noSel || !nums.length} style={btn(noSel || !nums.length)}
          onClick={() => addVolta(start, end, nums)}>
          Add ending{nums.length ? ` ${nums.join(', ')}.` : ''}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: '#6b7280', lineHeight: 1.4, marginTop: 6 }}>
        Select the last bar(s) of the section, add ending 1 (a repeat is added for you), then select the bar(s) after it
        and add ending 2. Use “1, 2” for one bracket that plays on both times.
      </div>
      {(repeats.length > 0 || sorted.length > 0) && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {repeats.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#374151' }}>
              <span style={{ flex: 1 }}>
                Repeat: from bar
                <input type="number" min={1} style={{ ...small, margin: '0 4px' }} value={bn(r.start)}
                  onChange={e => { const i = indexOfBarNumber(measures, parseInt(e.target.value)); if (i >= 0 && i <= r.end) updateRepeat(r.id, { start: i }) }} />
                to bar
                <input type="number" min={1} style={{ ...small, margin: '0 4px' }} value={bn(r.end)}
                  onChange={e => { const i = indexOfBarNumber(measures, parseInt(e.target.value)); if (i >= r.start) updateRepeat(r.id, { end: i }) }} />
              </span>
              <button title="Remove repeat" style={del} onClick={() => removeRepeat(r.id)}>✕</button>
            </div>
          ))}
          {sorted.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#374151' }}>
              <span style={{ flex: 1 }}>Ending <b>{voltaLabel(v)}</b> · {rangeText(v.startMeasure, v.endMeasure)}</span>
              <button title="Cover one more bar" style={tiny}
                onClick={() => v.endMeasure < measures.length - 1 && updateVolta(v.id, { endMeasure: v.endMeasure + 1 })}>+</button>
              <button title="Cover one fewer bar" style={tiny}
                onClick={() => v.endMeasure > v.startMeasure && updateVolta(v.id, { endMeasure: v.endMeasure - 1 })}>−</button>
              <button title="Remove ending" style={del} onClick={() => removeVolta(v.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}