// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer
//
// NOTATION SPEC (from user spec doc):
//
//  "d"    = 1 full beat       (duration 1.0)
//  ".d"   = half beat         (duration 0.5)  — dot PREFIX, meaning note starts at offset 0 of its slot but only lasts 0.5
//  "d,"   = quarter beat      (duration 0.25) — comma SUFFIX
//  "-"    = sustain/hold dash
//  ":"    = beat separator (between whole beats)
//  "/"    = visual half-beat divider (no timing, readability only)
//  "|"    = barline
//  "||"   = final double barline
//
// HOW THIS MAPS TO OUR STORE MODEL:
//   Every note has { beatPos, duration, type, syllable, octave, lyric }
//   duration 1.0   → full beat  → no prefix/suffix  → "d"
//   duration 0.5   → half beat  → dot prefix         → ".d"
//   duration 0.25  → qtr beat   → comma suffix        → "d,"
//
// RENDERING RULES PER TIME SIGNATURE:
//   Simple  (bottom=4): ":" between every whole beat boundary. "/" at half-beat visual midpoint.
//   Compound(bottom=8): ":" between big beats (groups of 3 quavers = 1.5 crotchets).
//   The "/" is inserted automatically at the midpoint of each full beat (between the two 0.5 slots).
//
// OCTAVE MARKS:
//   octave > 0 → superscript number top-right of syllable (d¹ d²)
//   octave < 0 → subscript number bottom-right of syllable (d₁ d₂)
//
// LYRIC:
//   Always visible on a ruled underline below each voice row.
//   Click to open inline editor (no modal).

import { useRef, useEffect, useState } from 'react'
import { useSolfaStore } from '../../store/solfaStore'

// ── LAYOUT ────────────────────────────────────────────────────────────────────
const FONT     = '"Times New Roman", Georgia, serif'
const NOTE_SZ  = 14
const OCT_SZ   = 8
const LYRIC_SZ = 10
const ROW_H    = 26    // note row height (px from baseline to next row top)
const LYRIC_H  = 17   // lyric row height (px)
const VOICE_G  = 5    // gap between voice blocks
const SYS_GAP  = 44   // gap between systems
const BRAK_W   = 10
const LABEL_W  = 26
const PAGE_L   = 36
const PAGE_R   = 20
const HDR_H    = 42

// Element widths (px, before scaling)
const W_NOTE   = 18   // one syllable cell
const W_COLON  = 9    // ":" beat separator
const W_SLASH  = 7    // "/" visual half-beat divider
const W_DOT    = 5    // "." prefix for half-beat note (drawn as small raised dot)
const W_BAR_PAD= 7    // left + right padding inside each measure

const VOICE_H  = ROW_H + LYRIC_H + VOICE_G

const C = {
  ink:'#111827', hold:'#374151', rest:'#9ca3af',
  sel:'#1d4ed8', selBg:'rgba(29,78,216,0.09)',
  barline:'#1f2937', bracket:'#1f2937', label:'#1e3a8a',
  lyric:'#1f2937', lyricRul:'#9ca3af', voiceSep:'#e5e7eb',
  colon:'#6b7280', slash:'#c0c0c0', dot:'#374151',
  mBgAlt:'#f8f9fa',
}

// ── TOKEN BUILDER ─────────────────────────────────────────────────────────────
// Converts a sorted note array into a flat list of render tokens.
// Token kinds: 'colon' | 'slash' | 'dot' | 'note'
//
// RULE:
//  Between notes:
//    If the previous note ended on a whole-beat boundary AND the new note
//    starts on the next whole beat → emit ":"
//    If both notes share the same whole beat (e.g. both in beat 0, one at
//    0 and one at 0.5) → emit "/" (visual divider, no timing)
//    If current note has duration 0.5 or 0.25 but starts at a non-whole-beat
//    boundary, it was already preceded by "/" or nothing.
//
//  Before each note:
//    If duration === 0.5  → emit a small raised dot "." (half-beat marker)
//    If duration === 0.25 → no prefix (the comma is shown AFTER)
//    After each quarter-beat note → emit ","

