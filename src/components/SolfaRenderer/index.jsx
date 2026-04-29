// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer — SVG-based, proper barlines, lyric rows, clickable beats

import { useRef, useEffect, useState, useCallback } from 'react'
import { useSolfaStore } from '../../store/solfaStore'

// ── LAYOUT CONSTANTS ──────────────────────────────────────────────────────────
const FONT       = '"Times New Roman", Georgia, serif'
const NOTE_SIZE  = 15        // px — main syllable font size
const LYRIC_SIZE = 11        // px — lyric font size
const ROW_H      = 26        // px — height of one voice row (note area)
const LYRIC_H    = 16        // px — height of lyric row below each voice
const VOICE_GAP  = 6         // px — extra gap between voice groups in SATB
const SYS_GAP    = 36        // px — gap between systems (line groups)
const BRACKET_W  = 12        // px — left bracket width
const LABEL_W    = 28        // px — voice label column width
const BAR_PAD_L  = 8         // px — padding left inside measure
const BAR_PAD_R  = 8         // px — padding right inside measure
const PAGE_PAD   = 48        // px — left/right page margin
const BEAT_W     = 32        // px — base width per beat slot
const SEP_W      = 10        // px — width of colon beat separator
const HEADER_H   = 36        // px — top header (key + time sig)

// ── COLORS ────────────────────────────────────────────────────────────────────
const C = {
  note:       '#1a1a1a',
  rest:       '#b0b8c8',
  sustain:    '#6b7280',
  selected:   '#2563eb',
  selBg:      'rgba(37,99,235,0.09)',
  hoverBg:    'rgba(37,99,235,0.04)',
  barline:    '#374151',
  bracket:    '#1e2433',
  label:      '#1e40af',
  lyric:      '#374151',
  lyricLine:  '#d1d5db',
  sysLine:    '#e5e7eb',
  measureBg:  '#fafbfc',
  altMeasure: '#f3f4f6',
}

// ── SYLLABLE DISPLAY ──────────────────────────────────────────────────────────
const SYL = { d:'d',de:'de',r:'r',ri:'ri',m:'m',f:'f',fe:'fe',
               s:'s',se:'se',l:'l',ta:'ta',t:'t' }

// Width of a note slot based on syllable and duration
function slotW(note) {
  if (!note) return BEAT_W
  if (note.duration >= 2)   return BEAT_W * 2
  if (note.duration === 1)  return BEAT_W
  if (note.duration === 0.5) return BEAT_W * 0.6
  if (note.duration === 0.25) return BEAT_W * 0.4
  return BEAT_W * note.duration
}

// Total content width of one measure (sum of slot widths + separators)
function measureContentW(measure) {
  if (!measure?.notes?.length) return BEAT_W * (measure?.timeSignature?.beats || 4)
  let w = BAR_PAD_L + BAR_PAD_R
  // Group notes by beat position to count separators
  let prevBeat = -1
  for (const n of measure.notes) {
    if (prevBeat >= 0 && n.beatPos > prevBeat) w += SEP_W  // colon separator
    w += slotW(n)
    prevBeat = n.beatPos
  }
  return w
}

// ── SVG PRIMITIVES ────────────────────────────────────────────────────────────

function Barline({x, y1, y2, double=false}) {
  return <>
    <line x1={x} y1={y1} x2={x} y2={y2}
      stroke={C.barline} strokeWidth={double ? 2 : 1.5} />
    {double && <line x1={x+3} y1={y1} x2={x+3} y2={y2}
      stroke={C.barline} strokeWidth={1} />}
  </>
}

function Bracket({x, y, height}) {
  // Curly-style bracket: vertical line + top/bottom serifs
  const bx = x
  return <g>
    <line x1={bx} y1={y} x2={bx} y2={y+height}
      stroke={C.bracket} strokeWidth={2.5} strokeLinecap="round"/>
    <line x1={bx} y1={y}        x2={bx+8} y2={y}
      stroke={C.bracket} strokeWidth={2} strokeLinecap="round"/>
    <line x1={bx} y1={y+height} x2={bx+8} y2={y+height}
      stroke={C.bracket} strokeWidth={2} strokeLinecap="round"/>
  </g>
}

function OctaveLine({x, y, w, upper}) {
  const lineY = upper ? y-13 : y+3
  return <line x1={x} y1={lineY} x2={x+w-2} y2={lineY}
    stroke={C.note} strokeWidth={1.2}/>
}

