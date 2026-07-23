// src/components/SolfaSidebar/index.jsx
// FaithScore — Solfa Sidebar (Palettes / Parts / Layout / Properties)
//
// Mirrors the staff Sidebar's layout contract:
//   • Lives in a normal flex row, NOT position:fixed.
//   • Fills the full height of its flex-row parent (parent must be overflow:hidden).
//   • Its own content area scrolls internally.

import { useState } from 'react'
import { useSolfaStore, VOICE_COMBOS, migrateMeasure } from '../../store/solfaStore'

const TABS = [
  { id:'palettes',   label:'Palettes'   },
  { id:'parts',      label:'Parts'      },
  { id:'lyrics',     label:'Lyrics'     },
  { id:'markers',    label:'Markers'    },
  { id:'layout',     label:'Layout'     },
  { id:'properties', label:'Properties' },
]

const KEYS = ['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F']
const TIME_SIGS = [
  { label:'2/4', beats:2, beatType:4 }, { label:'3/4', beats:3, beatType:4 },
  { label:'4/4', beats:4, beatType:4 }, { label:'5/4', beats:5, beatType:4 },
  { label:'6/4', beats:6, beatType:4 }, { label:'7/4', beats:7, beatType:4 },
  { label:'3/8', beats:3, beatType:8 }, { label:'5/8', beats:5, beatType:8 },
  { label:'6/8', beats:6, beatType:8 }, { label:'7/8', beats:7, beatType:8 },
  { label:'9/8', beats:9, beatType:8 }, { label:'12/8',beats:12,beatType:8 },
]
const TEMPO_MARKS = ['Largo','Lento','Adagio','Andante','Moderato','Allegretto','Allegro','Vivace','Presto','rit.','a tempo']
const DYNAMICS = ['ppp','pp','p','mp','mf','f','ff','fff','sfz']
const EXPRESSION = ['D.C.','D.S.','Fine','Coda','rall.']

