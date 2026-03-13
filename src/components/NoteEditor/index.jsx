// src/components/NoteEditor/index.jsx
import { useScoreStore } from '../../store/scoreStore'

const STEPS     = ['C','D','E','F','G','A','B']
const OCTAVES   = [2,3,4,5,6]
const ACCIDENTALS = [
  { label:'♮', value:null  },
  { label:'♯', value:'#'   },
  { label:'♭', value:'b'   },
  { label:'𝄪', value:'##'  },
  { label:'𝄫', value:'bb'  },
]
const DURATIONS = [
  { sym:'𝅝',  val:'w',  label:'Whole'   },
  { sym:'𝅗𝅥',  val:'h',  label:'Half'    },
  { sym:'♩',  val:'q',  label:'Quarter' },
  { sym:'♪',  val:'8',  label:'8th'     },
  { sym:'𝅘𝅥𝅰', val:'16', label:'16th'    },
  { sym:'𝅘𝅥𝅱', val:'32', label:'32nd'    },
]
const ACC_LABEL = { '#':'♯','b':'♭','##':'𝄪','bb':'𝄫' }

function Pill({ active, onClick, children, title, color = 'blue' }) {
  const activeClass = color === 'orange'
    ? 'bg-orange-500 text-white'
    : color === 'cyan'
    ? 'bg-sky-500 text-white'
    : 'bg-blue-600 text-white'
  return (
    <button title={title} onClick={onClick}
      className={`px-2 h-7 min-w-[28px] rounded border text-sm font-medium transition-colors
        ${active
          ? activeClass
          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
        }`}>
      {children}
    </button>
  )
}

export default function NoteEditor() {
  const selectedNoteId         = useScoreStore(s => s.selectedNoteId)
  const selectedPartId         = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex   = useScoreStore(s => s.selectedMeasureIndex)
  const getSelectedNote        = useScoreStore(s => s.getSelectedNote)
  const deleteNote             = useScoreStore(s => s.deleteNote)
  const clearNoteSelection     = useScoreStore(s => s.clearNoteSelection)
  const changeSelectedDuration = useScoreStore(s => s.changeSelectedDuration)
  const fillSelectedRest       = useScoreStore(s => s.fillSelectedRest)
  const chordMode              = useScoreStore(s => s.chordMode)
  const setChordMode           = useScoreStore(s => s.setChordMode)
  const _applyToMeasure        = useScoreStore(s => s._applyToMeasure)

  const note = getSelectedNote()
  if (!note) return null

  const isRest = note.isRest

  // Directly patch non-duration properties
  const setProp = (changes) => {
    _applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
      notes.map(n => n.id === selectedNoteId ? { ...n, ...changes } : n)
    )
  }

  const accentColor = isRest ? 'sky' : 'orange'
  const borderColor = isRest ? 'border-sky-400' : 'border-orange-400'

  return (
    <div className={`bg-gray-50 border-t-2 ${borderColor} px-4 py-2 flex flex-wrap items-center gap-3 flex-shrink-0`}
      style={{ borderBottom: '1px solid #e5e7eb' }}>

      {/* Badge */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md ${isRest ? 'bg-sky-50 border border-sky-200' : 'bg-orange-50 border border-orange-200'}`}>
        <span className={`text-xl leading-none ${isRest ? 'text-sky-500' : 'text-orange-500'}`}>
          {isRest ? '𝄽' : '♩'}
        </span>
        <span className={`font-bold text-sm ${isRest ? 'text-sky-700' : 'text-orange-700'}`}>
          {isRest
            ? `${note.duration}${note.dots?'.':''} rest`
            : `${note.pitch?.step ?? '?'}${ACC_LABEL[note.pitch?.accidental]??''}${note.pitch?.octave ?? ''}`
          }
        </span>
      </div>

      <div className="h-7 w-px bg-gray-300" />

      {/* Duration — works for notes AND rests */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 mr-1">Duration</span>
        {DURATIONS.map(d => (
          <Pill key={d.val} title={d.label} active={note.duration === d.val}
            color={accentColor}
            onClick={() => changeSelectedDuration(d.val, note.dots || 0)}>
            <span className="text-base">{d.sym}</span>
          </Pill>
        ))}
        <Pill title="Dotted" active={!!note.dots} color={accentColor}
          onClick={() => changeSelectedDuration(note.duration, note.dots ? 0 : 1)}>
          <span className="text-lg leading-none">·</span>
        </Pill>
      </div>

      {!isRest && <>
        <div className="h-7 w-px bg-gray-300" />

        {/* Pitch */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Pitch</span>
          {STEPS.map(s => (
            <Pill key={s} active={note.pitch?.step === s} color="orange"
              onClick={() => setProp({ pitch: { ...note.pitch, step: s } })}>
              {s}
            </Pill>
          ))}
        </div>

        <div className="h-7 w-px bg-gray-300" />

        {/* Octave */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Oct</span>
          {OCTAVES.map(o => (
            <Pill key={o} active={note.pitch?.octave === o} color="orange"
              onClick={() => setProp({ pitch: { ...note.pitch, octave: o } })}>
              {o}
            </Pill>
          ))}
        </div>

        <div className="h-7 w-px bg-gray-300" />

        {/* Accidental */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Acc.</span>
          {ACCIDENTALS.map(a => (
            <Pill key={String(a.value)} active={(note.pitch?.accidental ?? null) === a.value} color="orange"
              onClick={() => setProp({ pitch: { ...note.pitch, accidental: a.value } })}>
              {a.label}
            </Pill>
          ))}
        </div>

        <div className="h-7 w-px bg-gray-300" />

        {/* Lyric */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Lyric</span>
          <input value={note.lyric || ''} onChange={e => setProp({ lyric: e.target.value })}
            placeholder="syl-"
            className="border border-gray-300 rounded px-2 h-7 text-sm w-20 outline-none focus:ring-2 focus:ring-orange-300 bg-white" />
        </div>

        <div className="h-7 w-px bg-gray-300" />

        {/* Chord */}
        <Pill active={chordMode} color="blue"
          title="Chord mode — next note stacks on this one (J)"
          onClick={() => setChordMode(!chordMode)}>
          ⊕ Chord
        </Pill>
      </>}

      {isRest && (
        <div className="flex items-center gap-2 text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-3 py-1.5">
          <span>Rest selected.</span>
          <kbd className="bg-white border border-sky-300 px-1.5 py-0.5 rounded font-mono">A–G</kbd>
          <span>or</span>
          <kbd className="bg-white border border-sky-300 px-1.5 py-0.5 rounded font-mono">Enter</kbd>
          <span>to fill with a note. Change duration above first if needed.</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Actions */}
      <div className="flex gap-2">
        {!isRest && (
          <button onClick={() => deleteNote(selectedPartId, selectedMeasureIndex, selectedNoteId)}
            className="border border-red-300 text-red-600 hover:bg-red-50 px-3 h-7 rounded text-xs font-medium transition-colors">
            🗑 Delete
          </button>
        )}
        <button onClick={clearNoteSelection}
          className="border border-gray-300 text-gray-600 hover:bg-gray-100 px-3 h-7 rounded text-xs transition-colors">
          ✕ Deselect
        </button>
      </div>
    </div>
  )
}
