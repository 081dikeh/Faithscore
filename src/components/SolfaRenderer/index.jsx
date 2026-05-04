// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer — SVG-based
// Changes from original:
//   • Beat separators are now dashes (–) not dots (.)
//   • Octave marks: line above syllable for upper (d¹), line below for lower (d₁)
//   • Lyric row rendered inline below each voice row (no modal needed for display)
//   • Clicking a note selects it; selected note highlighted in blue

import { useRef, useEffect, useState } from 'react'
import { useSolfaStore } from '../../store/solfaStore'

// ── LAYOUT CONSTANTS ──────────────────────────────────────────────────────────
const FONT        = '"Times New Roman", Georgia, serif'
const NOTE_SIZE   = 15
const LYRIC_SIZE  = 11
const ROW_H       = 28        // height of note row
const LYRIC_H     = 18        // height of lyric row below each voice
const VOICE_GAP   = 4         // gap between voice blocks
const SYS_GAP     = 44        // gap between systems
const BRACKET_W   = 12
const LABEL_W     = 30
const BAR_PAD_L   = 10
const BAR_PAD_R   = 10
const PAGE_PAD    = 48
const BEAT_W      = 34        // base width per beat slot
const SEP_W       = 14        // width for beat separator dash
const HEADER_H    = 40

// Total height of one voice block (note row + lyric row + gap)
const VOICE_BLOCK_H = ROW_H + LYRIC_H + VOICE_GAP

// ── COLORS ────────────────────────────────────────────────────────────────────
const C = {
  note:      '#1a1a1a',
  rest:      '#c0c8d8',
  sustain:   '#6b7280',
  selected:  '#2563eb',
  selBg:     'rgba(37,99,235,0.10)',
  barline:   '#374151',
  bracket:   '#1e2433',
  label:     '#1e40af',
  lyric:     '#374151',
  lyricLine: '#d1d5db',
  sysLine:   '#e5e7eb',
  mBgEven:   '#fafbfc',
  mBgOdd:    '#f3f4f6',
  dash:      '#9ca3af',   // beat separator dash colour
  octLine:   '#1a1a1a',   // octave mark line colour
}

// ── NOTE SLOT WIDTHS ──────────────────────────────────────────────────────────
function slotW(note) {
  if (!note) return BEAT_W
  if (note.duration >= 2)    return BEAT_W * 2
  if (note.duration === 1)   return BEAT_W
  if (note.duration === 0.5) return BEAT_W * 0.65
  if (note.duration <= 0.25) return BEAT_W * 0.45
  return BEAT_W * note.duration
}

function measureContentW(measure) {
  if (!measure?.notes?.length) return BEAT_W * (measure?.timeSignature?.beats || 4)
  let w = BAR_PAD_L + BAR_PAD_R
  let prevBeat = -1
  for (const n of measure.notes) {
    if (prevBeat >= 0 && n.beatPos > prevBeat) w += SEP_W
    w += slotW(n)
    prevBeat = n.beatPos
  }
  return w
}

// ── SVG PRIMITIVES ────────────────────────────────────────────────────────────
function Barline({x, y1, y2, isDouble=false}) {
  return <>
    <line x1={x} y1={y1} x2={x} y2={y2} stroke={C.barline} strokeWidth={isDouble ? 2.5 : 1.5}/>
    {isDouble && <line x1={x+4} y1={y1} x2={x+4} y2={y2} stroke={C.barline} strokeWidth={1}/>}
  </>
}

function Bracket({x, y, height}) {
  return <g>
    <line x1={x} y1={y} x2={x} y2={y+height} stroke={C.bracket} strokeWidth={2.5} strokeLinecap="round"/>
    <line x1={x} y1={y} x2={x+9} y2={y} stroke={C.bracket} strokeWidth={2} strokeLinecap="round"/>
    <line x1={x} y1={y+height} x2={x+9} y2={y+height} stroke={C.bracket} strokeWidth={2} strokeLinecap="round"/>
  </g>
}