// ── NOTE CELL ─────────────────────────────────────────────────────────────────
function NoteCell({note, x, y, w, selected, onSelect, onLyricEdit}) {
  if (!note) return null
  const isNote    = note.type === 'note'
  const isSustain = note.type === 'sustain'
  const text      = isNote ? (SYL[note.syllable] || note.syllable || '?')
                  : isSustain ? '–' : ''
  const textColor = selected ? C.selected
                  : isNote   ? C.note
                  : isSustain? C.sustain
                  : C.rest
  const cx = x + w / 2

  return <g onClick={onSelect} style={{cursor:'pointer'}}>
    {/* Selection/hover background */}
    {selected && <rect x={x+1} y={y-ROW_H+4} width={w-2} height={ROW_H}
      fill={C.selBg} rx={3}/>}

    {/* Main syllable */}
    {isNote && <text x={cx} y={y} textAnchor="middle"
      fontFamily={FONT} fontSize={NOTE_SIZE} fontWeight={selected?700:400}
      fill={textColor}>{text}</text>}

    {/* Sustain dash */}
    {isSustain && <line x1={x+4} y1={y-4} x2={x+w-4} y2={y-4}
      stroke={textColor} strokeWidth={1.5} strokeLinecap="round"/>}

    {/* Rest — small dot */}
    {note.type==='rest' && <circle cx={cx} cy={y-5} r={2} fill={C.rest}/>}

    {/* Octave marks */}
    {isNote && note.octave === 1  && <OctaveLine x={x+2} y={y} w={w-2} upper={true}/>}
    {isNote && note.octave === -1 && <OctaveLine x={x+2} y={y} w={w-2} upper={false}/>}

    {/* Lyric text + underline */}
    <text x={cx} y={y+LYRIC_H-1} textAnchor="middle"
      fontFamily={FONT} fontSize={LYRIC_SIZE} fill={C.lyric}
      fontStyle="italic" style={{cursor:'text'}}
      onClick={e=>{e.stopPropagation();onLyricEdit?.()}}>
      {note.lyric || ''}
    </text>
    {/* Lyric baseline */}
    <line x1={x+2} y1={y+LYRIC_H+1} x2={x+w-2} y2={y+LYRIC_H+1}
      stroke={C.lyricLine} strokeWidth={0.5}/>
  </g>
}

// ── VOICE ROW ─────────────────────────────────────────────────────────────────
// Renders one voice (part) across several measures for one system line
function VoiceRow({part, measures, colXs, colWs, y, selectedNoteId,
                   selectedPartId, onSelect, onLyricEdit}) {
  const cells = []

  measures.forEach((measure, mi) => {
    if (!measure) return
    const mX = colXs[mi]
    let noteX = mX + BAR_PAD_L

    measure.notes.forEach((note, ni) => {
      const w  = slotW(note)
      const sel = note.id === selectedNoteId && part.id === selectedPartId

      // Beat separator colon before each note except the first
      if (ni > 0) {
        const prevBeat = measure.notes[ni-1]
        // Only draw colon at whole-beat boundaries
        if (Math.floor(note.beatPos) > Math.floor(prevBeat.beatPos) ||
            note.beatPos === Math.ceil(prevBeat.beatPos)) {
          cells.push(<text key={`sep-${note.id}`}
            x={noteX - SEP_W/2} y={y-4}
            textAnchor="middle" fontFamily={FONT} fontSize={12}
            fill="#9ca3af">:</text>)
        } else if (note.beatPos - prevBeat.beatPos === 0.5) {
          // Half-beat — dot
          cells.push(<text key={`sep-${note.id}`}
            x={noteX - SEP_W/2} y={y-4}
            textAnchor="middle" fontFamily={FONT} fontSize={10}
            fill="#b0b8c8">.</text>)
        }
      }

      cells.push(<NoteCell key={note.id}
        note={note} x={noteX} y={y} w={w}
        selected={sel}
        onSelect={()=>onSelect?.(note.id, part.id, mi)}
        onLyricEdit={()=>onLyricEdit?.(note.id, part.id, mi, note.lyric||'')}
      />)
      noteX += w + (ni < measure.notes.length-1 ? SEP_W : 0)
    })
  })

  return <g>{cells}</g>
}

