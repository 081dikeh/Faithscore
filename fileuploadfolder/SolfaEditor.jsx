// src/components/SolfaEditor/index.jsx
// FaithScore — Solfa input toolbar: syllable buttons, octave, duration, layout switch

import { useState } from 'react'
import { useSolfaStore } from '../../store/solfaStore'

const SYLLABLES = ['d', 'r', 'm', 'f', 's', 'l', 't']
const CHROMATIC = ['de', 'ri', 'fe', 'se', 'ta']  // chromatic alterations
const DURATIONS = [
  { label: '𝅝', value: 2,    title: 'Double note (2 beats)' },
  { label: '♩', value: 1,    title: 'Beat (1 beat)' },
  { label: '♪', value: 0.5,  title: 'Half beat' },
  { label: '♬', value: 0.25, title: 'Quarter beat' },
]
const KEYS = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']
const LAYOUTS = [
  { id: 'satb',   label: '⊞ SATB',   title: 'Stacked SATB voices (standard choral)' },
  { id: 'linear', label: '≡ Linear', title: 'Single voice, measures in rows' },
  { id: 'grid',   label: '⊟ Grid',   title: 'Table grid layout (Lead us Home style)' },
]

export default function SolfaEditor() {
  const inputMode       = useSolfaStore(s => s.inputMode)
  const selectedPartId  = useSolfaStore(s => s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)
  const score           = useSolfaStore(s => s.score)
  const setInputMode    = useSolfaStore(s => s.setInputMode)
  const setKey          = useSolfaStore(s => s.setKey)
  const setLayout       = useSolfaStore(s => s.setLayout)
  const placeNote       = useSolfaStore(s => s.placeNote)
  const addMeasure      = useSolfaStore(s => s.addMeasure)

  const [selectedDuration, setSelectedDuration] = useState(1)
  const [selectedOctave,   setSelectedOctave]   = useState(0)
  const [beatCursor,       setBeatCursor]        = useState(0)
  const [showChromatic,    setShowChromatic]     = useState(false)

  const canInput = inputMode === 'note' && selectedMeasureIdx !== null

  function handleSyllable(syl) {
    if (!canInput) return
    placeNote(selectedPartId, selectedMeasureIdx, beatCursor, syl, selectedOctave, selectedDuration)
    // Advance cursor
    setBeatCursor(prev => {
      const ts = score.timeSignature?.beats ?? 4
      const next = prev + selectedDuration
      return next >= ts ? 0 : next
    })
  }

  const btn = (label, onClick, active, title, color) => (
    <button key={label} onClick={onClick} title={title}
      style={{
        padding: '4px 10px', fontSize: 12, fontWeight: active ? 700 : 500,
        border: `1px solid ${active ? (color || '#2563eb') : '#d1d5db'}`,
        background: active ? (color ? color + '18' : '#eff6ff') : 'white',
        color: active ? (color || '#2563eb') : '#374151',
        borderRadius: 5, cursor: 'pointer', transition: 'all 0.1s',
        fontFamily: '"Times New Roman", serif',
      }}>
      {label}
    </button>
  )

  return (
    <div style={{
      background: 'white', borderBottom: '1px solid #e5e7eb',
      padding: '6px 12px', display: 'flex', flexWrap: 'wrap',
      alignItems: 'center', gap: 10, flexShrink: 0,
    }}>

      {/* ── Mode toggle ── */}
      <div style={{ display:'flex', gap:3 }}>
        {btn('Select', () => setInputMode('select'), inputMode === 'select', 'Select mode (Esc)')}
        {btn('● Note Input', () => setInputMode('note'), inputMode === 'note', 'Note input mode (N)', '#16a34a')}
      </div>

      <div style={{ width:1, height:20, background:'#e5e7eb' }} />

      {/* ── Syllable buttons ── */}
      <div style={{ display:'flex', gap:2 }}>
        {SYLLABLES.map(syl => btn(syl, () => handleSyllable(syl),
          false, `Insert ${syl}`, canInput ? '#1d4ed8' : undefined))}
        <button onClick={() => setShowChromatic(v => !v)}
          title="Chromatic alterations"
          style={{ padding:'4px 6px', fontSize:10, border:'1px solid #d1d5db',
            background: showChromatic ? '#fef3c7' : 'white', borderRadius:5, cursor:'pointer' }}>
          ♯/♭
        </button>
        {showChromatic && CHROMATIC.map(syl => btn(syl, () => handleSyllable(syl),
          false, `Insert ${syl}`))}
      </div>

      <div style={{ width:1, height:20, background:'#e5e7eb' }} />

      {/* ── Octave ── */}
      <div style={{ display:'flex', alignItems:'center', gap:3 }}>
        <span style={{ fontSize:10, color:'#6b7280' }}>Oct:</span>
        {[[-1,'₋₁','Lower'], [0,'₀','Middle'], [1,'₁','Upper']].map(([oct, lbl, title]) =>
          btn(lbl, () => setSelectedOctave(oct), selectedOctave === oct, title)
        )}
      </div>

      <div style={{ width:1, height:20, background:'#e5e7eb' }} />

      {/* ── Duration ── */}
      <div style={{ display:'flex', alignItems:'center', gap:3 }}>
        <span style={{ fontSize:10, color:'#6b7280' }}>Dur:</span>
        {DURATIONS.map(d => btn(d.label, () => setSelectedDuration(d.value),
          selectedDuration === d.value, d.title))}
      </div>

      <div style={{ width:1, height:20, background:'#e5e7eb' }} />

      {/* ── Rest / Sustain ── */}
      <div style={{ display:'flex', gap:2 }}>
        <button onClick={() => {
          if (!canInput) return
          useSolfaStore.getState().clearNote(selectedPartId, selectedMeasureIdx, beatCursor)
          setBeatCursor(p => Math.min(p + selectedDuration, (score.timeSignature?.beats ?? 4) - 0.25))
        }} title="Insert rest"
          style={{ padding:'4px 10px', fontSize:12, border:'1px solid #d1d5db',
            background:'white', borderRadius:5, cursor:'pointer', color:'#6b7280' }}>
          ○ Rest
        </button>
        <button onClick={() => {
          if (!canInput) return
          placeNote(selectedPartId, selectedMeasureIdx, beatCursor, null, 0, selectedDuration)
          setBeatCursor(p => p + selectedDuration)
        }} title="Insert sustain/hold (–)"
          style={{ padding:'4px 10px', fontSize:12, border:'1px solid #d1d5db',
            background:'white', borderRadius:5, cursor:'pointer', color:'#6b7280' }}>
          – Hold
        </button>
      </div>

      <div style={{ flex:1 }} />

      {/* ── Key selector ── */}
      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
        <span style={{ fontSize:10, color:'#6b7280', fontStyle:'italic' }}>Doh is</span>
        <select value={score.key || 'C'} onChange={e => setKey(e.target.value)}
          style={{ fontSize:12, border:'1px solid #d1d5db', borderRadius:5,
            padding:'3px 6px', background:'white', color:'#374151' }}>
          {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {/* ── Layout selector ── */}
      <div style={{ display:'flex', gap:2 }}>
        {LAYOUTS.map(l => btn(l.label, () => setLayout(l.id),
          score.layout === l.id, l.title))}
      </div>

      {/* ── Add measure ── */}
      <button onClick={addMeasure}
        title="Add measure"
        style={{ padding:'4px 10px', fontSize:11, border:'1px solid #d1d5db',
          background:'white', borderRadius:5, cursor:'pointer', color:'#374151' }}>
        + Bar
      </button>

      {/* Cursor position indicator */}
      {canInput && (
        <span style={{ fontSize:10, color:'#9ca3af', fontFamily:'monospace' }}>
          beat {beatCursor + 1}
        </span>
      )}
    </div>
  )
}