function buildTokens(notes) {
  const tokens = []
  if (!notes || notes.length === 0) return tokens

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    const prev = notes[i - 1]

    // ── separator before this note ──────────────────────────────────────────
    if (i > 0) {
      const prevEnd    = Math.round((prev.beatPos + prev.duration) * 1000) / 1000
      const thisStart  = Math.round(note.beatPos * 1000) / 1000
      const prevBeat   = Math.floor(prevEnd)
      const thisBeat   = Math.floor(thisStart)

      const prevEndIsWhole = Math.abs(prevEnd - Math.round(prevEnd)) < 0.001
      const thisStartIsWhole = Math.abs(thisStart - Math.round(thisStart)) < 0.001

      if (prevEndIsWhole && thisStartIsWhole && thisBeat > prevBeat) {
        // Crossed a whole-beat boundary → colon
        tokens.push({ kind:'colon' })
      } else if (prevBeat === thisBeat || (prevEndIsWhole && thisBeat === prevBeat + 1 && !thisStartIsWhole)) {
        // Within the same beat or second half → slash (visual divider)
        // But only if neither note is a full-beat note
        if (prev.duration < 1.0 || note.duration < 1.0) {
          tokens.push({ kind:'slash' })
        } else {
          tokens.push({ kind:'colon' })
        }
      } else {
        tokens.push({ kind:'colon' })
      }
    }

    // ── dot prefix for half-beat notes ───────────────────────────────────────
    if (note.duration === 0.5) {
      tokens.push({ kind:'dot' })
    }

    // ── the note itself ──────────────────────────────────────────────────────
    tokens.push({ kind:'note', note })

    // ── comma suffix for quarter-beat notes ──────────────────────────────────
    if (note.duration <= 0.25) {
      tokens.push({ kind:'comma' })
    }
  }

  return tokens
}

function tokenWidth(token) {
  switch (token.kind) {
    case 'colon': return W_COLON
    case 'slash': return W_SLASH
    case 'dot':   return W_DOT
    case 'comma': return 6
    case 'note':  return W_NOTE
    default:      return 0
  }
}

function measureRawW(notes) {
  if (!notes || notes.length === 0) return W_BAR_PAD * 2 + W_NOTE * 4
  const tokens = buildTokens(notes)
  const inner  = tokens.reduce((s, t) => s + tokenWidth(t), 0)
  return W_BAR_PAD * 2 + inner
}

// ── NOTE CELL ─────────────────────────────────────────────────────────────────
function NoteCell({ note, x, y, w, selected, onSelect, onLyricClick }) {
  if (!note) return null
  const isNote = note.type === 'note'
  const isHold = note.type === 'sustain'
  const ink    = selected ? C.sel : isNote ? C.ink : isHold ? C.hold : 'transparent'
  const cx     = x + w / 2
  const lyricY = y + ROW_H + LYRIC_H - 5

  return (
    <g onClick={onSelect} style={{ cursor:'pointer' }}>
      {selected && (
        <rect x={x} y={y - NOTE_SZ - 2} width={w} height={NOTE_SZ + 5}
          fill={C.selBg} rx={2}/>
      )}

      {/* syllable */}
      {isNote && (
        <text x={cx} y={y} textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ} fontWeight={selected ? 700 : 400} fill={ink}>
          {note.syllable || '?'}
        </text>
      )}

      {/* hold dash */}
      {isHold && (
        <text x={cx} y={y} textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ} fill={ink}>–</text>
      )}

      {/* rest = blank (standard in handwritten solfa) */}

      {/* superscript octave (upper) */}
      {isNote && note.octave > 0 && (
        <text x={x + w - 1} y={y - NOTE_SZ + 2}
          textAnchor="start" fontFamily={FONT}
          fontSize={OCT_SZ} fontWeight={700}
          fill={selected ? C.sel : C.ink}
          dominantBaseline="auto">
          {note.octave}
        </text>
      )}

      {/* subscript octave (lower) */}
      {isNote && note.octave < 0 && (
        <text x={x + w - 1} y={y + 3}
          textAnchor="start" fontFamily={FONT}
          fontSize={OCT_SZ} fontWeight={700}
          fill={selected ? C.sel : C.ink}
          dominantBaseline="hanging">
          {Math.abs(note.octave)}
        </text>
      )}

      {/* lyric text */}
      <text x={cx} y={lyricY} textAnchor="middle" fontFamily={FONT}
        fontSize={LYRIC_SZ} fill={C.lyric} style={{ cursor:'text' }}
        onClick={e => { e.stopPropagation(); onLyricClick?.() }}>
        {note.lyric || ''}
      </text>

      {/* lyric underline — always visible so user knows where to click */}
      <line x1={x} y1={lyricY + 2} x2={x + w} y2={lyricY + 2}
        stroke={C.lyricRul} strokeWidth={0.5}/>
    </g>
  )
}

