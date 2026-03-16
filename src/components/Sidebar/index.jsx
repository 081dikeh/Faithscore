// src/components/Sidebar/index.jsx
// MuseScore-style left sidebar: Palettes / Layout / Properties tabs
// with collapsible accordion sections and functional palette items.

import { useState } from 'react'
import { useScoreStore } from '../../store/scoreStore'

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          padding: '7px 12px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
          fontSize: 12, fontWeight: 600, color: '#1f2937',
          userSelect: 'none',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <span style={{
          display: 'inline-block', width: 14, fontSize: 10, color: '#6b7280',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s', marginRight: 6,
        }}>▶</span>
        {title}
      </button>
      {open && (
        <div style={{ padding: '4px 10px 10px 10px', background: '#fafafa' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// Small grid-style palette item button
function PaletteItem({ label, symbol, onClick, active, title: tip }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={tip || label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 2,
        width: 52, height: 44, borderRadius: 5,
        border: active ? '1.5px solid #2563eb' : '1px solid #e5e7eb',
        background: active ? '#eff6ff' : hover ? '#f3f4f6' : 'white',
        cursor: 'pointer', padding: '3px 2px',
        transition: 'all 0.1s',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, color: active ? '#2563eb' : '#1f2937' }}>
        {symbol}
      </span>
      <span style={{ fontSize: 9, color: '#6b7280', lineHeight: 1, textAlign: 'center' }}>
        {label}
      </span>
    </button>
  )
}

function PaletteGrid({ children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {children}
    </div>
  )
}

// Wider list-style item (for dynamics, tempo markings etc.)
function ListItem({ label, symbol, sub, onClick, active }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 8px', borderRadius: 5,
        border: active ? '1.5px solid #2563eb' : '1px solid transparent',
        background: active ? '#eff6ff' : hover ? '#f3f4f6' : 'transparent',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.1s',
      }}
    >
      <span style={{ fontSize: 17, width: 22, textAlign: 'center', color: '#1f2937' }}>
        {symbol}
      </span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#1f2937' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: '#9ca3af' }}>{sub}</div>}
      </div>
    </button>
  )
}

