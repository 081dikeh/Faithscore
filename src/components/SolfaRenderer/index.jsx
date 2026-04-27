// src/components/SolfaRenderer/index.jsx
// FaithScore — Solfa notation renderer
// Supports 3 layout modes from analysis of real choral solfa scores:
//   1. linear — single voice, measures in rows  (Exultet style)
//   2. satb   — voices stacked per system       (Thank You God / standard SATB)
//   3. grid   — table of measures               (Lead us Home style)

import { useRef, useEffect, useState, useCallback } from 'react'
import { useSolfaStore, SOLFA_SEMITONES } from '../../store/solfaStore'

// ── DISPLAY CONSTANTS ──────────────────────────────────────────────────────────
const FONT_FAMILY   = '"Times New Roman", serif'
const SYLLABLE_W    = 18   // px per beat slot baseline
const ROW_H         = 36   // height of one voice row
const LYRIC_H       = 18   // height of lyric row below voice
const SYSTEM_GAP    = 28   // gap between systems
const PART_GAP      = 4    // gap between stacked voice rows
const BRACKET_W     = 14   // width of SATB bracket on left
const LABEL_W       = 32   // width of voice label (S, A, T, B)
const MEASURE_PAD_L = 6    // left padding inside measure
const MEASURE_PAD_R = 6    // right padding inside measure
const BARLINE_W     = 1
const PAGE_PAD      = 40   // left/right page padding

// ── SYLLABLE DISPLAY NAMES ──────────────────────────────────────────────────
// Traditional solfa uses these exact forms
const SYLLABLE_DISPLAY = {
  d: 'd', de: 'de', r: 'r', ri: 'ri',
  m: 'm', f: 'f', fe: 'fe',
  s: 's', se: 'se', l: 'l', ta: 'ta', t: 't',
}

// ── COLOR SCHEME ───────────────────────────────────────────────────────────────
const COLORS = {
  note:      '#1a1a1a',
  rest:      '#9ca3af',
  sustain:   '#6b7280',
  selected:  '#2563eb',
  barline:   '#374151',
  bracket:   '#374151',
  label:     '#2563eb',
  lyric:     '#374151',
  highlight: '#fef3c7',  // playback highlight
  measureBg: 'transparent',
  selectedBg:'rgba(37,99,235,0.07)',
}

// ── BEAT WIDTH CALCULATION ──────────────────────────────────────────────────────
// Each beat slot gets a width proportional to its content density
function getBeatWidth(note, baseW = SYLLABLE_W) {
  if (!note || note.type === 'rest')    return baseW
  if (note.type === 'sustain')          return baseW * 0.7
  if (note.duration === 0.5)            return baseW * 0.65
  if (note.duration === 0.25)           return baseW * 0.5
  const syl = note.syllable || 'd'
  // Longer syllables (de, ri, fe, se, ta) get extra space
  if (syl.length > 1) return baseW * 1.2
  return baseW
}

// ── MEASURE WIDTH ──────────────────────────────────────────────────────────────
function getMeasureWidth(measure, baseW = SYLLABLE_W) {
  if (!measure || !measure.notes.length) return baseW * measure.timeSignature.beats
  const totalW = measure.notes.reduce((sum, n) => sum + getBeatWidth(n, baseW) * n.duration, 0)
  return Math.max(totalW + MEASURE_PAD_L + MEASURE_PAD_R, baseW * 3)
}

// ── OCTAVE MARK RENDERER (SVG) ──────────────────────────────────────────────────
// Upper octave: overline above syllable
// Lower octave: underline below syllable
function OctaveMark({ x, y, width, type, color }) {
  if (type === 'over') {
    return <line x1={x} y1={y - 12} x2={x + width} y2={y - 12}
      stroke={color} strokeWidth={1.2} />
  }
  if (type === 'under') {
    return <line x1={x} y1={y + 2} x2={x + width} y2={y + 2}
      stroke={color} strokeWidth={1.2} />
  }
  return null
}