// ── INLINE LYRIC EDITOR ───────────────────────────────────────────────────────
function InlineLyricEditor({ x, y, w, value, onCommit, onCancel }) {
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30) }, [])
  return (
    <foreignObject x={x - 2} y={y - 1} width={Math.max(w + 6, 60)} height={15}>
      <input ref={ref} defaultValue={value}
        style={{ width:'100%', height:'100%', border:'1px solid #2563eb', borderRadius:2,
          fontSize:10, fontFamily:FONT, padding:'0 2px', boxSizing:'border-box',
          background:'white', color:'#111', outline:'none' }}
        onKeyDown={e => {
          if (e.key==='Enter'||e.key==='Tab') { e.preventDefault(); onCommit(e.target.value) }
          if (e.key==='Escape')               { e.preventDefault(); onCancel() }
        }}
        onBlur={e => onCommit(e.target.value)}
      />
    </foreignObject>
  )
}

// ── MEASURE ROW ───────────────────────────────────────────────────────────────
function MeasureRow({ part, measure, mX, scaledMW, y,
                      selectedNoteId, selectedPartId, onSelect, onLyricClick }) {
  if (!measure) return null

  const notes  = [...(measure.notes||[])].sort((a,b)=>a.beatPos-b.beatPos)
  const tokens = buildTokens(notes)
  const rawInner = tokens.reduce((s,t)=>s+tokenWidth(t),0)
  const rawW   = W_BAR_PAD * 2 + rawInner
  const scale  = rawW > 0 ? scaledMW / rawW : 1

  const cells = []
  let x = mX + W_BAR_PAD * scale

  for (const token of tokens) {
    const tw = tokenWidth(token) * scale

    if (token.kind === 'colon') {
      cells.push(
        <text key={`col-${x.toFixed(1)}`}
          x={x + tw/2} y={y}
          textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ} fill={C.colon}>:</text>
      )
    } else if (token.kind === 'slash') {
      cells.push(
        <text key={`sl-${x.toFixed(1)}`}
          x={x + tw/2} y={y}
          textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ} fill={C.slash}
          opacity={0.5}>/</text>
      )
    } else if (token.kind === 'dot') {
      // Small raised dot "." prefix for half-beat notes
      cells.push(
        <text key={`dot-${x.toFixed(1)}`}
          x={x + tw/2} y={y - 5}
          textAnchor="middle" fontFamily={FONT}
          fontSize={10} fill={C.dot}>.</text>
      )
    } else if (token.kind === 'comma') {
      // Small comma "," suffix for quarter-beat notes
      cells.push(
        <text key={`cm-${x.toFixed(1)}`}
          x={x + tw/2} y={y + 2}
          textAnchor="middle" fontFamily={FONT}
          fontSize={10} fill={C.dot}>,</text>
      )
    } else if (token.kind === 'note') {
      const note = token.note
      const nW   = W_NOTE * scale
      const sel  = note.id === selectedNoteId && part.id === selectedPartId

      cells.push(
        <NoteCell key={note.id} note={note} x={x} y={y} w={nW}
          selected={sel}
          onSelect={() => onSelect?.(note.id, part.id)}
          onLyricClick={() => onLyricClick?.(note.id, part.id, note.lyric||'')}
        />
      )
    }

    x += tw
  }

  return <g>{cells}</g>
}

