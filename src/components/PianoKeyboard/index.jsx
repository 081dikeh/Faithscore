// src/components/PianoKeyboard/index.jsx
import { useState, useCallback } from 'react'
import { useScoreStore } from '../../store/scoreStore'

// ── Piano layout — full 88-key range C1–C8 ──────────────────────────────────
// Each octave has 7 white keys and 5 black keys.
// Black key positions: after C, D, F, G, A (no black after E and B)
const HAS_BLACK_AFTER = [true, true, false, true, true, true, false] // C D E F G A B

function buildKeys() {
  const keys = []
  const octaves = [1,2,3,4,5,6,7]
  const noteNames = ['C','D','E','F','G','A','B']
  
  octaves.forEach(oct => {
    noteNames.forEach((note, i) => {
      // White key
      keys.push({ type: 'white', step: note, acc: null, octave: oct })
      // Black key after this white key (if applicable)
      if (HAS_BLACK_AFTER[i]) {
        const sharpStep = note
        keys.push({ type: 'black', step: sharpStep, acc: '#', octave: oct })
      }
    })
  })
  // Final C8
  keys.push({ type: 'white', step: 'C', acc: null, octave: 8 })
  return keys
}

const ALL_KEYS = buildKeys()
const WHITE_KEYS = ALL_KEYS.filter(k => k.type === 'white')
const BLACK_KEYS = ALL_KEYS.filter(k => k.type === 'black')

// For each black key, compute its left position in terms of white key index
function getBlackKeyPosition(step, acc, octave) {
  // Find which white key index this black key falls between
  const noteNames = ['C','D','E','F','G','A','B']
  const noteIdx = noteNames.indexOf(step)
  // white key index for the note itself
  const octaveOffset = ([1,2,3,4,5,6,7].indexOf(octave)) * 7
  const whiteIdx = octaveOffset + noteIdx
  // Black key sits 0.6 white-keys to the right of its white key
  return whiteIdx + 0.6
}

