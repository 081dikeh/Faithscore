// src/components/Toolbar/index.jsx
// FaithScore — Note-input toolbar
// Single focused row: Mode | Durations | Dot | Accidentals | Octave | Chord | Actions
// Key/Time/Tempo live in the score info bar above — not duplicated here.

import { useScoreStore } from '../../store/scoreStore'

const DURATIONS = [
  { val:'w',  label:'Whole',   sym:'𝅝'  },
  { val:'h',  label:'Half',    sym:'𝅗𝅥'  },
  { val:'q',  label:'Quarter', sym:'♩'  },
  { val:'8',  label:'8th',     sym:'♪'  },
  { val:'16', label:'16th',    sym:'𝅘𝅥𝅰' },
  { val:'32', label:'32nd',    sym:'𝅘𝅥𝅱' },
  { val:'64', label:'64th',    sym:'𝅘𝅥𝅲' },
]

const ACCIDENTALS = [
  { acc:null, label:'♮ Natural', short:'♮' },
  { acc:'#',  label:'♯ Sharp',   short:'♯' },
  { acc:'b',  label:'♭ Flat',    short:'♭' },
  { acc:'##', label:'𝄪 Double♯', short:'𝄪' },
  { acc:'bb', label:'𝄫 Double♭', short:'𝄫' },
]

function Sep() {
  return <div style={{ width:1, alignSelf:'stretch', background:'#e5e7eb', margin:'0 3px', flexShrink:0 }} />
}

function Btn({ active, onClick, title, children, accent }) {
  const bg     = active ? (accent || '#2563eb') : 'white'
  const border = active ? (accent || '#2563eb') : '#d1d5db'
  const color  = active ? 'white' : '#374151'
  return (
    <button title={title} onClick={onClick} style={{
      height:28, minWidth:28, padding:'0 6px',
      display:'flex', alignItems:'center', justifyContent:'center', gap:2,
      border:`1px solid ${border}`, borderRadius:5,
      background:bg, color, fontWeight: active ? 700 : 500,
      fontSize:13, cursor:'pointer', flexShrink:0, lineHeight:1,
      transition:'background 0.1s, border-color 0.1s',
    }}
    onMouseEnter={e=>{ if(!active){ e.currentTarget.style.background='#f3f4f6'; e.currentTarget.style.borderColor='#9ca3af' }}}
    onMouseLeave={e=>{ if(!active){ e.currentTarget.style.background='white';   e.currentTarget.style.borderColor='#d1d5db' }}}>
      {children}
    </button>
  )
}

export default function Toolbar() {
  const inputMode          = useScoreStore(s => s.inputMode)
  const selectedDuration   = useScoreStore(s => s.selectedDuration)
  const selectedDots       = useScoreStore(s => s.selectedDots)
  const selectedOctave     = useScoreStore(s => s.selectedOctave)
  const chordMode          = useScoreStore(s => s.chordMode)
  const getSelectedNote    = useScoreStore(s => s.getSelectedNote)
  const selectedPartId     = useScoreStore(s => s.selectedPartId)
  const score              = useScoreStore(s => s.score)

  const setInputMode           = useScoreStore(s => s.setInputMode)
  const setDuration            = useScoreStore(s => s.setDuration)
  const setSelectedDots        = useScoreStore(s => s.setSelectedDots)
  const setSelectedOctave      = useScoreStore(s => s.setSelectedOctave)
  const setChordMode           = useScoreStore(s => s.setChordMode)
  const changeSelectedDuration = useScoreStore(s => s.changeSelectedDuration)
  const toggleTie              = useScoreStore(s => s.toggleTie)
  const insertTriplet          = useScoreStore(s => s.insertTriplet)
  const addMeasure             = useScoreStore(s => s.addMeasure)

  const liveNote   = getSelectedNote?.()
  const activeDur  = liveNote?.duration ?? selectedDuration
  const activeDots = liveNote?.dots     ?? selectedDots

  const selectedPart  = score.parts.find(p => p.id === selectedPartId)
  const clef          = selectedPart?.clef || 'treble'
  const octaveOptions = clef === 'bass' ? [1,2,3,4,5] : [3,4,5,6]

  function handleDuration(val) {
    if (liveNote) changeSelectedDuration(val, liveNote.dots || 0)
    else setDuration(val)
  }

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:2,
      padding:'3px 10px', background:'white',
      borderBottom:'1px solid #e5e7eb', flexShrink:0,
      flexWrap:'nowrap', overflowX:'auto',
      scrollbarWidth:'none',
    }}>

      {/* ── Mode ── */}
      <Btn active={inputMode==='select'} onClick={()=>setInputMode('select')} title="Select (Esc / S)">
        <span style={{fontSize:12}}>↖</span>
        <span style={{fontSize:10, fontWeight:700}}>S</span>
      </Btn>
      <Btn active={inputMode==='note'} onClick={()=>setInputMode('note')} title="Note input (N)" accent="#16a34a">
        <span style={{fontSize:14}}>♩</span>
        <span style={{fontSize:10, fontWeight:700}}>N</span>
      </Btn>

      <Sep />

      {/* ── Durations ── */}
      {DURATIONS.map(d => (
        <Btn key={d.val} active={activeDur===d.val} onClick={()=>handleDuration(d.val)}
          title={`${d.label} (${DURATIONS.indexOf(d)+1})`} accent="#ea580c">
          <span style={{fontSize:17, lineHeight:0.9}}>{d.sym}</span>
        </Btn>
      ))}

      {/* Dot */}
      <Btn active={!!activeDots}
        onClick={()=>{ if(liveNote) changeSelectedDuration(liveNote.duration, liveNote.dots?0:1); else setSelectedDots(selectedDots?0:1) }}
        title="Dotted (.)">
        <span style={{fontSize:20, fontWeight:900, lineHeight:0.7}}>·</span>
      </Btn>

      {/* Triplet */}
      <Btn active={false} onClick={()=>insertTriplet(selectedDuration)} title="Triplet">
        <span style={{fontSize:11, fontWeight:900, fontFamily:'monospace'}}>³</span>
      </Btn>

      <Sep />

      {/* ── Accidentals ── */}
      {ACCIDENTALS.map(a => (
        <Btn key={a.short} active={false} onClick={()=>{}} title={a.label}>
          <span style={{fontSize:15}}>{a.short}</span>
        </Btn>
      ))}

      <Sep />

      {/* ── Octave ── */}
      <span style={{fontSize:10, color:'#9ca3af', fontWeight:700, flexShrink:0}}>Oct</span>
      {octaveOptions.map(o => (
        <Btn key={o} active={selectedOctave===o} onClick={()=>setSelectedOctave(o)} title={`Octave ${o}`}>
          <span style={{fontSize:11, fontFamily:'monospace', fontWeight:700}}>{o}</span>
        </Btn>
      ))}

      <Sep />

      {/* ── Chord mode ── */}
      <Btn active={chordMode} onClick={()=>setChordMode(!chordMode)}
        title="Chord mode — add note to current beat (J)" accent="#7c3aed">
        <span style={{fontSize:12}}>𝄪</span>
        <span style={{fontSize:10, fontWeight:700}}>Chord</span>
      </Btn>

      <Sep />

      {/* ── Quick actions ── */}
      <Btn active={false} onClick={toggleTie} title="Tie (T)">
        <span style={{fontSize:13}}>⌢</span>
        <span style={{fontSize:10}}>Tie</span>
      </Btn>
      <Btn active={false} onClick={addMeasure} title="Add bar (M)">
        <span style={{fontSize:10, fontWeight:700}}>+Bar</span>
      </Btn>

    </div>
  )
}