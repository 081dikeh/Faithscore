// src/components/Sidebar/index.jsx
// FaithScore — Sidebar (Palettes / Parts / Layout / Properties)
//
// Layout contract:
//   • The sidebar lives in a normal flex row BELOW the sticky top chrome.
//   • It is NOT position:fixed — that caused it to overlap the toolbar.
//   • It uses `position: sticky; top: 0; height: 100vh - chrome` via
//     `align-self: flex-start` + overflow-y:auto on itself.
//   • The parent (App.jsx) gives it a fixed width; it fills the full
//     remaining height via the flex container being `overflow:hidden`.

import { useState } from 'react'
import { useScoreStore, measureCapacity } from '../../store/scoreStore'

const TABS = [
  { id:'palettes',   label:'Palettes'   },
  { id:'parts',      label:'Parts'      },
  { id:'layout',     label:'Layout'     },
  { id:'properties', label:'Properties' },
]

// ── Palette item ─────────────────────────────────────────────────────────────
function PaletteItem({ label, onClick, symbol, disabled, active }) {
  return (
    <button onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? 'Select a bar (or bars) first' : label}
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
      <span style={{ fontSize:18, lineHeight:1 }}>{symbol}</span>
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
        <div style={{
          display:'flex', flexWrap:'wrap', gap:4,
          padding:'4px 10px 10px',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Palettes tab ─────────────────────────────────────────────────────────────
// Dynamics / Articulations / Text / Barlines / Lines all act on whatever is
// currently selected on the scoresheet:
//   • If a single note is selected  → the mark attaches to that note/beat.
//   • Else if a bar (or bar range)  → the mark applies across the whole range.
//   • Else                          → the buttons are disabled (nothing to target).
function PalettesTab({ search }) {
  const score               = useScoreStore(s => s.score)
  const selectedPartId      = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex= useScoreStore(s => s.selectedMeasureIndex)
  const selectedMeasureRange= useScoreStore(s => s.selectedMeasureRange)
  const selectedNoteId      = useScoreStore(s => s.selectedNoteId)
  const getSelectedNote     = useScoreStore(s => s.getSelectedNote)
  const getNoteBeatPosition = useScoreStore(s => s.getNoteBeatPosition)

  const addDynamic          = useScoreStore(s => s.addDynamic)
  const removeDynamic       = useScoreStore(s => s.removeDynamic)
  const addHairpin          = useScoreStore(s => s.addHairpin)
  const addStaffText        = useScoreStore(s => s.addStaffText)
  const setBarline          = useScoreStore(s => s.setBarline)
  const addOctaveLine       = useScoreStore(s => s.addOctaveLine)
  const setArticulation     = useScoreStore(s => s.setArticulation)
  const applyArticulationToRange = useScoreStore(s => s.applyArticulationToRange)
  const toggleTie           = useScoreStore(s => s.toggleTie)
  const toggleSlurStart     = useScoreStore(s => s.toggleSlurStart)

  // ── Range of measures currently targeted (inclusive), or null ───────────
  const range = selectedMeasureRange
    ? [Math.min(selectedMeasureRange.start, selectedMeasureRange.end), Math.max(selectedMeasureRange.start, selectedMeasureRange.end)]
    : (selectedMeasureIndex !== null ? [selectedMeasureIndex, selectedMeasureIndex] : null)

  const hasSelection = !!(range && selectedPartId)
  const liveNote = hasSelection ? getSelectedNote?.() : null
  const noteIsUsable = liveNote && !liveNote.isRest && selectedNoteId

  // Point-in-time target (measure + beat) for dynamics/text: the selected
  // note's exact beat if one is selected, otherwise the start of the bar range.
  const pointTarget = () => {
    if (!hasSelection) return null
    if (selectedNoteId) {
      const beat = getNoteBeatPosition(selectedPartId, selectedMeasureIndex, selectedNoteId)
      return { measureIndex: selectedMeasureIndex, beat }
    }
    return { measureIndex: range[0], beat: 0 }
  }

  const handleDynamic = (label) => {
    const t = pointTarget()
    if (!t) return
    const existing = (score.dynamics||[]).find(d =>
      d.partId === selectedPartId && d.measureIndex === t.measureIndex && Math.abs(d.beat - t.beat) < 0.1)
    if (existing && existing.value === label) removeDynamic(existing.id)
    else addDynamic(selectedPartId, t.measureIndex, t.beat, label)
  }

  const handleArticulation = (type) => {
    if (!hasSelection) return
    if (noteIsUsable) setArticulation(selectedPartId, selectedMeasureIndex, selectedNoteId, type)
    else applyArticulationToRange(selectedPartId, range[0], range[1], type)
  }

  const handleText = (label) => {
    const t = pointTarget()
    if (!t) return
    addStaffText(selectedPartId, t.measureIndex, t.beat, label)
  }

  const handleBarline = (type) => {
    if (!hasSelection) return
    if (type === 'repeat-start') setBarline(range[0], type)
    else setBarline(range[1], type)
  }

  const handleLine = (kind) => {
    if (!hasSelection) return
    const [start, end] = range
    if (kind === 'cresc' || kind === 'decresc') {
      const endMeasure = score.parts.find(p => p.id === selectedPartId)?.measures[end]
      const endBeat = measureCapacity(endMeasure?.timeSignature)
      addHairpin(selectedPartId, start, 0, end, endBeat, kind)
    } else if (kind === '8va' || kind === '8vb') {
      addOctaveLine(selectedPartId, start, end, kind)
    } else if (kind === 'rit.' || kind === 'accel.') {
      addStaffText(selectedPartId, start, 0, kind)
    }
  }

  // Tempo markings always sit above the very first beat of the target bar,
  // regardless of whether a specific note is selected within it.
  const handleTempo = (label) => {
    if (!hasSelection) return
    addStaffText(selectedPartId, range[0], 0, label)
  }

  // Is a given articulation currently active on the selected note?
  const isArtActive = (type) => {
    if (!noteIsUsable) return false
    const marks = liveNote.articulations || (liveNote.articulation ? [liveNote.articulation] : [])
    return marks.includes(type)
  }

  const allPalettes = [
    {
      title:'Clefs', items:[
        { symbol:'𝄞', label:'Treble',     onClick:()=>{} },
        { symbol:'𝄢', label:'Bass',       onClick:()=>{} },
        { symbol:'𝄡', label:'Alto',       onClick:()=>{} },
        { symbol:'𝄡', label:'Tenor',      onClick:()=>{} },
        { symbol:'𝄠', label:'Perc.',      onClick:()=>{} },
      ]
    },
    {
      title:'Key Signatures', items:[
        { symbol:'♮',  label:'C maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(0) },
        { symbol:'♯',  label:'G maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(1) },
        { symbol:'♯♯', label:'D maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(2) },
        { symbol:'♭',  label:'F maj',     onClick:()=>useScoreStore.getState().setGlobalKeySignature(-1) },
        { symbol:'♭♭', label:'Bb maj',    onClick:()=>useScoreStore.getState().setGlobalKeySignature(-2) },
      ]
    },
    {
      title:'Time Signatures', items:[
        { symbol:'4/4', label:'4/4',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:4,beatType:4}) },
        { symbol:'3/4', label:'3/4',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:3,beatType:4}) },
        { symbol:'2/4', label:'2/4',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:2,beatType:4}) },
        { symbol:'6/8', label:'6/8',  onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:6,beatType:8}) },
        { symbol:'𝄵',  label:'Cut',   onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:2,beatType:2}) },
        { symbol:'𝄴',  label:'Common',onClick:()=>useScoreStore.getState().setGlobalTimeSignature({beats:4,beatType:4}) },
      ]
    },
    {
      title:'Tempo', items:[
        { symbol:'♩=80',  label:'♩=80',        onClick:()=>handleTempo('♩ = 80'),        disabled:!hasSelection },
        { symbol:'♩.=80', label:'♩.=80',       onClick:()=>handleTempo('♩. = 80'),       disabled:!hasSelection },
        { symbol:'♪=80',  label:'♪=80',        onClick:()=>handleTempo('♪ = 80'),        disabled:!hasSelection },
        { symbol:'Grave',       label:'Grave',       onClick:()=>handleTempo('Grave'),       disabled:!hasSelection },
        { symbol:'Largo',       label:'Largo',       onClick:()=>handleTempo('Largo'),       disabled:!hasSelection },
        { symbol:'Lento',       label:'Lento',       onClick:()=>handleTempo('Lento'),       disabled:!hasSelection },
        { symbol:'Larghetto',   label:'Larghetto',   onClick:()=>handleTempo('Larghetto'),   disabled:!hasSelection },
        { symbol:'Adagio',      label:'Adagio',      onClick:()=>handleTempo('Adagio'),      disabled:!hasSelection },
        { symbol:'Andante',     label:'Andante',     onClick:()=>handleTempo('Andante'),     disabled:!hasSelection },
        { symbol:'Andantino',   label:'Andantino',   onClick:()=>handleTempo('Andantino'),   disabled:!hasSelection },
        { symbol:'Moderato',    label:'Moderato',    onClick:()=>handleTempo('Moderato'),    disabled:!hasSelection },
        { symbol:'Allegretto',  label:'Allegretto',  onClick:()=>handleTempo('Allegretto'),  disabled:!hasSelection },
        { symbol:'Allegro',     label:'Allegro',     onClick:()=>handleTempo('Allegro'),     disabled:!hasSelection },
        { symbol:'Vivace',      label:'Vivace',      onClick:()=>handleTempo('Vivace'),      disabled:!hasSelection },
        { symbol:'Presto',      label:'Presto',      onClick:()=>handleTempo('Presto'),      disabled:!hasSelection },
        { symbol:'Prestissimo', label:'Prestissimo', onClick:()=>handleTempo('Prestissimo'), disabled:!hasSelection },
        { symbol:'♩=♩.', label:'♩=♩.', onClick:()=>handleTempo('♩ = ♩.'), disabled:!hasSelection },
        { symbol:'♩.=♩', label:'♩.=♩', onClick:()=>handleTempo('♩. = ♩'), disabled:!hasSelection },
        { symbol:'♩=♩',  label:'♩=♩',  onClick:()=>handleTempo('♩ = ♩'),  disabled:!hasSelection },
        { symbol:'♪=♪',  label:'♪=♪',  onClick:()=>handleTempo('♪ = ♪'),  disabled:!hasSelection },
        { symbol:'♪.=♩', label:'♪.=♩', onClick:()=>handleTempo('♪. = ♩'), disabled:!hasSelection },
        { symbol:'allarg.', label:'allarg.',    onClick:()=>handleTempo('allarg.'),     disabled:!hasSelection },
        { symbol:'rall.',   label:'rall.',      onClick:()=>handleTempo('rall.'),       disabled:!hasSelection },
        { symbol:'rit.',    label:'rit.',       onClick:()=>handleTempo('rit.'),        disabled:!hasSelection },
        { symbol:'a tempo', label:'a tempo',    onClick:()=>handleTempo('a tempo'),     disabled:!hasSelection },
        { symbol:'temp.pr', label:'Tempo I',    onClick:()=>handleTempo('Tempo primo'), disabled:!hasSelection },
        { symbol:'Swing',   label:'Swing',      onClick:()=>handleTempo('Swing'),       disabled:!hasSelection },
        { symbol:'Straight',label:'Straight',   onClick:()=>handleTempo('Straight'),    disabled:!hasSelection },
      ]
    },
    {
      title:'Dynamics', items:[
        { symbol:'𝆏𝆏𝆏', label:'ppp', onClick:()=>handleDynamic('ppp'), disabled:!hasSelection },
        { symbol:'𝆏𝆏',  label:'pp',  onClick:()=>handleDynamic('pp'),  disabled:!hasSelection },
        { symbol:'𝆏',   label:'p',   onClick:()=>handleDynamic('p'),   disabled:!hasSelection },
        { symbol:'𝆐𝆏',  label:'mp',  onClick:()=>handleDynamic('mp'),  disabled:!hasSelection },
        { symbol:'𝆐𝆑',  label:'mf',  onClick:()=>handleDynamic('mf'),  disabled:!hasSelection },
        { symbol:'𝆑',   label:'f',   onClick:()=>handleDynamic('f'),   disabled:!hasSelection },
        { symbol:'𝆑𝆑',  label:'ff',  onClick:()=>handleDynamic('ff'),  disabled:!hasSelection },
        { symbol:'𝆑𝆑𝆑', label:'fff', onClick:()=>handleDynamic('fff'), disabled:!hasSelection },
        { symbol:'sfz', label:'sfz', onClick:()=>handleDynamic('sfz'), disabled:!hasSelection },
      ]
    },
    {
      title:'Articulations', items:[
        { symbol:'·',  label:'Staccato',   onClick:()=>handleArticulation('staccato'), disabled:!hasSelection, active:isArtActive('staccato') },
        { symbol:'−',  label:'Tenuto',     onClick:()=>handleArticulation('tenuto'),   disabled:!hasSelection, active:isArtActive('tenuto') },
        { symbol:'ˆ',  label:'Marcato',    onClick:()=>handleArticulation('marcato'),  disabled:!hasSelection, active:isArtActive('marcato') },
        { symbol:'>',  label:'Accent',     onClick:()=>handleArticulation('accent'),   disabled:!hasSelection, active:isArtActive('accent') },
        { symbol:'⌢', label:'Slur',       onClick:()=>toggleSlurStart(),               disabled:!noteIsUsable, active:!!(noteIsUsable && liveNote.slurStart) },
        { symbol:'⌣', label:'Tie',        onClick:()=>toggleTie(),                     disabled:!noteIsUsable, active:!!(noteIsUsable && liveNote.tieStart) },
        { symbol:'tr', label:'Trill',      onClick:()=>handleArticulation('trill'),    disabled:!hasSelection, active:isArtActive('trill') },
        { symbol:'~',  label:'Vibrato',    onClick:()=>handleArticulation('vibrato'),  disabled:!hasSelection, active:isArtActive('vibrato') },
      ]
    },
    {
      title:'Text', items:[
        { symbol:'𝄐', label:'Fermata',    onClick:()=>handleArticulation('fermata'), disabled:!hasSelection, active:isArtActive('fermata') },
        { symbol:'D.C', label:'D.C.',     onClick:()=>handleText('D.C.'), disabled:!hasSelection },
        { symbol:'D.S', label:'D.S.',     onClick:()=>handleText('D.S.'), disabled:!hasSelection },
        { symbol:'𝄋', label:'Segno',     onClick:()=>handleText('𝄋'),   disabled:!hasSelection },
        { symbol:'𝄌', label:'Coda',      onClick:()=>handleText('𝄌'),   disabled:!hasSelection },
        { symbol:'⁋', label:'Fine',      onClick:()=>handleText('Fine'), disabled:!hasSelection },
      ]
    },
    {
      title:'Barlines', items:[
        { symbol:'|',  label:'Normal',    onClick:()=>handleBarline('normal'),       disabled:!hasSelection },
        { symbol:'||', label:'Double',    onClick:()=>handleBarline('double'),       disabled:!hasSelection },
        { symbol:'|‖', label:'Final',    onClick:()=>handleBarline('final'),        disabled:!hasSelection },
        { symbol:'|:',  label:'Repeat S.',onClick:()=>handleBarline('repeat-start'), disabled:!hasSelection },
        { symbol:':|',  label:'Repeat E.',onClick:()=>handleBarline('repeat-end'),   disabled:!hasSelection },
        { symbol:':|:', label:'Repeat B.',onClick:()=>handleBarline('repeat-both'),  disabled:!hasSelection },
      ]
    },
    {
      title:'Lines', items:[
        { symbol:'cresc.', label:'Cresc.',  onClick:()=>handleLine('cresc'),   disabled:!hasSelection },
        { symbol:'dim.',   label:'Dim.',    onClick:()=>handleLine('decresc'), disabled:!hasSelection },
        { symbol:'8va',    label:'8va',     onClick:()=>handleLine('8va'),     disabled:!hasSelection },
        { symbol:'8vb',    label:'8vb',     onClick:()=>handleLine('8vb'),     disabled:!hasSelection },
        { symbol:'rit.',   label:'Rit.',    onClick:()=>handleLine('rit.'),    disabled:!hasSelection },
        { symbol:'accel.', label:'Accel.',  onClick:()=>handleLine('accel.'),  disabled:!hasSelection },
      ]
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
      {/* Status hint — tells the user what their click will target */}
      <div style={{
        padding:'8px 12px', fontSize:11, lineHeight:1.4,
        background: hasSelection ? '#eff6ff' : '#fff7ed',
        color: hasSelection ? '#1d4ed8' : '#9a5b13',
        borderBottom:'1px solid #f0f0f0',
      }}>
        {!hasSelection && 'Select a bar (or drag across several) to apply symbols.'}
        {hasSelection && noteIsUsable && `Applying to selected note in bar ${selectedMeasureIndex+1}.`}
        {hasSelection && !noteIsUsable && range[0] === range[1] && `Applying to bar ${range[0]+1}.`}
        {hasSelection && !noteIsUsable && range[0] !== range[1] && `Applying to bars ${range[0]+1}–${range[1]+1}.`}
      </div>
      {filtered.map((p, i) => (
        <PaletteSection key={p.title} title={p.title} defaultOpen={i < 3}>
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
  const score     = useScoreStore(s => s.score)
  const addPart   = useScoreStore(s => s.addPart)
  const removePart= useScoreStore(s => s.removePart)
  const movePartUp= useScoreStore(s => s.movePartUp)
  const movePartDown = useScoreStore(s => s.movePartDown)
  const selectedPartId = useScoreStore(s => s.selectedPartId)
  const setSelectedPart = useScoreStore(s => s.setSelectedPart)

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Voice Parts
      </div>
      {score.parts.map((p, i) => (
        <div key={p.id}
          onClick={() => setSelectedPart?.(p.id)}
          style={{
            display:'flex', alignItems:'center', gap:6, padding:'6px 8px',
            marginBottom:3, borderRadius:6, cursor:'pointer',
            background: selectedPartId === p.id ? '#eff6ff' : 'white',
            border: `1px solid ${selectedPartId === p.id ? '#93c5fd' : '#e5e7eb'}`,
            transition:'all 0.1s',
          }}
        >
          <span style={{ fontSize:15 }}>
            {p.clef === 'bass' ? '𝄢' : '𝄞'}
          </span>
          <span style={{ flex:1, fontSize:12.5, fontWeight:500, color:'#1e2433' }}>
            {p.label || p.name || `Part ${i+1}`}
          </span>
          <div style={{ display:'flex', gap:2 }}>
            <button onClick={e => { e.stopPropagation(); movePartUp(p.id) }}
              style={{ width:18, height:18, border:'none', background:'none', cursor:'pointer',
                fontSize:10, color:'#9ca3af', borderRadius:3 }}
              title="Move up">▲</button>
            <button onClick={e => { e.stopPropagation(); movePartDown(p.id) }}
              style={{ width:18, height:18, border:'none', background:'none', cursor:'pointer',
                fontSize:10, color:'#9ca3af', borderRadius:3 }}
              title="Move down">▼</button>
            <button onClick={e => { e.stopPropagation(); removePart(p.id) }}
              style={{ width:18, height:18, border:'none', background:'none', cursor:'pointer',
                fontSize:11, color:'#f87171', borderRadius:3 }}
              title="Remove part">×</button>
          </div>
        </div>
      ))}
      <button onClick={() => addPart({ label:'New Part', clef:'treble' })}
        style={{
          width:'100%', marginTop:8, padding:'7px 0', fontSize:12, fontWeight:600,
          background:'#eff6ff', color:'#2563eb', border:'1px dashed #93c5fd',
          borderRadius:6, cursor:'pointer',
        }}
        onMouseEnter={e => e.currentTarget.style.background='#dbeafe'}
        onMouseLeave={e => e.currentTarget.style.background='#eff6ff'}
      >
        + Add Part
      </button>
    </div>
  )
}

// ── Layout tab ───────────────────────────────────────────────────────────────
function LayoutTab() {
  const zoom    = useScoreStore(s => s.zoom)
  const setZoom = useScoreStore(s => s.setZoom)

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.05em' }}>
        Layout Options
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:11.5, color:'#374151', marginBottom:4, fontWeight:600 }}>Zoom</div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={() => setZoom(Math.max(0.4, zoom - 0.1))}
            style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
              background:'white', cursor:'pointer', fontSize:14, lineHeight:1 }}>−</button>
          <span style={{ flex:1, textAlign:'center', fontSize:12, fontWeight:600, color:'#1e2433' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            style={{ width:24, height:24, border:'1px solid #e5e7eb', borderRadius:4,
              background:'white', cursor:'pointer', fontSize:14, lineHeight:1 }}>+</button>
        </div>
        <input type="range" min={40} max={200} value={Math.round(zoom*100)}
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
  const liveNote = useScoreStore(s => s.getSelectedNote?.())

  if (!liveNote) {
    return (
      <div style={{ padding:'20px 16px', textAlign:'center' }}>
        <div style={{ fontSize:24, marginBottom:8, color:'#d1d5db' }}>♩</div>
        <div style={{ fontSize:12, color:'#9ca3af', lineHeight:1.5 }}>
          Select a note to see<br/>its properties here
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding:'10px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10,
        textTransform:'uppercase', letterSpacing:'0.05em' }}>Note Properties</div>
      <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#6b7280' }}>Pitch</span>
          <span style={{ fontWeight:600 }}>
            {liveNote.isRest ? 'Rest' : `${liveNote.pitch?.step}${liveNote.pitch?.accidental||''}${liveNote.pitch?.octave}`}
          </span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ color:'#6b7280' }}>Duration</span>
          <span style={{ fontWeight:600 }}>
            {liveNote.duration}{liveNote.dots ? '.'.repeat(liveNote.dots) : ''}
          </span>
        </div>
        {liveNote.tie && (
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'#6b7280' }}>Tied</span>
            <span style={{ fontWeight:600, color:'#2563eb' }}>Yes</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Sidebar component ───────────────────────────────────────────────────
export default function Sidebar({ collapsed, setCollapsed }) {
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
      overflow: 'hidden',   // the child scroll area handles scrolling
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
              flex:1, padding:'7px 0', fontSize:10, fontWeight:700,
              border:'none', background:'none', cursor:'pointer',
              borderBottom: activeTab===tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab===tab.id ? '#2563eb' : '#6b7280',
              letterSpacing:'0.02em',
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
        {activeTab==='layout'     && <LayoutTab />}
        {activeTab==='properties' && <PropertiesTab />}
      </div>
    </div>
  )
}