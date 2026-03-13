// src/components/Toolbar/index.jsx
import { useScoreStore } from '../../store/scoreStore'

const DURATIONS = [
  { sym:'𝅝',  val:'w',  label:'Whole (1)'   },
  { sym:'𝅗𝅥',  val:'h',  label:'Half (2)'    },
  { sym:'♩',  val:'q',  label:'Quarter (3)' },
  { sym:'♪',  val:'8',  label:'8th (4)'     },
  { sym:'𝅘𝅥𝅰', val:'16', label:'16th (5)'    },
  { sym:'𝅘𝅥𝅱', val:'32', label:'32nd (6)'    },
]

export const CHROMATIC_NOTES = [
  { step:'C', accidental:null, label:'C'   },
  { step:'C', accidental:'#',  label:'C♯'  },
  { step:'D', accidental:null, label:'D'   },
  { step:'E', accidental:'b',  label:'E♭'  },
  { step:'E', accidental:null, label:'E'   },
  { step:'F', accidental:null, label:'F'   },
  { step:'F', accidental:'#',  label:'F♯'  },
  { step:'G', accidental:null, label:'G'   },
  { step:'G', accidental:'#',  label:'G♯'  },
  { step:'A', accidental:null, label:'A'   },
  { step:'B', accidental:'b',  label:'B♭'  },
  { step:'B', accidental:null, label:'B'   },
]

export const KEY_SIGNATURES = [
  { label:'C maj / A min', value:0  }, { label:'G maj / E min',   value:1  },
  { label:'D maj / B min', value:2  }, { label:'A maj / F♯ min',  value:3  },
  { label:'E maj / C♯ min',value:4  }, { label:'B maj / G♯ min',  value:5  },
  { label:'F♯ maj / D♯ min',value:6 }, { label:'C♯ maj / A♯ min', value:7  },
  { label:'F maj / D min', value:-1 }, { label:'B♭ maj / G min',  value:-2 },
  { label:'E♭ maj / C min',value:-3 }, { label:'A♭ maj / F min',  value:-4 },
  { label:'D♭ maj / B♭ min',value:-5}, { label:'G♭ maj / E♭ min', value:-6 },
  { label:'C♭ maj / A♭ min',value:-7},
]

export const TIME_SIGNATURES = [
  { label:'4/4',  beats:4,  beatType:4 }, { label:'3/4',  beats:3,  beatType:4 },
  { label:'2/4',  beats:2,  beatType:4 }, { label:'2/2',  beats:2,  beatType:2 },
  { label:'6/8',  beats:6,  beatType:8 }, { label:'9/8',  beats:9,  beatType:8 },
  { label:'12/8', beats:12, beatType:8 }, { label:'5/4',  beats:5,  beatType:4 },
  { label:'7/4',  beats:7,  beatType:4 }, { label:'3/8',  beats:3,  beatType:8 },
]

// Separator component
function Sep() {
  return <div className="h-6 w-px bg-gray-300 mx-0.5 flex-shrink-0" />
}