// ── SINGLE NOTE CELL ────────────────────────────────────────────────────────────
function NoteCell({ note, x, y, width, isSelected, isPlaying, onClick }) {
  if (!note) return null

  const color = isSelected ? COLORS.selected
              : note.type === 'rest'    ? COLORS.rest
              : note.type === 'sustain' ? COLORS.sustain
              : COLORS.note

  const bg = isSelected ? COLORS.selectedBg
           : isPlaying  ? COLORS.highlight
           : 'transparent'

  const display = note.type === 'note'    ? (SYLLABLE_DISPLAY[note.syllable] || note.syllable)
                : note.type === 'sustain' ? '–'
                : ' '

  const fontSize = note.duration <= 0.25 ? 9
                 : note.duration <= 0.5  ? 10
                 : 12

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      {bg !== 'transparent' && (
        <rect x={x} y={y - ROW_H * 0.7} width={width} height={ROW_H}
          fill={bg} rx={2} />
      )}
      {/* Syllable text */}
      <text x={x + width / 2} y={y} textAnchor="middle"
        fontFamily={FONT_FAMILY} fontSize={fontSize} fill={color}
        fontWeight={isSelected ? 700 : 400}>
        {display}
      </text>
      {/* Octave marks */}
      {note.overline  && <OctaveMark x={x + 2} y={y - 2} width={width - 4} type="over"  color={color} />}
      {note.underline && <OctaveMark x={x + 2} y={y + 1} width={width - 4} type="under" color={color} />}
      {/* Lyric */}
      {note.lyric && (
        <text x={x + width / 2} y={y + LYRIC_H} textAnchor="middle"
          fontFamily={FONT_FAMILY} fontSize={9} fill={COLORS.lyric} fontStyle="italic">
          {note.lyric}
        </text>
      )}
    </g>
  )
}

// ── BEAT SEPARATOR (the ':' colon between beats) ───────────────────────────────
function BeatSep({ x, y, height, isHalf }) {
  return (
    <text x={x} y={y - height / 4} textAnchor="middle"
      fontFamily={FONT_FAMILY} fontSize={isHalf ? 8 : 10} fill="#9ca3af">
      {isHalf ? '.' : ':'}
    </text>
  )
}

// ── BARLINE ─────────────────────────────────────────────────────────────────────
function Barline({ x, y, height, isDouble }) {
  return (
    <g>
      <line x1={x} y1={y - height + 4} x2={x} y2={y + 2}
        stroke={COLORS.barline} strokeWidth={isDouble ? 2 : 1} />
      {isDouble && (
        <line x1={x + 3} y1={y - height + 4} x2={x + 3} y2={y + 2}
          stroke={COLORS.barline} strokeWidth={1} />
      )}
    </g>
  )
}

// ── VOICE ROW RENDERER ──────────────────────────────────────────────────────────
// Renders one voice's measures across a system line
function VoiceRow({ part, measures, startX, y, colWidths, selectedNoteId, onSelectNote }) {
  const cells = []
  let curX = startX + MEASURE_PAD_L

  measures.forEach((measure, mIdx) => {
    const mW = colWidths[mIdx]

    // Draw notes in this measure
    let noteX = curX
    measure.notes.forEach((note, nIdx) => {
      const nW = getBeatWidth(note) * note.duration
      const isSelected = note.id === selectedNoteId

      cells.push(
        <NoteCell key={note.id}
          note={note} x={noteX} y={y}
          width={nW} isSelected={isSelected}
          onClick={() => onSelectNote?.(note.id, part.id, mIdx)}
        />
      )

      // Beat separator colon between beats (not after last)
      const isLastInMeasure = nIdx === measure.notes.length - 1
      if (!isLastInMeasure) {
        const sepX = noteX + nW
        cells.push(
          <BeatSep key={`sep-${note.id}`}
            x={sepX + 3} y={y} height={ROW_H}
            isHalf={note.duration === 0.5 || measure.notes[nIdx+1]?.duration === 0.5}
          />
        )
      }
      noteX += nW + (isLastInMeasure ? 0 : 6)
    })

    curX += mW
    // Barline at end of measure
    cells.push(
      <Barline key={`bar-${mIdx}`}
        x={curX} y={y} height={ROW_H}
        isDouble={mIdx === measures.length - 1}
      />
    )
  })

  return <g>{cells}</g>
}

// ── SATB BRACKET ────────────────────────────────────────────────────────────────
function SatbBracket({ x, y, height }) {
  const bx = x - BRACKET_W
  return (
    <g>
      {/* Vertical line */}
      <line x1={bx + BRACKET_W - 2} y1={y - ROW_H + 6}
            x2={bx + BRACKET_W - 2} y2={y + height}
        stroke={COLORS.bracket} strokeWidth={2} />
      {/* Top serif */}
      <line x1={bx + 2} y1={y - ROW_H + 6}
            x2={bx + BRACKET_W - 1} y2={y - ROW_H + 6}
        stroke={COLORS.bracket} strokeWidth={2} />
      {/* Bottom serif */}
      <line x1={bx + 2} y1={y + height}
            x2={bx + BRACKET_W - 1} y2={y + height}
        stroke={COLORS.bracket} strokeWidth={2} />
    </g>
  )
}