// ── MAIN RENDERER ─────────────────────────────────────────────────────────────
export default function SolfaRenderer({onSelectNote, onLyricEdit, playbackBeat}) {
  const wrapRef = useRef(null)
  const [svgW, setSvgW] = useState(900)

  const score            = useSolfaStore(s => s.score)
  const selectedNoteId   = useSolfaStore(s => s.selectedNoteId)
  const selectedPartId   = useSolfaStore(s => s.selectedPartId)
  const selectNote       = useSolfaStore(s => s.selectNote)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width || 900))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const parts     = score.parts || []
  const numParts  = parts.length
  const numM      = Math.max(...parts.map(p=>p.measures.length), 1)
  const beats     = score.timeSignature?.beats || 4

  // ── Calculate measure content widths ────────────────────────────────────────
  const refPart    = parts[0]
  const rawMW      = Array.from({length:numM}, (_,i) =>
    measureContentW(refPart?.measures[i] || {notes:[],timeSignature:{beats,beatType:4}})
  )

  // ── Dynamic line breaking ─────────────────────────────────────────────────
  const leftOffset = PAGE_PAD + BRACKET_W + LABEL_W + 4
  const available  = svgW - leftOffset - PAGE_PAD

  const lines = (() => {
    const ls = []
    let start = 0
    while (start < numM) {
      let lineW = 0, count = 0
      for (let i=start; i<numM; i++) {
        if (count > 0 && lineW + rawMW[i] > available) break
        lineW += rawMW[i]
        count++
      }
      if (count === 0) count = 1
      ls.push(Array.from({length:count}, (_,i) => start+i))
      start += count
    }
    return ls
  })()

  // ── Height per system ─────────────────────────────────────────────────────
  const voiceRowH  = ROW_H + LYRIC_H + 2       // one voice row total height
  const systemH    = numParts * voiceRowH + VOICE_GAP * (numParts-1) + SYS_GAP

  const totalSvgH  = HEADER_H + lines.length * systemH + 40

  // ── BUILD SVG ─────────────────────────────────────────────────────────────
  const elems = []
  let sysY = HEADER_H + 20

  // Header: "Doh is X  |  4/4"
  elems.push(<g key="header">
    <text x={PAGE_PAD} y={HEADER_H-6}
      fontFamily={FONT} fontSize={13} fontStyle="italic" fill="#374151">
      Doh is {score.key}
    </text>
    <text x={PAGE_PAD+90} y={HEADER_H-6}
      fontFamily={FONT} fontSize={15} fontWeight={700} fill="#374151">
      {beats}/{score.timeSignature?.beatType||4}
    </text>
  </g>)

  lines.forEach((lineCols, lineIdx) => {
    const numCols = lineCols.length

    // Scale column widths to fill the line (justify all lines except last)
    const lineRawW  = lineCols.reduce((s,c) => s + rawMW[c], 0)
    const isLastLine = lineIdx === lines.length - 1
    const scale      = (!isLastLine && lineRawW < available && lineRawW > 0)
      ? available / lineRawW : 1
    const colWs = lineCols.map(c => rawMW[c] * scale)

    // X positions
    const colXs = []
    let cx = leftOffset
    for (const w of colWs) { colXs.push(cx); cx += w }

    const lineTop    = sysY - ROW_H + 4
    const lineBottom = sysY + (numParts-1)*(voiceRowH+VOICE_GAP) + LYRIC_H + 4

    // System bracket
    elems.push(<Bracket key={`bracket-${lineIdx}`}
      x={PAGE_PAD+2} y={lineTop} height={lineBottom-lineTop}/>)

    // Opening barline
    elems.push(<Barline key={`obar-${lineIdx}`}
      x={leftOffset} y1={lineTop} y2={lineBottom}/>)

    // Measure number label
    elems.push(<text key={`mnum-${lineIdx}`}
      x={leftOffset+2} y={lineTop-4}
      fontFamily={FONT} fontSize={9} fill="#9ca3af">
      {lineCols[0]+1}
    </text>)

    // Each voice row
    parts.forEach((part, pIdx) => {
      const rowY = sysY + pIdx * (voiceRowH + VOICE_GAP)

      // Voice label
      elems.push(<text key={`lbl-${lineIdx}-${pIdx}`}
        x={PAGE_PAD+BRACKET_W+2} y={rowY}
        fontFamily={FONT} fontSize={12} fontWeight={700}
        fill={C.label} dominantBaseline="auto">
        {part.label}
      </text>)

      // Render each measure for this voice
      const measures = lineCols.map(c => part.measures[c])

      // Measure backgrounds (alternating)
      lineCols.forEach((col, ci) => {
        const bg = col % 2 === 0 ? C.measureBg : C.altMeasure
        if (bg !== C.measureBg) {
          elems.push(<rect key={`mbg-${lineIdx}-${pIdx}-${ci}`}
            x={colXs[ci]} y={rowY-ROW_H+4}
            width={colWs[ci]} height={ROW_H+LYRIC_H+2}
            fill={bg} />)
        }
      })

      elems.push(<VoiceRow key={`row-${lineIdx}-${pIdx}`}
        part={part}
        measures={measures}
        colXs={colXs} colWs={colWs}
        y={rowY}
        selectedNoteId={selectedNoteId}
        selectedPartId={selectedPartId}
        onSelect={(noteId, partId, mIdx) => {
          selectNote(noteId, partId, lineCols[mIdx])
          onSelectNote?.(noteId, partId, lineCols[mIdx])
        }}
        onLyricEdit={(noteId, partId, mIdx, current) => {
          onLyricEdit?.(noteId, partId, lineCols[mIdx], current)
        }}
      />)

      // Horizontal line below each voice row (separates voices)
      if (pIdx < numParts-1) {
        elems.push(<line key={`hline-${lineIdx}-${pIdx}`}
          x1={leftOffset} y1={rowY+LYRIC_H+4}
          x2={leftOffset + colWs.reduce((a,b)=>a+b,0)}
          y2={rowY+LYRIC_H+4}
          stroke={C.sysLine} strokeWidth={0.5}/>)
      }
    })

    // Barlines between and after measures
    lineCols.forEach((col, ci) => {
      const bx = colXs[ci] + colWs[ci]
      const isLast = ci === numCols-1
      elems.push(<Barline key={`bline-${lineIdx}-${ci}`}
        x={bx} y1={lineTop} y2={lineBottom} double={isLast}/>)
    })

    // Playback cursor
    if (playbackBeat !== null && playbackBeat !== undefined) {
      const totalBeatsInLine = lineCols.reduce((s,c) =>
        s + (parts[0]?.measures[c]?.timeSignature?.beats||beats), 0)
      // (cursor position math would go here for full playback integration)
    }

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