// ── Palette item ─────────────────────────────────────────────────────────────
function PaletteItem({ label, onClick, symbol, disabled, active }) {
  return (
    <button onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? 'Select a beat first' : label}
      style={{
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', gap:2,
        width:56, height:52, border: active ? '1px solid #2563eb' : '1px solid #e5e7eb',
        borderRadius:6, background: active ? '#eff6ff' : (disabled ? '#f9fafb' : 'white'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize:11, color: disabled ? '#c3c9d4' : '#374151', transition:'all 0.12s',
        padding:'4px 2px', textAlign:'center', lineHeight:1.2,
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseEnter={e => { if (disabled) return; e.currentTarget.style.background='#eff6ff'; e.currentTarget.style.borderColor='#93c5fd' }}
      onMouseLeave={e => { if (disabled) return; e.currentTarget.style.background = active ? '#eff6ff' : 'white'; e.currentTarget.style.borderColor = active ? '#2563eb' : '#e5e7eb' }}
    >
      <span style={{ fontSize:14, lineHeight:1 }}>{symbol}</span>
      <span style={{ fontSize:9.5, color: disabled ? '#c3c9d4' : '#6b7280', marginTop:1 }}>{label}</span>
    </button>
  )
}

// ── Palette section (collapsible) ────────────────────────────────────────────
function PaletteSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom:'1px solid #f0f0f0' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'7px 12px', border:'none', background:'none',
          cursor:'pointer', fontSize:11.5, fontWeight:700, color:'#1e2433',
          textAlign:'left', letterSpacing:'0.01em',
        }}
        onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background='none'}
      >
        <span>{title}</span>
        <span style={{ fontSize:10, color:'#9ca3af', transition:'transform 0.15s',
          transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>
      {open && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:'4px 10px 10px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Palettes tab ─────────────────────────────────────────────────────────────
// Key & time signature apply globally. Tempo / dynamics / text marks attach to
// whatever beat is currently selected on the score (click a beat first).
function PalettesTab({ search }) {
  const score              = useSolfaStore(s => s.score)
  const selectedPartId     = useSolfaStore(s => s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)
  const selectedBeatIdx    = useSolfaStore(s => s.selectedBeatIdx)
  const setKey              = useSolfaStore(s => s.setKey)
  const setTempo             = useSolfaStore(s => s.setTempo)
  const changeTimeSig        = useSolfaStore(s => s.changeTimeSig)
  const addMark               = useSolfaStore(s => s.addMark)

  const hasSelection = selectedPartId !== null && selectedMeasureIdx !== null && selectedBeatIdx !== null
  const currentTS = `${score.timeSignature?.beats || 4}/${score.timeSignature?.beatType || 4}`

  const handleTempoMark = (label) => hasSelection && addMark(selectedPartId, selectedMeasureIdx, selectedBeatIdx, label, 'tempo')
  const handleDynamic   = (label) => hasSelection && addMark(selectedPartId, selectedMeasureIdx, selectedBeatIdx, label, 'dynamic')
  const handleExpr      = (label) => hasSelection && addMark(selectedPartId, selectedMeasureIdx, selectedBeatIdx, label, 'text')

  const allPalettes = [
    {
      title:'Key Signature', items: KEYS.map(k => ({
        symbol:'♩', label:k, active: (score.key||'C')===k, onClick:()=>setKey(k),
      })),
    },
    {
      title:'Time Signature', items: TIME_SIGS.map(t => ({
        symbol:t.label, label:t.label, active: currentTS===t.label,
        onClick:()=>changeTimeSig(t.beats, t.beatType),
      })),
    },
    {
      title:'Tempo', items: TEMPO_MARKS.map(t => ({
        symbol:'♩=', label:t, disabled:!hasSelection, onClick:()=>handleTempoMark(t),
      })),
    },
    {
      title:'Dynamics', items: DYNAMICS.map(d => ({
        symbol:'𝆑', label:d, disabled:!hasSelection, onClick:()=>handleDynamic(d),
      })),
    },
    {
      title:'Text', items: EXPRESSION.map(t => ({
        symbol:'𝄐', label:t, disabled:!hasSelection, onClick:()=>handleExpr(t),
      })),
    },
  ]

  const filtered = search.trim()
    ? allPalettes.map(p => ({
        ...p,
        items: p.items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
      })).filter(p => p.items.length > 0)
    : allPalettes

  return (
    <div>
      {/* Playback tempo — always available, applies to the whole score */}
      <div style={{ padding:'10px 12px', borderBottom:'1px solid #f0f0f0' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6,
          textTransform:'uppercase', letterSpacing:'0.05em' }}>Playback Tempo</div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, color:'#6b7280' }}>♩ =</span>
          <input type="number" min={20} max={300} value={score.tempo || 80}
            onChange={e => { const v = Number(e.target.value); if (v>=20 && v<=300) setTempo(v) }}
            style={{ width:56, fontSize:12, border:'1px solid #d1d5db', borderRadius:5,
              padding:'3px 6px', textAlign:'center', color:'#374151' }}
          />
        </div>
      </div>

      {/* Status hint — tells the user what their click will target */}
      <div style={{
        padding:'8px 12px', fontSize:11, lineHeight:1.4,
        background: hasSelection ? '#eff6ff' : '#fff7ed',
        color: hasSelection ? '#1d4ed8' : '#9a5b13',
        borderBottom:'1px solid #f0f0f0',
      }}>
        {!hasSelection && 'Select a beat on the score to place tempo / dynamics / text marks.'}
        {hasSelection && `Applying to bar ${selectedMeasureIdx+1}, beat ${selectedBeatIdx+1}.`}
      </div>
      {filtered.map((p, i) => (
        <PaletteSection key={p.title} title={p.title} defaultOpen={i < 2}>
          {p.items.map(item => (
            <PaletteItem key={item.label} {...item} />
          ))}
        </PaletteSection>
      ))}
    </div>
  )
}

// ── Parts tab ────────────────────────────────────────────────────────────────
function PartsTab() {
  const score          = useSolfaStore(s => s.score)
  const selectedPartId = useSolfaStore(s => s.selectedPartId)
  const setActivePart  = useSolfaStore(s => s.setActivePart)
  const comboInfo = VOICE_COMBOS[score.voiceCombo] || VOICE_COMBOS.satb

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:2, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Voice Parts
      </div>
      <div style={{ fontSize:10.5, color:'#9ca3af', marginBottom:8 }}>{comboInfo.label} arrangement</div>
      {(score.parts||[]).map((p) => (
        <div key={p.id}
          onClick={() => setActivePart(p.id)}
          style={{
            display:'flex', alignItems:'center', gap:6, padding:'6px 8px',
            marginBottom:3, borderRadius:6, cursor:'pointer',
            background: selectedPartId === p.id ? '#eff6ff' : 'white',
            border: `1px solid ${selectedPartId === p.id ? '#93c5fd' : '#e5e7eb'}`,
            transition:'all 0.1s',
          }}
        >
          <span style={{
            width:22, height:22, borderRadius:5, background:'#f3f4f6',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:11, fontWeight:700, color:'#1e3a8a', flexShrink:0,
          }}>
            {p.label}
          </span>
          <span style={{ flex:1, fontSize:12.5, fontWeight:500, color:'#1e2433' }}>
            {p.name}
          </span>
        </div>
      ))}
      <div style={{ marginTop:10, fontSize:11, color:'#9ca3af', lineHeight:1.5 }}>
        Voice arrangement is set when the score is created. Click a part above to make it active for note entry.
      </div>
    </div>
  )
}