// Generic toolbar button
function TBtn({ active, onClick, title, children, wide = false, color = 'default' }) {
  let activeStyle = 'bg-blue-600 text-white border-blue-600'
  if (color === 'orange') activeStyle = 'bg-orange-500 text-white border-orange-500'
  if (color === 'purple') activeStyle = 'bg-purple-600 text-white border-purple-600'
  if (color === 'green')  activeStyle = 'bg-green-600 text-white border-green-600'

  return (
    <button title={title} onClick={onClick}
      className={`h-7 ${wide ? 'px-3' : 'min-w-[28px] px-1.5'} rounded border text-sm font-medium
        flex items-center justify-center gap-1 transition-colors flex-shrink-0
        ${active
          ? activeStyle
          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
        }`}>
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
  const selectedPartId         = useScoreStore(s => s.selectedPartId)
  const selectedNoteId         = useScoreStore(s => s.selectedNoteId)
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

  const selectedPart   = score.parts.find(p => p.id === selectedPartId)
  const clef           = selectedPart?.clef || 'treble'
  const octaveOptions  = clef === 'bass' ? [1,2,3,4,5] : [3,4,5,6]
  const currentKey     = score.parts[0]?.measures[0]?.keySignature ?? 0
  const currentTimeSig = score.parts[0]?.measures[0]?.timeSignature ?? { beats:4, beatType:4 }

  // The live selected note object (if any)
  const liveNote    = getSelectedNote?.()
  const hasNote     = !!liveNote && !liveNote.isRest
  const hasAnyNote  = !!liveNote

  // Active duration = selected note's duration (if editing) else toolbar state
  const activeDur  = liveNote?.duration  ?? selectedDuration
  const activeDots = liveNote?.dots      ?? selectedDots

  function handleDuration(val) {
    if (hasAnyNote) {
      changeSelectedDuration(val, liveNote.dots || 0)
    } else {
      setDuration(val)
    }
  }

  function handleDot() {
    if (hasAnyNote) {
      changeSelectedDuration(liveNote.duration, liveNote.dots ? 0 : 1)
    } else {
      setSelectedDots(selectedDots ? 0 : 1)
    }
  }

  return (
    <div className="bg-white border-b border-gray-200 select-none flex-shrink-0 shadow-sm">

      {/* ── Row 1: input mode + duration + octave + chord + key + time ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap border-b border-gray-100">

        {/* Mode */}
        <TBtn active={inputMode==='select'} onClick={() => setInputMode('select')} title="Select mode (S)">
          ↖ Select
        </TBtn>
        <TBtn active={inputMode==='note'} onClick={() => setInputMode('note')} title="Note input mode (N)" color="green">
          ♩ Note
        </TBtn>

        <Sep />

        {/* Duration buttons */}
        {hasAnyNote && (
          <span className="text-xs text-gray-400 mr-0.5 italic">resize:</span>
        )}
        {DURATIONS.map(d => (
          <TBtn key={d.val} active={activeDur===d.val} onClick={() => handleDuration(d.val)}
            title={d.label} color="orange">
            <span className="text-base leading-none">{d.sym}</span>
          </TBtn>
        ))}
        <TBtn active={!!activeDots} onClick={handleDot} title="Dotted note (·)" color="orange">
          <span className="text-xl leading-none">·</span>
        </TBtn>

        <Sep />

        {/* Octave */}
        <span className="text-xs text-gray-500">Oct</span>
        {octaveOptions.map(o => (
          <TBtn key={o} active={selectedOctave===o} onClick={() => setSelectedOctave(o)}>
            {o}
          </TBtn>
        ))}

        <Sep />

        {/* Chord */}
        <TBtn active={chordMode} onClick={() => setChordMode(!chordMode)} title="Chord mode (J)" color="purple" wide>
          ⊕ Chord
        </TBtn>

        <Sep />

        {/* Tempo */}
        <span className="text-xs text-gray-500">♩=</span>
        <input type="number" value={score.tempo} min={20} max={300}
          onChange={e => setTempo(Number(e.target.value))}
          className="w-14 border border-gray-300 rounded px-1.5 h-7 text-xs text-center outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
      </div>

      {/* ── Row 2: chromatic note picker + key + time sig ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap">

        <span className="text-xs text-gray-500 mr-0.5">Note</span>

        {CHROMATIC_NOTES.map((n, i) => {
          const isSelected = selectedNote?.step === n.step && selectedNote?.accidental === n.accidental
          const isBlack    = n.accidental !== null
          return (
            <button key={i} onClick={() => setSelectedNote(n)} title={n.label}
              className={`h-7 px-2 rounded border text-sm font-semibold transition-colors flex-shrink-0
                ${isSelected
                  ? 'bg-orange-500 text-white border-orange-500'
                  : isBlack
                    ? 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'
                    : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                }`}>
              {n.label}
            </button>
          )
        })}

        <Sep />

        <span className="text-xs text-gray-500">Key</span>
        <select value={currentKey} onChange={e => setGlobalKeySignature(Number(e.target.value))}
          className="border border-gray-300 rounded px-2 h-7 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-blue-300 bg-white">
          {KEY_SIGNATURES.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>

        <Sep />

        <span className="text-xs text-gray-500">Time</span>
        {TIME_SIGNATURES.map(t => {
          const active = currentTimeSig.beats===t.beats && currentTimeSig.beatType===t.beatType
          return (
            <TBtn key={t.label} active={active}
              onClick={() => setGlobalTimeSignature({ beats:t.beats, beatType:t.beatType })}>
              {t.label}
            </TBtn>
          )
        })}
      </div>
    </div>
  )
}