// ── NOTE CELL ─────────────────────────────────────────────────────────────────
// Renders one rhythmic slot: syllable (or rest dot / sustain dash) + octave marks + lyric
function NoteCell({ note, x, y, w, selected, onSelect, onLyricClick }) {
  if (!note) return null

  const isNote    = note.type === 'note'
  const isSustain = note.type === 'sustain'
  const isRest    = note.type === 'rest'
  const cx        = x + w / 2
  const noteY     = y  // baseline of syllable text

  // Colour
  const textCol = selected ? C.selected : isNote ? C.note : isSustain ? C.sustain : C.rest

  // Octave line Y positions
  // Upper octave (octave === 1): thin line ABOVE the syllable
  // Lower octave (octave === -1): thin line BELOW the syllable
  const upperLineY = noteY - NOTE_SIZE - 1   // just above text cap
  const lowerLineY = noteY + 3               // just below text baseline
  const lineX1     = x + 2
  const lineX2     = x + w - 2

  // Lyric row Y
  const lyricY = noteY + ROW_H - 4

  return (
    <g onClick={onSelect} style={{cursor:'pointer'}}>
      {/* Selection highlight */}
      {selected && (
        <rect x={x+1} y={noteY - NOTE_SIZE - 5} width={w-2} height={ROW_H}
          fill={C.selBg} rx={3}/>
      )}

      {/* ── Syllable / sustain / rest ── */}
      {isNote && (
        <text x={cx} y={noteY} textAnchor="middle"
          fontFamily={FONT} fontSize={NOTE_SIZE}
          fontWeight={selected ? 700 : 500}
          fill={textCol}>
          {note.syllable || '?'}
        </text>
      )}

      {/* Sustain: an em-dash centred in the slot */}
      {isSustain && (
        <line x1={x+4} y1={noteY-5} x2={x+w-4} y2={noteY-5}
          stroke={textCol} strokeWidth={1.8} strokeLinecap="round"/>
      )}

      {/* Rest: small hollow circle */}
      {isRest && (
        <circle cx={cx} cy={noteY-6} r={2.5}
          fill="none" stroke={C.rest} strokeWidth={1.2}/>
      )}

      {/* ── Octave marks ── */}
      {/* Upper octave (d¹) — line ABOVE syllable */}
      {isNote && note.octave === 1 && (
        <line x1={lineX1} y1={upperLineY} x2={lineX2} y2={upperLineY}
          stroke={selected ? C.selected : C.octLine} strokeWidth={1.3}/>
      )}
      {/* Lower octave (d₁) — line BELOW syllable */}
      {isNote && note.octave === -1 && (
        <line x1={lineX1} y1={lowerLineY} x2={lineX2} y2={lowerLineY}
          stroke={selected ? C.selected : C.octLine} strokeWidth={1.3}/>
      )}

      {/* ── Lyric ── */}
      <text x={cx} y={lyricY} textAnchor="middle"
        fontFamily={FONT} fontSize={LYRIC_SIZE}
        fill={C.lyric} fontStyle="italic"
        style={{cursor:'text'}}
        onClick={e=>{ e.stopPropagation(); onLyricClick?.() }}>
        {note.lyric || ''}
      </text>
      {/* Lyric underline */}
      <line x1={x+2} y1={lyricY+3} x2={x+w-2} y2={lyricY+3}
        stroke={C.lyricLine} strokeWidth={0.5}/>
    </g>
  )
}