// ── MAIN RENDERER ─────────────────────────────────────────────────────────────
export default function SolfaRenderer({ onSelectNote }) {
  const wrapRef          = useRef(null)
  const [svgW, setSvgW]  = useState(900)
  const [lyricEdit, setLyricEdit] = useState(null)

  const score          = useSolfaStore(s=>s.score)
  const selectedNoteId = useSolfaStore(s=>s.selectedNoteId)
  const selectedPartId = useSolfaStore(s=>s.selectedPartId)
  const selectNote     = useSolfaStore(s=>s.selectNote)
  const setLyric       = useSolfaStore(s=>s.setLyric)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width||900))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const parts  = score.parts || []
  const numM   = Math.max(...parts.map(p=>p.measures.length), 1)

  // Measure widths from first part's notes
  const rawMWs = Array.from({length:numM}, (_,i) => {
    const notes = parts[0]?.measures[i]?.notes || []
    return measureRawW(notes)
  })

  const leftEdge  = PAGE_L + BRAK_W + LABEL_W
  const available = svgW - leftEdge - PAGE_R

  // Break measures into systems (lines)
  const lines = (() => {
    const ls=[]; let start=0
    while (start < numM) {
      let used=0, count=0
      for (let i=start; i<numM; i++) {
        if (count>0 && used+rawMWs[i]>available) break
        used+=rawMWs[i]; count++
      }
      if (count===0) count=1
      ls.push(Array.from({length:count},(_,i)=>start+i))
      start+=count
    }
    return ls
  })()

  const systemH = parts.length * VOICE_H + SYS_GAP
  const totalH  = HDR_H + lines.length * systemH + 40

  const elems = []
  let sysY = HDR_H + 20

  // Header
  const top    = score.timeSignature?.beats    || 4
  const bottom = score.timeSignature?.beatType || 4
  elems.push(
    <g key="hdr">
      <text x={PAGE_L} y={HDR_H-8} fontFamily={FONT} fontSize={13}
        fontStyle="italic" fill="#374151">
        Doh is {score.key||'C'}
      </text>
      <text x={PAGE_L+88} y={HDR_H-8} fontFamily={FONT} fontSize={17}
        fontWeight={700} fill="#374151">
        {top}/{bottom}
      </text>
    </g>
  )

  lines.forEach((lineCols, lineIdx) => {
    const numCols  = lineCols.length
    const totalRaw = lineCols.reduce((s,c)=>s+rawMWs[c],0)
    const isLast   = lineIdx===lines.length-1
    const lineScale = (!isLast && totalRaw<available && totalRaw>0) ? available/totalRaw : 1

    const colXs = []
    let cx = leftEdge
    lineCols.forEach(c=>{ colXs.push(cx); cx+=rawMWs[c]*lineScale })

    const lineTop    = sysY - NOTE_SZ - 4
    const lineBottom = sysY + (parts.length-1)*VOICE_H + LYRIC_H + 4

    // Bracket
    elems.push(
      <g key={`brk-${lineIdx}`}>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+2}         y2={lineBottom}
          stroke={C.bracket} strokeWidth={2.5} strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+BRAK_W+2} y2={lineTop}
          stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineBottom} x2={PAGE_L+BRAK_W+2} y2={lineBottom}
          stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
      </g>
    )

    // Opening barline
    elems.push(
      <line key={`obar-${lineIdx}`}
        x1={leftEdge} y1={lineTop} x2={leftEdge} y2={lineBottom}
        stroke={C.barline} strokeWidth={1.5}/>
    )

    // Measure number
    elems.push(
      <text key={`mnum-${lineIdx}`} x={leftEdge+2} y={lineTop-2}
        fontFamily={FONT} fontSize={9} fill="#9ca3af">
        {lineCols[0]+1}
      </text>
    )

    // Each voice part
    parts.forEach((part, pIdx) => {
      const rowY = sysY + pIdx*VOICE_H

      // Voice label
      elems.push(
        <text key={`lbl-${lineIdx}-${pIdx}`}
          x={PAGE_L+BRAK_W+2} y={rowY}
          fontFamily={FONT} fontSize={12} fontWeight={700} fill={C.label}>
          {part.label}
        </text>
      )

      // Alternating measure shading
      lineCols.forEach((col,ci)=>{
        if (col%2!==0) {
          elems.push(
            <rect key={`bg-${lineIdx}-${pIdx}-${ci}`}
              x={colXs[ci]} y={rowY-NOTE_SZ-3}
              width={rawMWs[col]*lineScale} height={VOICE_H-VOICE_G}
              fill={C.mBgAlt}/>
          )
        }
      })

      // Measure rows
      lineCols.forEach((col,ci)=>{
        const scaledMW = rawMWs[col]*lineScale
        elems.push(
          <MeasureRow key={`mr-${lineIdx}-${pIdx}-${ci}`}
            part={part}
            measure={part.measures[col]}
            mX={colXs[ci]}
            scaledMW={scaledMW}
            y={rowY}
            selectedNoteId={selectedNoteId}
            selectedPartId={selectedPartId}
            onSelect={(noteId,partId)=>{
              selectNote(noteId,partId,col)
              onSelectNote?.(noteId,partId,col)
              setLyricEdit(null)
            }}
            onLyricClick={(noteId,partId,current)=>{
              // Calculate lyric Y and approximate X for inline editor
              const lyricY   = rowY + ROW_H + LYRIC_H - 7
              const measure  = part.measures[col]
              const notes    = [...(measure?.notes||[])].sort((a,b)=>a.beatPos-b.beatPos)
              const tokens   = buildTokens(notes)
              const rawInner = tokens.reduce((s,t)=>s+tokenWidth(t),0)
              const rawW     = W_BAR_PAD*2 + rawInner
              const sc       = scaledMW/rawW
              let lx = colXs[ci] + W_BAR_PAD*sc
              for (const token of tokens) {
                if (token.kind==='note' && token.note.id===noteId) break
                lx += tokenWidth(token)*sc
              }
              setLyricEdit({noteId,partId,measureIdx:col,x:lx,y:lyricY,w:W_NOTE*sc,current})
            }}
          />
        )
      })

      // Voice separator line
      if (pIdx<parts.length-1) {
        const sepY = rowY+ROW_H+LYRIC_H+VOICE_G/2
        elems.push(
          <line key={`vsep-${lineIdx}-${pIdx}`}
            x1={leftEdge} y1={sepY}
            x2={leftEdge+lineCols.reduce((s,c)=>s+rawMWs[c]*lineScale,0)} y2={sepY}
            stroke={C.voiceSep} strokeWidth={0.6}/>
        )
      }
    })

    // Barlines
    lineCols.forEach((col,ci)=>{
      const bx   = colXs[ci]+rawMWs[col]*lineScale
      const last = ci===numCols-1
      elems.push(
        <line key={`bline-${lineIdx}-${ci}`}
          x1={bx} y1={lineTop} x2={bx} y2={lineBottom}
          stroke={C.barline} strokeWidth={last?2.5:1.5}/>
      )
      if (last) elems.push(
        <line key={`bline2-${lineIdx}`}
          x1={bx+4} y1={lineTop} x2={bx+4} y2={lineBottom}
          stroke={C.barline} strokeWidth={1}/>
      )
    })

    sysY += systemH
  })

  // Inline lyric editor
  if (lyricEdit) {
    elems.push(
      <InlineLyricEditor key="lyric-ed"
        x={lyricEdit.x} y={lyricEdit.y} w={lyricEdit.w} value={lyricEdit.current}
        onCommit={val=>{
          setLyric(lyricEdit.partId,lyricEdit.measureIdx,lyricEdit.noteId,val.trim())
          setLyricEdit(null)
        }}
        onCancel={()=>setLyricEdit(null)}
      />
    )
  }

  return (
    <div ref={wrapRef} style={{width:'100%',overflowX:'auto'}}>
      <svg width={svgW} height={totalH}
        style={{display:'block',fontFamily:FONT,userSelect:'none'}}>
        {elems}
      </svg>
    </div>
  )
}