// ── Layout tab ───────────────────────────────────────────────────────────────
function LayoutTab({ zoom, setZoom }) {
  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Layout Options
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:11.5, color:'#374151', marginBottom:4, fontWeight:600 }}>Zoom</div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={() => setZoom(Math.max(0.5, +(zoom - 0.1).toFixed(2)))}
            style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
              background:'white', cursor:'pointer', fontSize:14, lineHeight:1 }}>−</button>
          <span style={{ flex:1, textAlign:'center', fontSize:12, fontWeight:600, color:'#1e2433' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(Math.min(2, +(zoom + 0.1).toFixed(2)))}
            style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
              background:'white', cursor:'pointer', fontSize:14, lineHeight:1 }}>+</button>
        </div>
        <input type="range" min={50} max={200} value={Math.round(zoom*100)}
          onChange={e => setZoom(Number(e.target.value)/100)}
          style={{ width:'100%', marginTop:6, accentColor:'#2563eb' }}
        />
      </div>
      <div style={{ fontSize:11, color:'#9ca3af', lineHeight:1.5 }}>
        More layout options (margins, system spacing, page size) coming soon.
      </div>
    </div>
  )
}

// ── Properties tab ───────────────────────────────────────────────────────────
function PropertiesTab() {
  const score              = useSolfaStore(s => s.score)
  const selectedPartId     = useSolfaStore(s => s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)
  const selectedBeatIdx    = useSolfaStore(s => s.selectedBeatIdx)
  const selectedEventIdx   = useSolfaStore(s => s.selectedEventIdx)

  const liveEvent = (() => {
    if (selectedPartId===null || selectedMeasureIdx===null || selectedBeatIdx===null || selectedEventIdx===null) return null
    const part = score.parts.find(p => p.id === selectedPartId)
    const beat = migrateMeasure(part?.measures[selectedMeasureIdx])?.beats[selectedBeatIdx]
    return beat?.events?.[selectedEventIdx] || null
  })()

  if (!liveEvent) {
    return (
      <div style={{ padding:'20px 16px', textAlign:'center' }}>
        <div style={{ fontSize:24, marginBottom:8, color:'#d1d5db' }}>d r m</div>
        <div style={{ fontSize:12, color:'#9ca3af', lineHeight:1.5 }}>
          Select a note to see<br/>its properties here
        </div>
      </div>
    )
  }

  const durLabel = { 4:'Whole beat', 3:'¾ beat', 2:'Half beat', 1:'Quarter beat' }[liveEvent.duration] || liveEvent.duration

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10,
        textTransform:'uppercase', letterSpacing:'0.05em' }}>Note Properties</div>
      <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#6b7280' }}>Type</span>
          <span style={{ fontWeight:600 }}>
            {liveEvent.type==='note' ? 'Note' : liveEvent.type==='sustain' ? 'Sustain' : 'Rest'}
          </span>
        </div>
        {liveEvent.type==='note' && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#6b7280' }}>Syllable</span>
            <span style={{ fontWeight:600 }}>{liveEvent.syllable}</span>
          </div>
        )}
        {liveEvent.type==='note' && liveEvent.octave !== 0 && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#6b7280' }}>Octave</span>
            <span style={{ fontWeight:600 }}>{liveEvent.octave > 0 ? `+${liveEvent.octave}` : liveEvent.octave}</span>
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#6b7280' }}>Duration</span>
          <span style={{ fontWeight:600 }}>{durLabel}</span>
        </div>
        {liveEvent.lyric && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#6b7280' }}>Lyric</span>
            <span style={{ fontWeight:600 }}>{liveEvent.lyric}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Lyrics tab ───────────────────────────────────────────────────────────────
const LYRIC_LAYOUTS = [
  { id:'inline',                    label:'Inline',                 hint:'Every syllable sits under its own note.' },
  { id:'verse1-inline-rest-below',  label:'Verse 1 inline, rest below', hint:'Verse 1 synced to notes; verses 2+ printed as text after the score.' },
  { id:'below-score-only',         label:'Below score only',       hint:'No inline sync — all verses printed as text under the score.' },
  { id:'between-alto-tenor',       label:'Between Alto & Tenor',   hint:'One shared lyric line, positioned under the Alto part.' },
  { id:'per-voice',                label:'Per voice',              hint:'Each voice keeps its own independent lyric line (rounds/canons).' },
  { id:'instrumental',             label:'Instrumental',           hint:'No lyrics anywhere in the score.' },
]

function LyricsTab() {
  const score              = useSolfaStore(s => s.score)
  const setLyricLayout      = useSolfaStore(s => s.setLyricLayout)
  const setLyricDuplication = useSolfaStore(s => s.setLyricDuplication)
  const addVerse             = useSolfaStore(s => s.addVerse)
  const updateVerse           = useSolfaStore(s => s.updateVerse)
  const removeVerse            = useSolfaStore(s => s.removeVerse)
  const toggleInstrumentalMeasure = useSolfaStore(s => s.toggleInstrumentalMeasure)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)

  const layout = score.lyricLayout || 'inline'
  const duplication = score.lyricDuplication || 'per-voice-copy'
  const verses = score.verses || []
  const showDuplicationToggle = layout === 'inline' || layout === 'verse1-inline-rest-below'
  const isInstrumental = selectedMeasureIdx !== null && (score.instrumentalMeasures||[]).includes(selectedMeasureIdx)

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Layout
      </div>
      <select value={layout} onChange={e => setLyricLayout(e.target.value)}
        style={{ width:'100%', fontSize:12, border:'1px solid #d1d5db', borderRadius:6,
          padding:'6px 8px', color:'#1e2433', marginBottom:6 }}>
        {LYRIC_LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <div style={{ fontSize:10.5, color:'#9ca3af', lineHeight:1.4, marginBottom:12 }}>
        {LYRIC_LAYOUTS.find(l => l.id===layout)?.hint}
      </div>

      {showDuplicationToggle && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11.5, fontWeight:600, color:'#374151', marginBottom:5 }}>Duplication</div>
          <div style={{ display:'flex', gap:6 }}>
            {[
              { id:'shared', label:'Shared line' },
              { id:'per-voice-copy', label:'Per-voice copy' },
            ].map(opt => (
              <button key={opt.id} onClick={() => setLyricDuplication(opt.id)}
                style={{
                  flex:1, fontSize:10.5, padding:'6px 4px', borderRadius:6,
                  border: duplication===opt.id ? '1px solid #2563eb' : '1px solid #e5e7eb',
                  background: duplication===opt.id ? '#eff6ff' : 'white',
                  color: duplication===opt.id ? '#1d4ed8' : '#6b7280',
                  cursor:'pointer', fontWeight:600,
                }}>{opt.label}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom:12, padding:'8px 10px', background:'#f9fafb',
        border:'1px solid #e5e7eb', borderRadius:6 }}>
        <div style={{ fontSize:11.5, fontWeight:600, color:'#374151', marginBottom:4 }}>
          Instrumental measure
        </div>
        <div style={{ fontSize:10.5, color:'#9ca3af', marginBottom:6, lineHeight:1.4 }}>
          {selectedMeasureIdx !== null
            ? `Bar ${selectedMeasureIdx+1} selected.`
            : 'Select a bar on the score first.'}
        </div>
        <button
          disabled={selectedMeasureIdx === null}
          onClick={() => toggleInstrumentalMeasure(selectedMeasureIdx)}
          style={{
            width:'100%', fontSize:11, fontWeight:600, padding:'6px 0', borderRadius:6,
            border: '1px solid ' + (isInstrumental ? '#dc2626' : '#e5e7eb'),
            background: isInstrumental ? '#fef2f2' : 'white',
            color: isInstrumental ? '#dc2626' : '#374151',
            cursor: selectedMeasureIdx === null ? 'not-allowed' : 'pointer',
            opacity: selectedMeasureIdx === null ? 0.55 : 1,
          }}>
          {isInstrumental ? 'Un-flag as instrumental' : 'Flag bar as instrumental'}
        </button>
      </div>

      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Verses
      </div>
      <div style={{ fontSize:10.5, color:'#9ca3af', marginBottom:8, lineHeight:1.4 }}>
        {layout === 'below-score-only'
          ? 'Type every verse here — none are synced to notes.'
          : 'Verse 1 is edited directly on the score (click under a note). Add verses 2+ here to print them as text.'}
      </div>

      {verses.map(v => (
        <div key={v.number} style={{ marginBottom:10, border:'1px solid #e5e7eb', borderRadius:6, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 6px', background:'#f9fafb' }}>
            <input value={v.label} onChange={e => updateVerse(v.number, { label: e.target.value })}
              style={{ flex:1, fontSize:11, fontWeight:600, border:'none', background:'none', color:'#1e2433', outline:'none' }}/>
            <button onClick={() => removeVerse(v.number)}
              title="Remove verse"
              style={{ border:'none', background:'none', color:'#9ca3af', cursor:'pointer', fontSize:13 }}>×</button>
          </div>
          <textarea value={v.text} onChange={e => updateVerse(v.number, { text: e.target.value })}
            placeholder="Type verse lyrics, one line per line…"
            rows={4}
            style={{ width:'100%', fontSize:11.5, border:'none', padding:'6px 8px',
              boxSizing:'border-box', resize:'vertical', outline:'none', color:'#374151',
              fontFamily:'inherit', lineHeight:1.45 }}/>
        </div>
      ))}

      <button onClick={() => addVerse()}
        style={{ width:'100%', fontSize:11.5, fontWeight:600, padding:'7px 0', borderRadius:6,
          border:'1px dashed #93c5fd', background:'#eff6ff', color:'#1d4ed8', cursor:'pointer' }}>
        + Add verse
      </button>
    </div>
  )
}

// ── Markers (navigation) tab ─────────────────────────────────────────────────
const MARKER_TYPES = [
  { id:'verse-label',        label:'Verse tag (1. / 2. / REF)', needsLabel:true, placeholder:'1.' },
  { id:'repeat-to-refrain',  label:'D.S. → Refrain',            needsLabel:false },
  { id:'fine',               label:'Fine',                      needsLabel:false },
  { id:'dc',                 label:'D.C.',                      needsLabel:false },
]

function MarkersTab() {
  const score              = useSolfaStore(s => s.score)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)
  const addNavigationMarker  = useSolfaStore(s => s.addNavigationMarker)
  const removeNavigationMarker = useSolfaStore(s => s.removeNavigationMarker)
  const [markerType, setMarkerType] = useState('verse-label')
  const [labelText,  setLabelText ] = useState('1.')

  const markers = score.navigationMarkers || []
  const typeInfo = MARKER_TYPES.find(t => t.id===markerType)

  const handleAdd = () => {
    if (selectedMeasureIdx === null) return
    const defaultLabels = { 'repeat-to-refrain':'D.S. → Refrain', fine:'Fine', dc:'D.C.' }
    const label = typeInfo.needsLabel ? (labelText || '1.') : defaultLabels[markerType]
    addNavigationMarker(markerType, selectedMeasureIdx, label)
  }

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Add Marker
      </div>
      <div style={{ fontSize:10.5, color: selectedMeasureIdx===null ? '#9a5b13' : '#1d4ed8',
        marginBottom:8, lineHeight:1.4 }}>
        {selectedMeasureIdx === null ? 'Select a bar on the score first.' : `Will attach to bar ${selectedMeasureIdx+1}.`}
      </div>
      <select value={markerType} onChange={e => setMarkerType(e.target.value)}
        style={{ width:'100%', fontSize:12, border:'1px solid #d1d5db', borderRadius:6,
          padding:'6px 8px', color:'#1e2433', marginBottom:6 }}>
        {MARKER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {typeInfo?.needsLabel && (
        <input value={labelText} onChange={e => setLabelText(e.target.value)}
          placeholder={typeInfo.placeholder}
          style={{ width:'100%', fontSize:12, border:'1px solid #d1d5db', borderRadius:6,
            padding:'6px 8px', color:'#1e2433', marginBottom:6, boxSizing:'border-box' }}/>
      )}
      <button
        disabled={selectedMeasureIdx === null}
        onClick={handleAdd}
        style={{
          width:'100%', fontSize:11.5, fontWeight:600, padding:'7px 0', borderRadius:6,
          border:'1px solid #2563eb', background: selectedMeasureIdx===null ? '#f3f4f6' : '#2563eb',
          color: selectedMeasureIdx===null ? '#9ca3af' : 'white',
          cursor: selectedMeasureIdx===null ? 'not-allowed' : 'pointer',
        }}>
        + Add marker
      </button>

      <div style={{ fontSize:11, fontWeight:700, color:'#374151', margin:'16px 0 6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>
        On this score
      </div>
      {markers.length === 0 && (
        <div style={{ fontSize:11, color:'#9ca3af' }}>No markers yet.</div>
      )}
      {markers
        .slice()
        .sort((a,b) => a.atMeasure - b.atMeasure)
        .map(mk => (
        <div key={mk.id} style={{ display:'flex', alignItems:'center', gap:6,
          padding:'5px 8px', marginBottom:4, borderRadius:6, background:'#f9fafb',
          border:'1px solid #e5e7eb' }}>
          <span style={{ fontSize:10, color:'#9ca3af', minWidth:34 }}>bar {mk.atMeasure+1}</span>
          <span style={{ flex:1, fontSize:11.5, fontWeight:600, color:'#1e2433' }}>{mk.label}</span>
          <button onClick={() => removeNavigationMarker(mk.id)}
            style={{ border:'none', background:'none', color:'#9ca3af', cursor:'pointer', fontSize:13 }}>×</button>
        </div>
      ))}
    </div>
  )
}

// ── Main SolfaSidebar component ──────────────────────────────────────────────
export default function SolfaSidebar({ collapsed, setCollapsed, zoom, setZoom }) {
  const [activeTab, setActiveTab] = useState('palettes')
  const [search,    setSearch   ] = useState('')

  if (collapsed) {
    return (
      <div style={{
        width:28, height:'100%', background:'#f9fafb',
        borderRight:'1px solid #e5e7eb',
        display:'flex', flexDirection:'column', alignItems:'center',
        paddingTop:8,
      }}>
        <button onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          style={{ border:'none', background:'none', cursor:'pointer',
            color:'#9ca3af', fontSize:14 }}>›</button>
      </div>
    )
  }

  return (
    <div style={{
      width: 240,
      height: '100%',
      background: '#f9fafb',
      borderRight: '1px solid #e5e7eb',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Tab bar — fixed at top of sidebar */}
      <div style={{
        display:'flex', borderBottom:'1px solid #e5e7eb',
        background:'white', flexShrink:0,
      }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex:1, padding:'7px 0', fontSize:8.6, fontWeight:700,
              border:'none', background:'none', cursor:'pointer',
              borderBottom: activeTab===tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab===tab.id ? '#2563eb' : '#6b7280',
              letterSpacing:'0.01em',
              transition:'color 0.12s',
            }}
          >{tab.label}</button>
        ))}
        <button onClick={() => setCollapsed(true)} title="Collapse sidebar"
          style={{ width:24, border:'none', background:'none', cursor:'pointer',
            color:'#9ca3af', fontSize:13, flexShrink:0, paddingBottom:2 }}>‹</button>
      </div>

      {/* Search bar — Palettes tab only */}
      {activeTab === 'palettes' && (
        <div style={{ padding:'6px 8px', background:'white',
          borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4,
            background:'#f3f4f6', borderRadius:6, padding:'3px 8px',
            border:'1px solid #e5e7eb' }}>
            <span style={{ color:'#9ca3af', fontSize:11 }}>🔍</span>
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

      {/* Scrollable content area */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'hidden' }}>
        {activeTab==='palettes'   && <PalettesTab   search={search} />}
        {activeTab==='parts'      && <PartsTab />}
        {activeTab==='lyrics'     && <LyricsTab />}
        {activeTab==='markers'    && <MarkersTab />}
        {activeTab==='layout'     && <LayoutTab zoom={zoom} setZoom={setZoom} />}
        {activeTab==='properties' && <PropertiesTab />}
      </div>
    </div>
  )
}