// ── VOICE ROW ─────────────────────────────────────────────────────────────────
function VoiceRow({ part, measures, colXs, colWs, y, selectedNoteId, selectedPartId,
                    onSelect, onLyricClick }) {
  const cells = []

  measures.forEach((measure, mi) => {
    if (!measure) return
    let noteX = colXs[mi] + BAR_PAD_L

    measure.notes.forEach((note, ni) => {
      const w   = slotW(note)
      const sel = note.id === selectedNoteId && part.id === selectedPartId

      // ── Beat separator: a short dash BEFORE each note except the first ──
      // In real solfa notation, a dash appears between beats in the measure.
      // We show a dash at every whole-beat boundary.
      if (ni > 0) {
        const prev    = measure.notes[ni - 1]
        const isWholeBeat = Number.isInteger(note.beatPos) && note.beatPos > 0
        const isHalfBeat  = !isWholeBeat && (note.beatPos * 2) % 1 < 0.01

        if (isWholeBeat) {
          // Full beat separator — dash
          cells.push(
            <text key={`sep-${note.id}`}
              x={noteX - SEP_W / 2} y={y - 5}
              textAnchor="middle" fontFamily={FONT}
              fontSize={13} fontWeight={700}
              fill={C.dash}>
              –
            </text>
          )
        } else if (isHalfBeat) {
          // Half-beat: shorter dash
          cells.push(
            <text key={`sep-${note.id}`}
              x={noteX - SEP_W / 2} y={y - 6}
              textAnchor="middle" fontFamily={FONT}
              fontSize={10} fill={C.dash}>
              ·
            </text>
          )
        }
      }

      cells.push(
        <NoteCell key={note.id}
          note={note} x={noteX} y={y} w={w}
          selected={sel}
          onSelect={()=>onSelect?.(note.id, part.id, mi)}
          onLyricClick={()=>onLyricClick?.(note.id, part.id, mi, note.lyric||'')}
        />
      )
      noteX += w + (ni < measure.notes.length - 1 ? SEP_W : 0)
    })
  })

  return <g>{cells}</g>
}

