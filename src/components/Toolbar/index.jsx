// src/components/Toolbar/index.jsx
// FaithScore — MuseScore-style Toolbar
// Two compact rows:
//   Row 1: Mode | Durations + Dot + Triplet | Chromatic notes | Octave | Chord
//   Row 2: Key | Time | Tempo (these stay visible always for quick access)
import { useScoreStore } from '../../store/scoreStore'

export const CHROMATIC_NOTES = [
  { step:'C', accidental:null,  label:'C'  },
  { step:'C', accidental:'#',   label:'C♯' },
  { step:'D', accidental:null,  label:'D'  },
  { step:'E', accidental:'b',   label:'E♭' },
  { step:'E', accidental:null,  label:'E'  },
  { step:'F', accidental:null,  label:'F'  },
  { step:'F', accidental:'#',   label:'F♯' },
  { step:'G', accidental:null,  label:'G'  },
  { step:'G', accidental:'#',   label:'G♯' },
  { step:'A', accidental:null,  label:'A'  },
  { step:'B', accidental:'b',   label:'B♭' },
  { step:'B', accidental:null,  label:'B'  },
]

export const KEY_SIGNATURES = [
  { label:'C maj / A min',     value: 0  }, { label:'G maj / E min',    value: 1  },
  { label:'D maj / B min',     value: 2  }, { label:'A maj / F♯ min',   value: 3  },
  { label:'E maj / C♯ min',    value: 4  }, { label:'B maj / G♯ min',   value: 5  },
  { label:'F♯ maj / D♯ min',   value: 6  }, { label:'C♯ maj / A♯ min',  value: 7  },
  { label:'F maj / D min',     value:-1  }, { label:'B♭ maj / G min',   value:-2  },
  { label:'E♭ maj / C min',    value:-3  }, { label:'A♭ maj / F min',   value:-4  },
  { label:'D♭ maj / B♭ min',   value:-5  }, { label:'G♭ maj / E♭ min',  value:-6  },
  { label:'C♭ maj / A♭ min',   value:-7  },
]

export const TIME_SIGNATURES = [
  { label:'4/4', beats:4, beatType:4 }, { label:'3/4', beats:3, beatType:4 },
  { label:'2/4', beats:2, beatType:4 }, { label:'2/2', beats:2, beatType:2 },
  { label:'6/8', beats:6, beatType:8 }, { label:'9/8', beats:9, beatType:8 },
  { label:'12/8',beats:12,beatType:8 }, { label:'5/4', beats:5, beatType:4 },
  { label:'7/4', beats:7, beatType:4 }, { label:'3/8', beats:3, beatType:8 },
]

// Duration data: symbol + value + keyboard shortcut label
const DURATIONS = [
  { val:'w',  sym:'𝅝',   label:'Whole',    key:'1' },
  { val:'h',  sym:'𝅗𝅥',   label:'Half',     key:'2' },
  { val:'q',  sym:'♩',   label:'Quarter',  key:'3' },
  { val:'8',  sym:'♪',   label:'8th',      key:'4' },
  { val:'16', sym:'𝅘𝅥𝅰',  label:'16th',     key:'5' },
  { val:'32', sym:'𝅘𝅥𝅱',  label:'32nd',     key:'6' },
  { val:'64', sym:'𝅘𝅥𝅱',  label:'64th',     key:'7' },
]

// Vertical separator
function Sep() {
  return (
    <div style={{
      width: 1, height: 22, background: '#e5e7eb',
      margin: '0 4px', flexShrink: 0,
    }} />
  )
}

// Toolbar button — uniform 26×26 touch target
function TBtn({ active, onClick, title, children, color = 'default', wide = false }) {
  const colors = {
    default: { bg: '#2563eb', border: '#2563eb', text: 'white' },
    green:   { bg: '#16a34a', border: '#16a34a', text: 'white' },
    orange:  { bg: '#ea580c', border: '#ea580c', text: 'white' },
    purple:  { bg: '#7c3aed', border: '#7c3aed', text: 'white' },
    red:     { bg: '#dc2626', border: '#dc2626', text: 'white' },
  }
  const ac = colors[color] || colors.default
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        height: 26,
        minWidth: wide ? 'auto' : 26,
        padding: wide ? '0 8px' : '0 4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 3, flexShrink: 0,
        borderRadius: 4,
        border: `1px solid ${active ? ac.border : '#d1d5db'}`,
        background: active ? ac.bg : 'white',
        color: active ? ac.text : '#374151',
        fontSize: 13, fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        transition: 'all 0.1s',
        lineHeight: 1,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f9fafb' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'white' }}
    >
      {children}
    </button>
  )
}