// ── PALETTES TAB ─────────────────────────────────────────────────────────────
function PalettesTab() {
  const setGlobalKeySignature  = useScoreStore(s => s.setGlobalKeySignature)
  const setGlobalTimeSignature = useScoreStore(s => s.setGlobalTimeSignature)
  const setTempo               = useScoreStore(s => s.setTempo)
  const score                  = useScoreStore(s => s.score)
  const currentKey  = score.parts[0]?.measures[0]?.keySignature ?? 0
  const currentTime = score.parts[0]?.measures[0]?.timeSignature ?? { beats:4, beatType:4 }

  const KEY_SIGS = [
    { label: 'C maj', num: 0,  symbol: '𝄞' },
    { label: 'G maj', num: 1,  symbol: '𝄞♯' },
    { label: 'D maj', num: 2,  symbol: '𝄞♯♯' },
    { label: 'A maj', num: 3,  symbol: '𝄞3♯' },
    { label: 'E maj', num: 4,  symbol: '𝄞4♯' },
    { label: 'B maj', num: 5,  symbol: '𝄞5♯' },
    { label: 'F♯ maj',num: 6,  symbol: '𝄞6♯' },
    { label: 'F maj', num: -1, symbol: '𝄞♭' },
    { label: 'B♭ maj',num: -2, symbol: '𝄞2♭' },
    { label: 'E♭ maj',num: -3, symbol: '𝄞3♭' },
    { label: 'A♭ maj',num: -4, symbol: '𝄞4♭' },
    { label: 'D♭ maj',num: -5, symbol: '𝄞5♭' },
    { label: 'G♭ maj',num: -6, symbol: '𝄞6♭' },
  ]

  const TIME_SIGS = [
    { label: '4/4', beats:4, beatType:4, symbol: '𝄴' },
    { label: '3/4', beats:3, beatType:4, symbol: '¾' },
    { label: '2/4', beats:2, beatType:4, symbol: '½' },
    { label: '2/2', beats:2, beatType:2, symbol: '𝄵' },
    { label: '6/8', beats:6, beatType:8, symbol: '⁶⁄₈' },
    { label: '9/8', beats:9, beatType:8, symbol: '⁹⁄₈' },
    { label:'12/8',beats:12, beatType:8, symbol: '¹²⁄₈' },
    { label: '5/4', beats:5, beatType:4, symbol: '⁵⁄₄' },
    { label: '7/8', beats:7, beatType:8, symbol: '⁷⁄₈' },
  ]

  const CLEFS = [
    { label: 'Treble', symbol: '𝄞', clef: 'treble' },
    { label: 'Bass',   symbol: '𝄢', clef: 'bass'   },
    { label: 'Alto',   symbol: '𝄡', clef: 'alto'   },
    { label: 'Tenor',  symbol: '𝄡', clef: 'tenor'  },
  ]

  const BARLINES = [
    { label: 'Normal',   symbol: '|'  },
    { label: 'Double',   symbol: '‖'  },
    { label: 'Final',    symbol: '𝄂'  },
    { label: 'Repeat →', symbol: '|:' },
    { label: 'Repeat ←', symbol: ':|' },
    { label: '↔ Repeat', symbol: ':|:'},
  ]

  const ACCIDENTALS = [
    { label: 'Sharp',     symbol: '♯', acc: '#'  },
    { label: 'Flat',      symbol: '♭', acc: 'b'  },
    { label: 'Natural',   symbol: '♮', acc: null },
    { label: 'Dbl Sharp', symbol: '𝄪', acc: '##' },
    { label: 'Dbl Flat',  symbol: '𝄫', acc: 'bb' },
  ]

  const DYNAMICS = [
    { label: 'ppp',  symbol: 'ppp',  sub: 'pianissississimo' },
    { label: 'pp',   symbol: 'pp',   sub: 'pianissimo' },
    { label: 'p',    symbol: 'p',    sub: 'piano' },
    { label: 'mp',   symbol: 'mp',   sub: 'mezzo-piano' },
    { label: 'mf',   symbol: 'mf',   sub: 'mezzo-forte' },
    { label: 'f',    symbol: 'f',    sub: 'forte' },
    { label: 'ff',   symbol: 'ff',   sub: 'fortissimo' },
    { label: 'fff',  symbol: 'fff',  sub: 'fortississimo' },
    { label: 'sfz',  symbol: 'sfz',  sub: 'sforzando' },
    { label: 'fp',   symbol: 'fp',   sub: 'forte-piano' },
  ]

  const ARTICULATIONS = [
    { label: 'Staccato',  symbol: '·'  },
    { label: 'Tenuto',    symbol: '—'  },
    { label: 'Accent',    symbol: '>'  },
    { label: 'Marcato',   symbol: '^'  },
    { label: 'Fermata',   symbol: '𝄐'  },
    { label: 'Trill',     symbol: 'tr' },
    { label: 'Mordent',   symbol: '𝆁'  },
    { label: 'Turn',      symbol: '𝆃'  },
  ]

  const TEMPO_MARKS = [
    { label: 'Larghissimo', symbol: '♩', sub: '≤24 bpm'  },
    { label: 'Grave',       symbol: '♩', sub: '25–45'    },
    { label: 'Largo',       symbol: '♩', sub: '40–60'    },
    { label: 'Larghetto',   symbol: '♩', sub: '60–66'    },
    { label: 'Adagio',      symbol: '♩', sub: '66–76'    },
    { label: 'Andante',     symbol: '♩', sub: '76–108'   },
    { label: 'Moderato',    symbol: '♩', sub: '108–120'  },
    { label: 'Allegretto',  symbol: '♩', sub: '112–120'  },
    { label: 'Allegro',     symbol: '♩', sub: '120–156'  },
    { label: 'Vivace',      symbol: '♩', sub: '156–176'  },
    { label: 'Presto',      symbol: '♩', sub: '168–200'  },
    { label: 'Prestissimo', symbol: '♩', sub: '200+'     },
  ]

  const TEMPO_BPM = { Larghissimo:20, Grave:35, Largo:50, Larghetto:63, Adagio:70,
    Andante:92, Moderato:114, Allegretto:116, Allegro:138, Vivace:166, Presto:184, Prestissimo:208 }

  const REPEATS = [
    { label: 'Segno',    symbol: '𝄋' },
    { label: 'Coda',     symbol: '𝄌' },
    { label: 'D.S.',     symbol: '𝄋.' },
    { label: 'D.C.',     symbol: 'D.C.' },
    { label: 'Fine',     symbol: 'Fine' },
    { label: 'D.C. al Fine', symbol: 'D.C.F' },
    { label: '1st ending',   symbol: '1.' },
    { label: '2nd ending',   symbol: '2.' },
  ]

  const TEXT_TYPES = [
    { label: 'Title',       symbol: 'T',   sub: 'Score title' },
    { label: 'Subtitle',    symbol: 'St',  sub: 'Subtitle' },
    { label: 'Composer',    symbol: 'C',   sub: 'Composer' },
    { label: 'Lyricist',    symbol: 'L',   sub: 'Lyricist' },
    { label: 'Rehearsal',   symbol: 'A',   sub: 'Rehearsal mark' },
    { label: 'Staff text',  symbol: 'T',   sub: 'Above staff' },
    { label: 'Chord sym.',  symbol: 'Am',  sub: 'Chord symbol' },
    { label: 'Fingering',   symbol: '1',   sub: 'Fingering' },
  ]

  // store the selected accidental for applying to selected note
  const changeSelectedPitch = useScoreStore(s => s.shiftPitchHalfStep)
  const selectedNoteId      = useScoreStore(s => s.selectedNoteId)
  const selectedPartId      = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex= useScoreStore(s => s.selectedMeasureIndex)
  const score2              = useScoreStore(s => s.score)

  function applyAccidental(acc) {
    if (!selectedNoteId) return
    const part    = score2.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    const note    = measure?.notes.find(n => n.id === selectedNoteId)
    if (!note?.pitch) return
    useScoreStore.getState()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
      notes.map(n => n.id === selectedNoteId
        ? { ...n, pitch: { ...n.pitch, accidental: acc } }
        : n
      )
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <Section title="Clefs">
        <PaletteGrid>
          {CLEFS.map(cl => (
            <PaletteItem key={cl.clef} label={cl.label} symbol={cl.symbol}
              title={`${cl.label} clef`} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Key Signatures" defaultOpen>
        <PaletteGrid>
          {KEY_SIGS.map(k => (
            <PaletteItem key={k.num} label={k.label} symbol={k.num === 0 ? '○' : k.num > 0 ? `${k.num}♯` : `${Math.abs(k.num)}♭`}
              active={currentKey === k.num}
              onClick={() => setGlobalKeySignature(k.num)}
              title={k.label} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Time Signatures" defaultOpen>
        <PaletteGrid>
          {TIME_SIGS.map(t => (
            <PaletteItem key={t.label} label={t.label} symbol={t.symbol}
              active={currentTime.beats === t.beats && currentTime.beatType === t.beatType}
              onClick={() => setGlobalTimeSignature(t.beats, t.beatType)}
              title={`${t.label} time`} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Tempo">
        {TEMPO_MARKS.map(t => (
          <ListItem key={t.label} label={t.label} symbol="♩" sub={t.sub}
            onClick={() => setTempo(TEMPO_BPM[t.label] || 120)} />
        ))}
      </Section>

      <Section title="Accidentals">
        <PaletteGrid>
          {ACCIDENTALS.map(a => (
            <PaletteItem key={a.label} label={a.label} symbol={a.symbol}
              onClick={() => applyAccidental(a.acc)}
              title={`Apply ${a.label} to selected note`} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Dynamics">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {DYNAMICS.map(d => (
            <button key={d.label} title={d.sub} style={{
              padding: '4px 8px', borderRadius: 4, border: '1px solid #e5e7eb',
              background: 'white', cursor: 'pointer', fontSize: 12,
              fontStyle: 'italic', fontFamily: 'Times New Roman, serif',
              fontWeight: 700,
            }}
              onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background='white'}
            >{d.symbol}</button>
          ))}
        </div>
      </Section>

      <Section title="Articulations">
        <PaletteGrid>
          {ARTICULATIONS.map(a => (
            <PaletteItem key={a.label} label={a.label} symbol={a.symbol} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Text">
        {TEXT_TYPES.map(t => (
          <ListItem key={t.label} label={t.label} symbol={t.symbol} sub={t.sub} />
        ))}
      </Section>

      <Section title="Repeats & Jumps">
        <PaletteGrid>
          {REPEATS.map(r => (
            <PaletteItem key={r.label} label={r.label} symbol={r.symbol} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Barlines">
        <PaletteGrid>
          {BARLINES.map(b => (
            <PaletteItem key={b.label} label={b.label} symbol={b.symbol} />
          ))}
        </PaletteGrid>
      </Section>

      <Section title="Brackets">
        <PaletteGrid>
          <PaletteItem label="Bracket"  symbol="[" />
          <PaletteItem label="Brace"    symbol="{" />
          <PaletteItem label="Line"     symbol="|" />
          <PaletteItem label="Sq. Brace" symbol="⟦" />
        </PaletteGrid>
      </Section>
    </div>
  )
}

// ── LAYOUT TAB ────────────────────────────────────────────────────────────────
function LayoutTab() {
  const score        = useScoreStore(s => s.score)
  const setTempo     = useScoreStore(s => s.setTempo)
  const [spacing, setSpacing] = useState(1.2)
  const [staffSize, setStaffSize] = useState(7)
  const [margins, setMargins]  = useState({ top:10, bottom:10, left:12, right:12 })

  function Row({ label, children }) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'5px 0', borderBottom:'1px solid #f3f4f6', fontSize:11 }}>
        <span style={{ color:'#6b7280', flex:1 }}>{label}</span>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>{children}</div>
      </div>
    )
  }

  function NumInput({ value, onChange, min, max, step=1, unit }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:2 }}>
        <button onClick={() => onChange(Math.max(min, value-step))}
          style={{ width:20, height:20, border:'1px solid #d1d5db', borderRadius:3,
            background:'white', cursor:'pointer', fontSize:12, display:'flex',
            alignItems:'center', justifyContent:'center' }}>−</button>
        <span style={{ width:30, textAlign:'center', fontSize:11, fontWeight:600 }}>
          {value}{unit}
        </span>
        <button onClick={() => onChange(Math.min(max, value+step))}
          style={{ width:20, height:20, border:'1px solid #d1d5db', borderRadius:3,
            background:'white', cursor:'pointer', fontSize:12, display:'flex',
            alignItems:'center', justifyContent:'center' }}>+</button>
      </div>
    )
  }

  return (
    <div style={{ overflowY:'auto', flex:1, padding:'8px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8, marginTop:4 }}>
        Page Layout
      </div>

      <Row label="Staff size">
        <NumInput value={staffSize} onChange={setStaffSize} min={4} max={12} step={0.5} unit="sp" />
      </Row>
      <Row label="Note spacing">
        <NumInput value={spacing} onChange={setSpacing} min={0.8} max={2.5} step={0.1} />
      </Row>

      <div style={{ fontSize:11, fontWeight:700, color:'#374151', margin:'12px 0 6px' }}>
        Margins (mm)
      </div>
      <Row label="Top">
        <NumInput value={margins.top} onChange={v=>setMargins(m=>({...m,top:v}))} min={0} max={50} />
      </Row>
      <Row label="Bottom">
        <NumInput value={margins.bottom} onChange={v=>setMargins(m=>({...m,bottom:v}))} min={0} max={50} />
      </Row>
      <Row label="Left">
        <NumInput value={margins.left} onChange={v=>setMargins(m=>({...m,left:v}))} min={0} max={50} />
      </Row>
      <Row label="Right">
        <NumInput value={margins.right} onChange={v=>setMargins(m=>({...m,right:v}))} min={0} max={50} />
      </Row>

      <div style={{ fontSize:11, fontWeight:700, color:'#374151', margin:'12px 0 6px' }}>
        Score Settings
      </div>
      <Row label="Tempo (BPM)">
        <NumInput value={score.tempo||120} onChange={setTempo} min={20} max={300} step={5} />
      </Row>
      <Row label="Measures/line">
        <NumInput value={4} onChange={()=>{}} min={1} max={8} />
      </Row>
    </div>
  )
}

// ── PROPERTIES TAB ────────────────────────────────────────────────────────────
function PropertiesTab() {
  const selectedNoteId       = useScoreStore(s => s.selectedNoteId)
  const selectedPartId       = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex = useScoreStore(s => s.selectedMeasureIndex)
  const score                = useScoreStore(s => s.score)
  const changeSelectedDuration = useScoreStore(s => s.changeSelectedDuration)
  const shiftPitchHalfStep   = useScoreStore(s => s.shiftPitchHalfStep)
  const shiftPitchOctave     = useScoreStore(s => s.shiftPitchOctave)

  const part    = score.parts.find(p => p.id === selectedPartId)
  const measure = part?.measures[selectedMeasureIndex]
  const note    = measure?.notes.find(n => n.id === selectedNoteId)
  const selPart = score.parts.find(p => p.id === selectedPartId)

  function PropRow({ label, children }) {
    return (
      <div style={{ display:'flex', alignItems:'center', padding:'4px 0',
        borderBottom:'1px solid #f3f4f6', fontSize:11, gap:6 }}>
        <span style={{ color:'#6b7280', width:80, flexShrink:0 }}>{label}</span>
        <div style={{ flex:1, display:'flex', alignItems:'center', gap:4 }}>{children}</div>
      </div>
    )
  }

  function Tag({ children, color='#f3f4f6', text='#374151' }) {
    return (
      <span style={{ padding:'2px 7px', borderRadius:3, background:color,
        color:text, fontSize:11, fontWeight:600 }}>
        {children}
      </span>
    )
  }

  if (!selectedNoteId && selectedMeasureIndex === null) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', color:'#9ca3af',
        fontSize:12, padding:20, textAlign:'center', gap:8 }}>
        <span style={{ fontSize:32 }}>𝄽</span>
        <span>Select a note or measure<br/>to see its properties</span>
      </div>
    )
  }

  if (selectedMeasureIndex !== null && !selectedNoteId) {
    const m = selPart?.measures[selectedMeasureIndex]
    const noteCount = m?.notes.filter(n => !n.isRest).length ?? 0
    return (
      <div style={{ overflowY:'auto', flex:1, padding:'8px 12px' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8 }}>
          Measure {selectedMeasureIndex + 1}
        </div>
        <PropRow label="Part"><Tag>{selPart?.name || '—'}</Tag></PropRow>
        <PropRow label="Time sig">
          <Tag>{m?.timeSignature.beats}/{m?.timeSignature.beatType}</Tag>
        </PropRow>
        <PropRow label="Key sig">
          <Tag>{m?.keySignature ?? 0} {(m?.keySignature ?? 0) > 0 ? '♯' : (m?.keySignature ?? 0) < 0 ? '♭' : '(C)'}</Tag>
        </PropRow>
        <PropRow label="Notes"><Tag>{noteCount}</Tag></PropRow>
        <PropRow label="Rests"><Tag>{(m?.notes.length ?? 0) - noteCount}</Tag></PropRow>
      </div>
    )
  }

  if (!note) return null

  const DURATIONS = [
    {val:'w',label:'Whole',sym:'𝅝'},
    {val:'h',label:'Half',sym:'𝅗𝅥'},
    {val:'q',label:'Quarter',sym:'♩'},
    {val:'8',label:'8th',sym:'♪'},
    {val:'16',label:'16th',sym:'𝅘𝅥𝅰'},
    {val:'32',label:'32nd',sym:'𝅘𝅥𝅱'},
  ]

  const chordNotes = measure?.notes.filter(n => n.chordWith === selectedNoteId) || []

  return (
    <div style={{ overflowY:'auto', flex:1, padding:'8px 12px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10,
        padding:'6px 8px', borderRadius:6,
        background: note.isRest ? '#eff6ff' : '#fff7ed',
        border: `1.5px solid ${note.isRest ? '#bfdbfe' : '#fed7aa'}` }}>
        <span style={{ fontSize:22 }}>{note.isRest ? '𝄽' : '♩'}</span>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color: note.isRest ? '#1d4ed8':'#c2410c' }}>
            {note.isRest
              ? `${note.duration}${note.dots?'.':''} Rest`
              : `${note.pitch?.step}${note.pitch?.accidental??''}${note.pitch?.octave}`
            }
          </div>
          <div style={{ fontSize:10, color:'#6b7280' }}>
            {selPart?.name} · Bar {(selectedMeasureIndex ?? 0) + 1}
          </div>
        </div>
      </div>

      {!note.isRest && note.pitch && (
        <>
          <PropRow label="Pitch">
            <Tag color='#fff7ed' text='#c2410c'>
              {note.pitch.step}{note.pitch.accidental ?? ''}{note.pitch.octave}
            </Tag>
            <div style={{ display:'flex', gap:2 }}>
              <button onClick={() => shiftPitchHalfStep(1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:12 }}>↑</button>
              <button onClick={() => shiftPitchHalfStep(-1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:12 }}>↓</button>
            </div>
          </PropRow>
          <PropRow label="Octave">
            <Tag>{note.pitch.octave}</Tag>
            <div style={{ display:'flex', gap:2 }}>
              <button onClick={() => shiftPitchOctave(1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:10 }}>8↑</button>
              <button onClick={() => shiftPitchOctave(-1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:10 }}>8↓</button>
            </div>
          </PropRow>
          <PropRow label="Accidental">
            <div style={{ display:'flex', gap:3 }}>
              {[{sym:'♯',acc:'#'},{sym:'♭',acc:'b'},{sym:'♮',acc:null}].map(a => (
                <button key={a.sym}
                  onClick={() => useScoreStore.getState()._applyToMeasure(
                    selectedPartId, selectedMeasureIndex, notes =>
                      notes.map(n => n.id === selectedNoteId
                        ? {...n, pitch:{...n.pitch, accidental: a.acc}} : n)
                  )}
                  style={{ width:26, height:26, border:'1px solid #d1d5db', borderRadius:4,
                    background: (note.pitch?.accidental??null)===a.acc ? '#eff6ff':'white',
                    cursor:'pointer', fontSize:14, fontWeight:700 }}>{a.sym}</button>
              ))}
            </div>
          </PropRow>
          {chordNotes.length > 0 && (
            <PropRow label="Chord">
              <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                {chordNotes.map(cn => (
                  <Tag key={cn.id} color='#f5f3ff' text='#7c3aed'>
                    {cn.pitch?.step}{cn.pitch?.accidental??''}{cn.pitch?.octave}
                  </Tag>
                ))}
              </div>
            </PropRow>
          )}
        </>
      )}

      <PropRow label="Duration">
        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
          {DURATIONS.map(d => (
            <button key={d.val}
              onClick={() => changeSelectedDuration(d.val, note.dots||0)}
              title={d.label}
              style={{ width:26, height:26, border:'1px solid #d1d5db', borderRadius:4,
                background: note.duration===d.val ? '#eff6ff':'white',
                cursor:'pointer', fontSize:14,
                outline: note.duration===d.val ? '1.5px solid #2563eb':'none' }}>{d.sym}</button>
          ))}
        </div>
      </PropRow>
      <PropRow label="Dotted">
        <button
          onClick={() => changeSelectedDuration(note.duration, note.dots ? 0 : 1)}
          style={{ padding:'2px 10px', borderRadius:4, border:'1px solid #d1d5db',
            background: note.dots ? '#eff6ff':'white', cursor:'pointer',
            fontSize:13, fontWeight:700 }}>
          {note.dots ? '· On' : '· Off'}
        </button>
      </PropRow>
      <PropRow label="Voice">
        <div style={{ display:'flex', gap:3 }}>
          {[1,2,3,4].map(v => (
            <button key={v} style={{ width:24, height:24, borderRadius:4,
              border:'1px solid #d1d5db',
              background: v===1 ? '#dbeafe':'white',
              color: v===1 ? '#1d4ed8':'#6b7280',
              cursor:'pointer', fontSize:11, fontWeight:700 }}>{v}</button>
          ))}
        </div>
      </PropRow>
    </div>
  )
}

// ── MAIN SIDEBAR COMPONENT ────────────────────────────────────────────────────
export default function Sidebar() {
  const [activeTab, setActiveTab] = useState('palettes')
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch]       = useState('')

  const TABS = [
    { id: 'palettes',   label: 'Palettes'   },
    { id: 'layout',     label: 'Layout'     },
    { id: 'properties', label: 'Properties' },
  ]

  if (collapsed) {
    return (
      <div style={{
        width: 28, background: '#f9fafb', borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 8, flexShrink: 0,
      }}>
        <button onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:4,
            background:'white', cursor:'pointer', fontSize:12, display:'flex',
            alignItems:'center', justifyContent:'center', color:'#6b7280' }}>
          ›
        </button>
      </div>
    )
  }

  return (
    <div style={{
      width: 220, flexShrink: 0, background: '#f9fafb',
      borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #e5e7eb',
        background: 'white', flexShrink: 0,
      }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '7px 2px', fontSize: 11, fontWeight: 600,
              border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === tab.id ? '#2563eb' : '#6b7280',
              transition: 'color 0.15s',
            }}
          >{tab.label}</button>
        ))}
        {/* Collapse button */}
        <button onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          style={{ width:28, border:'none', background:'none', cursor:'pointer',
            color:'#9ca3af', fontSize:14, flexShrink:0 }}>‹</button>
      </div>

      {/* Search bar (Palettes tab only) */}
      {activeTab === 'palettes' && (
        <div style={{ padding:'6px 8px', background:'white',
          borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4,
            background:'#f3f4f6', borderRadius:6, padding:'4px 8px',
            border:'1px solid #e5e7eb' }}>
            <span style={{ color:'#9ca3af', fontSize:12 }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search palettes…"
              style={{ background:'none', border:'none', outline:'none',
                fontSize:11, color:'#374151', width:'100%' }}
            />
          </div>
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {activeTab === 'palettes'   && <PalettesTab />}
        {activeTab === 'layout'     && <LayoutTab />}
        {activeTab === 'properties' && <PropertiesTab />}
      </div>
    </div>
  )
}