export default function PianoKeyboard() {
  const [pressedKey, setPressedKey] = useState(null)
  const [hoveredKey, setHoveredKey] = useState(null)

  const inputMode          = useScoreStore(s => s.inputMode)
  const selectedDuration   = useScoreStore(s => s.selectedDuration)
  const selectedDots       = useScoreStore(s => s.selectedDots)
  const selectedPartId     = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex = useScoreStore(s => s.selectedMeasureIndex)
  const selectedNoteId     = useScoreStore(s => s.selectedNoteId)
  const score              = useScoreStore(s => s.score)
  const addNote            = useScoreStore(s => s.addNote)
  const fillSelectedRest   = useScoreStore(s => s.fillSelectedRest)
  const getSelectedNote    = useScoreStore(s => s.getSelectedNote)
  const setSelectedOctave  = useScoreStore(s => s.setSelectedOctave)
  const setSelectedNote    = useScoreStore(s => s.setSelectedNote)

  // Selected note pitch for highlighting
  const selNote = getSelectedNote?.()
  const selPitch = selNote && !selNote.isRest ? selNote.pitch : null

  const isSelected = (step, acc, oct) =>
    selPitch?.step === step &&
    (selPitch?.accidental || null) === (acc || null) &&
    selPitch?.octave === oct

  const keyId = (step, acc, oct) => `${step}${acc||''}${oct}`

  const handleKeyPress = useCallback((step, acc, octave) => {
    const id = keyId(step, acc, octave)
    setPressedKey(id)
    setTimeout(() => setPressedKey(k => k === id ? null : k), 150)

    setSelectedOctave(octave)
    setSelectedNote({ step, accidental: acc || null, label: step + (acc || '') })

    const pitch = { step, octave, accidental: acc || null }
    const currentNote = getSelectedNote?.()

    if (currentNote?.isRest) {
      fillSelectedRest(pitch)
    } else if (selectedMeasureIndex !== null) {
      addNote(selectedPartId, selectedMeasureIndex, {
        pitch, duration: selectedDuration,
        dots: selectedDots || 0, isRest: false,
      })
    }
  }, [selectedDuration, selectedDots, selectedPartId, selectedMeasureIndex,
      addNote, fillSelectedRest, getSelectedNote, setSelectedOctave, setSelectedNote])

  // Dimensions — responsive: fill full width
  const WHITE_W = 'var(--ww)'  // set via CSS variable on container
  const totalWhite = WHITE_KEYS.length  // 52 white keys (C1–C8)

  return (
    <div style={{
      background: '#111',
      borderTop: '3px solid #374151',
      userSelect: 'none',
    }}>
      {/* Octave labels row */}
      <div style={{
        display: 'flex',
        background: '#1a1a2e',
        padding: '2px 0',
        borderBottom: '1px solid #374151',
      }}>
        {[1,2,3,4,5,6,7,8].map(oct => (
          <div key={oct} style={{
            flex: oct < 8 ? 7 : 1,
            textAlign: 'center',
            fontSize: 9,
            color: '#64748b',
            fontFamily: 'monospace',
            fontWeight: 600,
          }}>C{oct}</div>
        ))}
      </div>

      {/* Keys container */}
      <div style={{
        position: 'relative',
        height: 110,
        display: 'flex',
        padding: '0',
        gap: 0,
        background: '#222',
        overflow: 'hidden',
      }}>
        {/* White keys — flex layout fills full width */}
        <div style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          gap: 1,
          padding: '4px 4px 0 4px',
          boxSizing: 'border-box',
        }}>
          {WHITE_KEYS.map((key, i) => {
            const id = keyId(key.step, key.acc, key.octave)
            const pressed  = pressedKey === id
            const selected = isSelected(key.step, key.acc, key.octave)
            const hovered  = hoveredKey === id
            const isC      = key.step === 'C'

            return (
              <div
                key={id}
                onMouseDown={() => handleKeyPress(key.step, key.acc, key.octave)}
                onMouseEnter={() => setHoveredKey(id)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{
                  flex: 1,
                  height: '100%',
                  background: selected ? '#bfdbfe'
                    : pressed  ? '#dbeafe'
                    : hovered  ? '#f8fafc'
                    : 'white',
                  border: '1px solid #9ca3af',
                  borderRadius: '0 0 0 0',
                  cursor: 'pointer',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  paddingBottom: 5,
                  boxSizing: 'border-box',
                  boxShadow: pressed
                    ? 'inset 0 -1px 3px rgba(0,0,0,0.3), inset 0 3px 6px rgba(0,0,0,0.1)'
                    : '0 3px 6px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(0,0,0,0.1)',
                  transition: 'background 0.06s',
                  zIndex: 1,
                }}
              >
                {/* C note labels */}
                {isC && (
                  <span style={{
                    fontSize: 8, fontWeight: 700, lineHeight: 1,
                    color: selected ? '#1d4ed8' : '#9ca3af',
                  }}>
                    C{key.octave}
                  </span>
                )}
                {/* Selected note indicator dot */}
                {selected && (
                  <div style={{
                    position: 'absolute',
                    bottom: 18, left: '50%', transform: 'translateX(-50%)',
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#2563eb',
                  }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Black keys — absolutely positioned over white keys */}
        <div style={{
          position: 'absolute',
          top: 4, left: 4, right: 4,
          height: '63%',
          pointerEvents: 'none',
        }}>
          {/* We use a flex-based approach: render spacers + black keys */}
          <BlackKeyLayer
            whiteCount={totalWhite}
            onPress={handleKeyPress}
            hoveredKey={hoveredKey}
            setHoveredKey={setHoveredKey}
            pressedKey={pressedKey}
            isSelected={isSelected}
          />
        </div>
      </div>
    </div>
  )
}

// Black keys rendered as an SVG overlay — pixel-perfect positioning
function BlackKeyLayer({ whiteCount, onPress, hoveredKey, setHoveredKey, pressedKey, isSelected }) {
  // We use a percentage-based approach with a flex row of slots
  // Each slot = 1 white key width. Black keys span 0.65 of a white key, centered between keys.
  
  // Build the sequence of slots (white key = empty space, black key = rendered)
  const noteNames = ['C','D','E','F','G','A','B']
  const slots = []
  
  ;[1,2,3,4,5,6,7].forEach(oct => {
    noteNames.forEach((note, ni) => {
      // White key slot (empty)
      slots.push({ type: 'space', key: `s-${note}${oct}` })
      // Black key after this note?
      if (HAS_BLACK_AFTER[ni]) {
        slots.push({ type: 'black', step: note, acc: '#', octave: oct })
      }
    })
  })
  // Final C8
  slots.push({ type: 'space', key: 's-C8' })

  // Total slots = 7 notes × 7 octaves + 1 = 50 notes + 5×7 = 35 black key positions + 1
  // Each white key = 2 slots (white + possible black), except E and B = 1 slot
  // Actually simpler: total display width = whiteCount units
  // Black key width = 0.65 white key units, centered between two whites

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100%',
      alignItems: 'stretch',
      pointerEvents: 'none',
    }}>
      {[1,2,3,4,5,6,7].map(oct =>
        noteNames.map((note, ni) => {
          const hasBlack = HAS_BLACK_AFTER[ni]
          return (
            <div key={`oct${oct}-${note}`} style={{
              flex: 1,
              position: 'relative',
              pointerEvents: 'none',
            }}>
              {hasBlack && (() => {
                const id  = `${note}#${oct}`
                const sel = isSelected(note, '#', oct)
                const pressed = pressedKey === id
                const hov = hoveredKey === id
                return (
                  <div
                    onMouseDown={e => { e.stopPropagation(); onPress(note, '#', oct) }}
                    onMouseEnter={() => setHoveredKey(id)}
                    onMouseLeave={() => setHoveredKey(null)}
                    style={{
                      position: 'absolute',
                      right: '-35%',
                      top: 0,
                      width: '70%',
                      height: '100%',
                      background: sel     ? '#3b82f6'
                        : pressed ? '#60a5fa'
                        : hov     ? '#374151'
                        : 'linear-gradient(to bottom, #2d2d2d 0%, #111 60%, #000 100%)',
                      borderRadius: '0 0 0 0',
                      boxShadow: pressed
                        ? 'inset 0 2px 4px rgba(0,0,0,0.8)'
                        : '2px 3px 8px rgba(0,0,0,0.7)',
                      zIndex: 10,
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      paddingBottom: 4,
                      transition: 'background 0.06s',
                    }}
                  >
                    {sel && (
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: 'white', marginBottom: 2,
                      }} />
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })
      )}
      {/* Final C8 — no black key after it */}
      <div style={{ flex: 1 }} />
    </div>
  )
}