// ── MAIN RENDERER ─────────────────────────────────────────────────────────────
export default function SolfaRenderer({ onSelectNote, onLyricEdit, playbackBeat }) {
  const wrapRef = useRef(null)
  const [svgW, setSvgW] = useState(900)

  const score          = useSolfaStore(s => s.score)
  const selectedNoteId = useSolfaStore(s => s.selectedNoteId)
  const selectedPartId = useSolfaStore(s => s.selectedPartId)
  const selectNote     = useSolfaStore(s => s.selectNote)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width || 900))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const parts    = score.parts || []
  const numParts = parts.length
  const numM     = Math.max(...parts.map(p=>p.measures.length), 1)
  const beats    = score.timeSignature?.beats || 4

  // ── Measure widths ────────────────────────────────────────────────────────
  const refPart = parts[0]
  const rawMW   = Array.from({length:numM}, (_,i) =>
    measureContentW(refPart?.measures[i] || {notes:[], timeSignature:{beats, beatType:4}})
  )

  // ── Line breaking ─────────────────────────────────────────────────────────
  const leftOffset = PAGE_PAD + BRACKET_W + LABEL_W + 4
  const available  = svgW - leftOffset - PAGE_PAD

  const lines = (() => {
    const ls = []; let start = 0
    while (start < numM) {
      let lineW = 0, count = 0
      for (let i=start; i<numM; i++) {
        if (count > 0 && lineW + rawMW[i] > available) break
        lineW += rawMW[i]; count++
      }
      if (count === 0) count = 1
      ls.push(Array.from({length:count}, (_,i)=>start+i))
      start += count
    }
    return ls
  })()

  // ── Heights ───────────────────────────────────────────────────────────────
  const systemH   = numParts * VOICE_BLOCK_H + SYS_GAP
  const totalSvgH = HEADER_H + lines.length * systemH + 40

  // ── Build SVG ─────────────────────────────────────────────────────────────
  const elems = []
  let sysY = HEADER_H + 24

  // Header
  elems.push(
    <g key="header">
      <text x={PAGE_PAD} y={HEADER_H - 8}
        fontFamily={FONT} fontSize={13} fontStyle="italic" fill="#374151">
        Doh is {score.key}
      </text>
      <text x={PAGE_PAD + 90} y={HEADER_H - 8}
        fontFamily={FONT} fontSize={16} fontWeight={700} fill="#374151">
        {beats}/{score.timeSignature?.beatType || 4}
      </text>
    </g>
  )

  lines.forEach((lineCols, lineIdx) => {
    const lineRawW   = lineCols.reduce((s,c)=>s+rawMW[c], 0)
    const isLastLine = lineIdx === lines.length - 1
    const scale      = (!isLastLine && lineRawW < available && lineRawW > 0)
      ? available / lineRawW : 1
    const colWs = lineCols.map(c => rawMW[c] * scale)

    const colXs = []
    let cx = leftOffset
    for (const w of colWs) { colXs.push(cx); cx += w }

    const lineTop    = sysY - NOTE_SIZE - 6
    const lineBottom = sysY + (numParts - 1) * VOICE_BLOCK_H + LYRIC_H + 6

    // Bracket
    elems.push(<Bracket key={`brk-${lineIdx}`} x={PAGE_PAD+2} y={lineTop} height={lineBottom-lineTop}/>)

    // Opening barline
    elems.push(<Barline key={`obar-${lineIdx}`} x={leftOffset} y1={lineTop} y2={lineBottom}/>)

    // Measure number
    elems.push(
      <text key={`mnum-${lineIdx}`} x={leftOffset+3} y={lineTop-3}
        fontFamily={FONT} fontSize={9} fill="#9ca3af">
        {lineCols[0]+1}
      </text>
    )

    // Each voice
    parts.forEach((part, pIdx) => {
      const rowY = sysY + pIdx * VOICE_BLOCK_H

      // Voice label
      elems.push(
        <text key={`lbl-${lineIdx}-${pIdx}`}
          x={PAGE_PAD + BRACKET_W + 2} y={rowY}
          fontFamily={FONT} fontSize={12} fontWeight={700}
          fill={C.label}>
          {part.label}
        </text>
      )

      // Alternating measure backgrounds
      lineCols.forEach((col, ci) => {
        if (col % 2 !== 0) {
          elems.push(
            <rect key={`mbg-${lineIdx}-${pIdx}-${ci}`}
              x={colXs[ci]} y={rowY - NOTE_SIZE - 5}
              width={colWs[ci]} height={ROW_H + LYRIC_H + 2}
              fill={C.mBgOdd}/>
          )
        }
      })

      // Voice row (notes + lyrics)
      elems.push(
        <VoiceRow key={`row-${lineIdx}-${pIdx}`}
          part={part}
          measures={lineCols.map(c => part.measures[c])}
          colXs={colXs} colWs={colWs}
          y={rowY}
          selectedNoteId={selectedNoteId}
          selectedPartId={selectedPartId}
          onSelect={(noteId, partId, mLocalIdx) => {
            const globalMIdx = lineCols[mLocalIdx]
            selectNote(noteId, partId, globalMIdx)
            onSelectNote?.(noteId, partId, globalMIdx)
          }}
          onLyricClick={(noteId, partId, mLocalIdx, current) => {
            onLyricEdit?.(noteId, partId, lineCols[mLocalIdx], current)
          }}
        />
      )

      // Horizontal separator between voices
      if (pIdx < numParts - 1) {
        const sepY = rowY + ROW_H + LYRIC_H + VOICE_GAP / 2
        elems.push(
          <line key={`hline-${lineIdx}-${pIdx}`}
            x1={leftOffset} y1={sepY}
            x2={leftOffset + colWs.reduce((a,b)=>a+b,0)} y2={sepY}
            stroke={C.sysLine} strokeWidth={0.6}/>
        )
      }
    })

    // Barlines between & after measures
    lineCols.forEach((col, ci) => {
      const bx     = colXs[ci] + colWs[ci]
      const isLast = ci === lineCols.length - 1
      elems.push(
        <Barline key={`bline-${lineIdx}-${ci}`}
          x={bx} y1={lineTop} y2={lineBottom} isDouble={isLast}/>
      )
    })

    sysY += systemH
  })

  return (
    <div ref={wrapRef} style={{width:'100%', overflowX:'auto'}}>
      <svg width={svgW} height={totalSvgH}
        style={{display:'block', fontFamily:FONT, userSelect:'none'}}>
        {elems}
      </svg>
    </div>
  )
}