export default function Toolbar() {
  const score                  = useScoreStore(s => s.score)
  const inputMode              = useScoreStore(s => s.inputMode)
  const selectedDuration       = useScoreStore(s => s.selectedDuration)
  const selectedDots           = useScoreStore(s => s.selectedDots)
  const selectedNote           = useScoreStore(s => s.selectedNote)
  const selectedOctave         = useScoreStore(s => s.selectedOctave)
  const chordMode              = useScoreStore(s => s.chordMode)
  const getSelectedNote        = useScoreStore(s => s.getSelectedNote)

  const setInputMode           = useScoreStore(s => s.setInputMode)
  const setDuration            = useScoreStore(s => s.setDuration)
  const setSelectedDots        = useScoreStore(s => s.setSelectedDots)
  const setSelectedNote        = useScoreStore(s => s.setSelectedNote)
  const setSelectedOctave      = useScoreStore(s => s.setSelectedOctave)
  const setChordMode           = useScoreStore(s => s.setChordMode)
  const setGlobalKeySignature  = useScoreStore(s => s.setGlobalKeySignature)
  const setGlobalTimeSignature = useScoreStore(s => s.setGlobalTimeSignature)
  const changeSelectedDuration = useScoreStore(s => s.changeSelectedDuration)
  const setTempo               = useScoreStore(s => s.setTempo)
  const selectedPartId         = useScoreStore(s => s.selectedPartId)

  const selectedPart   = score.parts.find(p => p.id === selectedPartId)
  const clef           = selectedPart?.clef || 'treble'
  const octaveOptions  = clef === 'bass' ? [1,2,3,4,5] : [3,4,5,6]
  const currentKey     = score.parts[0]?.measures[0]?.keySignature ?? 0
  const currentTimeSig = score.parts[0]?.measures[0]?.timeSignature ?? { beats:4, beatType:4 }

  const liveNote   = getSelectedNote?.()
  const hasAnyNote = !!liveNote
  const activeDur  = liveNote?.duration ?? selectedDuration
  const activeDots = liveNote?.dots     ?? selectedDots

  function handleDuration(val) {
    if (hasAnyNote) changeSelectedDuration(val, liveNote.dots || 0)
    else setDuration(val)
  }

  function handleDot() {
    if (hasAnyNote) changeSelectedDuration(liveNote.duration, liveNote.dots ? 0 : 1)
    else setSelectedDots(selectedDots ? 0 : 1)
  }

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 3,
    padding: '3px 8px', flexWrap: 'nowrap', overflowX: 'auto',
    scrollbarWidth: 'none',
  }

  const labelStyle = {
    fontSize: 10, color: '#9ca3af', flexShrink: 0,
    fontWeight: 600, letterSpacing: '0.03em',
    userSelect: 'none',
  }

  return (
    <div style={{
      background: '#ffffff',
      borderBottom: '1px solid #e5e7eb',
      flexShrink: 0,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>

      {/* ── Row 1: Mode · Durations · Notes · Octave · Chord ── */}
      <div style={rowStyle}>

        {/* Mode */}
        <TBtn active={inputMode === 'select'} onClick={() => setInputMode('select')}
          title="Select mode (Esc / S)" color="default">
          <span style={{ fontSize: 12 }}>↖</span>
        </TBtn>
        <TBtn active={inputMode === 'note'} onClick={() => setInputMode('note')}
          title="Note input mode (N)" color="green">
          <span style={{ fontSize: 14 }}>𝆑</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>N</span>
        </TBtn>

        <Sep />

        {/* Durations */}
        {DURATIONS.map(d => (
          <TBtn key={d.val} active={activeDur === d.val}
            onClick={() => handleDuration(d.val)}
            title={`${d.label} note (${d.key})`}
            color="orange">
            <span style={{ fontSize: 16, lineHeight: 1 }}>{d.sym}</span>
          </TBtn>
        ))}

        {/* Dot */}
        <TBtn active={!!activeDots} onClick={handleDot} title="Dotted (.)">
          <span style={{ fontSize: 18, lineHeight: 0.8, fontWeight: 900 }}>·</span>
        </TBtn>

        {/* Triplet */}
        <TBtn active={false} onClick={() => {}} title="Triplet (current duration)">
          <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace' }}>³</span>
        </TBtn>

        <Sep />

        {/* Chromatic note picker — mini piano key style */}
        <span style={labelStyle}>Notes</span>
        {CHROMATIC_NOTES.map((n, i) => {
          const isSel   = selectedNote?.step === n.step && selectedNote?.accidental === n.accidental
          const isBlack = n.accidental !== null
          return (
            <button key={i}
              onClick={() => setSelectedNote(n)}
              title={n.label}
              style={{
                height: 26,
                minWidth: isBlack ? 24 : 28,
                padding: '0 3px',
                fontSize: isBlack ? 10 : 11,
                fontWeight: 700,
                flexShrink: 0, cursor: 'pointer',
                borderRadius: 3,
                border: isSel ? '2px solid #ea580c' : `1px solid ${isBlack ? '#374151' : '#d1d5db'}`,
                background: isSel ? '#ea580c'
                  : isBlack ? '#1f2937'
                  : 'white',
                color: isSel ? 'white' : isBlack ? '#f9fafb' : '#111827',
                transition: 'all 0.08s',
                lineHeight: 1,
              }}
            >{n.label}</button>
          )
        })}

        <Sep />

        {/* Octave */}
        <span style={labelStyle}>Oct</span>
        {octaveOptions.map(o => (
          <TBtn key={o} active={selectedOctave === o} onClick={() => setSelectedOctave(o)}
            title={`Octave ${o}`}>
            <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>{o}</span>
          </TBtn>
        ))}

        <Sep />

        {/* Chord mode */}
        <TBtn active={chordMode} onClick={() => setChordMode(!chordMode)}
          title={chordMode ? 'Chord mode ON (J to toggle)' : 'Chord mode (J)'}
          color="purple" wide>
          <span style={{ fontSize: 13 }}>𝄪</span>
          <span style={{ fontSize: 10, fontWeight: 700 }}>{chordMode ? 'CHORD' : 'Chord'}</span>
        </TBtn>

      </div>

      {/* ── Row 2: Key · Time · Tempo — thin info row ── */}
      <div style={{
        ...rowStyle,
        padding: '2px 8px',
        borderTop: '1px solid #f3f4f6',
        background: '#fafafa',
        gap: 6,
      }}>

        <span style={labelStyle}>Key</span>
        <select
          value={currentKey}
          onChange={e => setGlobalKeySignature(Number(e.target.value))}
          style={{
            height: 22, fontSize: 11, border: '1px solid #e5e7eb',
            borderRadius: 4, padding: '0 4px', color: '#374151',
            background: 'white', outline: 'none', maxWidth: 130,
            cursor: 'pointer',
          }}
        >
          {KEY_SIGNATURES.map(k => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>

        <Sep />

        <span style={labelStyle}>Time</span>
        <select
          value={`${currentTimeSig.beats}/${currentTimeSig.beatType}`}
          onChange={e => {
            const [b, bt] = e.target.value.split('/').map(Number)
            setGlobalTimeSignature({ beats: b, beatType: bt })
          }}
          style={{
            height: 22, fontSize: 11, border: '1px solid #e5e7eb',
            borderRadius: 4, padding: '0 4px', color: '#374151',
            background: 'white', outline: 'none', cursor: 'pointer',
          }}
        >
          {TIME_SIGNATURES.map(t => (
            <option key={t.label} value={`${t.beats}/${t.beatType}`}>{t.label}</option>
          ))}
        </select>

        <Sep />

        <span style={labelStyle}>♩ =</span>
        <input
          type="number" min={20} max={300} value={score.tempo}
          onChange={e => setTempo(Number(e.target.value))}
          style={{
            width: 50, height: 22, fontSize: 11,
            border: '1px solid #e5e7eb', borderRadius: 4,
            padding: '0 4px', textAlign: 'center',
            outline: 'none', background: 'white', color: '#374151',
          }}
        />

      </div>
    </div>
  )
}