// ── MAIN RENDERER ────────────────────────────────────────────────────────────────
export default function SolfaRenderer() {
  const svgRef    = useRef(null)
  const wrapRef   = useRef(null)
  const [dims, setDims] = useState({ w: 800 })

  const score            = useSolfaStore(s => s.score)
  const selectedNoteId   = useSolfaStore(s => s.selectedNoteId)
  const selectedPartId   = useSolfaStore(s => s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s => s.selectedMeasureIdx)
  const selectNote       = useSolfaStore(s => s.selectNote)
  const selectMeasure    = useSolfaStore(s => s.selectMeasure)

  // Measure container width
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      setDims({ w: entries[0].contentRect.width || 800 })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const layout    = score.layout || 'satb'
  const parts     = score.parts  || []
  const numM      = Math.max(...parts.map(p => p.measures.length), 1)
  const usableW   = dims.w - PAGE_PAD * 2

  // ── LAYOUT: how many measures fit per line ───────────────────────────────────
  const BASE_W  = SYLLABLE_W
  const measW   = (m) => getMeasureWidth(m, BASE_W)

  // Build lines: array of { measureIndices: number[] }
  const buildLines = useCallback(() => {
    const refPart = parts[0]
    if (!refPart) return [{ cols: [0] }]

    const lines = []
    let start   = 0
    let left    = layout === 'satb'   ? BRACKET_W + LABEL_W + 4
                : layout === 'linear' ? LABEL_W + 4
                : 0
    const available = usableW - left

    while (start < numM) {
      let lineW = 0
      let count = 0
      for (let i = start; i < numM; i++) {
        const mw = measW(refPart.measures[i] || { notes: [], timeSignature: { beats: 4, beatType: 4 } })
        if (count > 0 && lineW + mw > available) break
        lineW += mw
        count++
      }
      if (count === 0) count = 1
      lines.push({ cols: Array.from({ length: count }, (_, i) => start + i) })
      start += count
    }
    return lines
  }, [parts, numM, usableW, layout])

  const lines = buildLines()

  // ── CALCULATE SVG HEIGHT ─────────────────────────────────────────────────────
  const partCount  = parts.length
  const systemH = layout === 'satb'
    ? partCount * (ROW_H + PART_GAP) + LYRIC_H + SYSTEM_GAP
    : layout === 'linear'
    ? ROW_H + LYRIC_H + SYSTEM_GAP
    : partCount * (ROW_H + PART_GAP) + LYRIC_H + SYSTEM_GAP

  const totalH = lines.length * systemH + 60

  // ── RENDER ──────────────────────────────────────────────────────────────────
  const svgElements = []
  let   sysY = 40

  lines.forEach((line, lineIdx) => {
    const { cols } = line

    // Column widths for this line — scale up to fill available width
    const refPart   = parts[0]
    const rawWidths = cols.map(c =>
      measW(refPart?.measures[c] || { notes: [], timeSignature: { beats: 4, beatType: 4 } })
    )
    const rawTotal  = rawWidths.reduce((a, b) => a + b, 0)
    const left      = layout === 'satb'   ? PAGE_PAD + BRACKET_W + LABEL_W + 4
                    : layout === 'linear' ? PAGE_PAD + LABEL_W + 4
                    : PAGE_PAD
    const available = dims.w - left - PAGE_PAD
    const isLastLine = lineIdx === lines.length - 1
    const justScale  = (!isLastLine && rawTotal < available) ? available / rawTotal : 1
    const colWidths  = rawWidths.map(w => w * justScale)

    // Opening barline
    const barX = left
    svgElements.push(
      <line key={`obar-${lineIdx}`}
        x1={barX} y1={sysY - ROW_H + 6}
        x2={barX} y2={sysY + (partCount - 1) * (ROW_H + PART_GAP) + 2}
        stroke={COLORS.barline} strokeWidth={1} />
    )

    // Measure number
    svgElements.push(
      <text key={`mnum-${lineIdx}`}
        x={left + 2} y={sysY - ROW_H - 2}
        fontFamily={FONT_FAMILY} fontSize={9} fill="#9ca3af">
        {cols[0] + 1}
      </text>
    )

    if (layout === 'satb') {
      // ── SATB bracket + voice labels ───────────────────────────────────────
      const bracketH = (partCount - 1) * (ROW_H + PART_GAP) + ROW_H
      svgElements.push(
        <SatbBracket key={`bracket-${lineIdx}`}
          x={PAGE_PAD + BRACKET_W} y={sysY} height={bracketH - ROW_H} />
      )

      parts.forEach((part, pIdx) => {
        const rowY = sysY + pIdx * (ROW_H + PART_GAP)

        // Voice label
        svgElements.push(
          <text key={`lbl-${lineIdx}-${pIdx}`}
            x={PAGE_PAD + BRACKET_W + 2} y={rowY}
            fontFamily={FONT_FAMILY} fontSize={11} fontWeight={700}
            fill={COLORS.label} textAnchor="start">
            {part.voiceLabel || part.name[0]}
          </text>
        )

        // The measures for this voice in this line
        const lineMeasures = cols.map(c => part.measures[c] || { id: '', notes: [], timeSignature: { beats: 4, beatType: 4 } })

        svgElements.push(
          <VoiceRow key={`row-${lineIdx}-${pIdx}`}
            part={part}
            measures={lineMeasures}
            startX={left}
            y={rowY}
            colWidths={colWidths}
            selectedNoteId={selectedNoteId}
            onSelectNote={(noteId, partId, mIdx) => {
              selectNote(noteId)
              selectMeasure(partId, cols[mIdx])
            }}
          />
        )
      })

    } else if (layout === 'linear') {
      // ── LINEAR: single voice per system row ──────────────────────────────
      const part         = parts[0]
      const lineMeasures = cols.map(c => part?.measures[c] || { notes: [], timeSignature: { beats:4, beatType:4 } })

      // Voice label
      svgElements.push(
        <text key={`lbl-${lineIdx}`}
          x={PAGE_PAD + 2} y={sysY}
          fontFamily={FONT_FAMILY} fontSize={11} fontWeight={700}
          fill={COLORS.label}>
          {part?.voiceLabel || ''}
        </text>
      )

      svgElements.push(
        <VoiceRow key={`row-${lineIdx}`}
          part={part}
          measures={lineMeasures}
          startX={left} y={sysY}
          colWidths={colWidths}
          selectedNoteId={selectedNoteId}
          onSelectNote={(noteId, partId, mIdx) => {
            selectNote(noteId)
            selectMeasure(partId, cols[mIdx])
          }}
        />
      )

    } else if (layout === 'grid') {
      // ── GRID: all voices stacked, measures in columns (table style) ───────
      parts.forEach((part, pIdx) => {
        const rowY = sysY + pIdx * (ROW_H + PART_GAP)
        const lineMeasures = cols.map(c => part.measures[c] || { notes:[], timeSignature:{beats:4,beatType:4} })

        // Voice label column
        svgElements.push(
          <text key={`glbl-${lineIdx}-${pIdx}`}
            x={PAGE_PAD + 2} y={rowY}
            fontFamily={FONT_FAMILY} fontSize={10} fontWeight={700}
            fill={COLORS.label}>
            {part.voiceLabel || part.name[0]}
          </text>
        )

        svgElements.push(
          <VoiceRow key={`grow-${lineIdx}-${pIdx}`}
            part={part}
            measures={lineMeasures}
            startX={left} y={rowY}
            colWidths={colWidths}
            selectedNoteId={selectedNoteId}
            onSelectNote={(noteId, partId, mIdx) => {
              selectNote(noteId)
              selectMeasure(partId, cols[mIdx])
            }}
          />
        )
      })

      // Horizontal grid lines between systems
      const gridLineY = sysY + partCount * (ROW_H + PART_GAP) + 4
      svgElements.push(
        <line key={`grid-h-${lineIdx}`}
          x1={PAGE_PAD} y1={gridLineY}
          x2={dims.w - PAGE_PAD} y2={gridLineY}
          stroke="#d1d5db" strokeWidth={0.5} />
      )
    }

    sysY += systemH
  })

  // ── KEY + TIME SIG HEADER ──────────────────────────────────────────────────
  const headerElements = (
    <g>
      <text x={PAGE_PAD} y={22}
        fontFamily={FONT_FAMILY} fontSize={12} fill="#374151" fontStyle="italic">
        Doh is {score.key}
      </text>
      <text x={PAGE_PAD + 80} y={22}
        fontFamily={FONT_FAMILY} fontSize={12} fill="#374151">
        {score.timeSignature?.beats}/{score.timeSignature?.beatType}
      </text>
    </g>
  )

  return (
    <div ref={wrapRef} style={{ width: '100%', overflowX: 'auto' }}>
      <svg ref={svgRef}
        width={dims.w} height={Math.max(totalH, 200)}
        style={{ display: 'block', fontFamily: FONT_FAMILY }}>
        {headerElements}
        {svgElements}
      </svg>
    </div>
  )
}