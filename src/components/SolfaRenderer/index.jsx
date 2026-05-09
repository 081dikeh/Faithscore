// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer — slot-based model
//
// NOTATION RULES:
//
// Each beat has subdivision (1, 2, or 4) and that many slots.
// We render each slot with its notation symbol based on:
//   - Which slot position it is (0,1,2,3)
//   - How many slots are in this beat (subdivision)
//   - Whether it's a note, rest, or sustain
//
// SLOT SYMBOLS (subdivision=2, two half-beat slots):
//   slot 0 (first half):  note→"d."   rest→"."   sustain→"-."
//   slot 1 (second half): note→".d"   rest→"."   sustain→".-"
//
// SLOT SYMBOLS (subdivision=4, four quarter-beat slots):
//   slot 0: note→"d,"    rest→","    sustain→"-,"
//   slot 1: note→",d,"   rest→","    sustain→"-,"
//   slot 2: note→",,d,"  rest→","    sustain→"-,"
//   slot 3: note→",,,d"  rest→","    sustain→"-"
//
// SLOT SYMBOLS (subdivision=1, whole beat):
//   note→"d"    rest→"-"(blank)    sustain→"-"
//
// "/" SEPARATOR: fixed per time signature, inserted after specific beat indices:
//   4/4  → after beat index 1 (after 2nd beat)
//   6/4  → after beat index 2
//   6/8  → after beat index 2
//   9/8  → after beat indices 2 and 5
//   12/8 → after beat indices 2, 5, 8
//   2/4, 3/4, 2/2 → no slash
//
// ":" separator: between every beat (not after slashes, slash replaces colon there)
//
// LAYOUT:
//   Each slot = NOTE_W pixels.
//   Prefix symbols (leading dots/commas) = PREFIX_W each.
//   Suffix symbols (trailing dots/commas) = SUFFIX_W each.
//   Separators (:, /) = SEP_W pixels.
//   Bar padding = PAD each side.

import { useRef, useEffect, useState } from 'react'
import { useSolfaStore, slashPositions, migrateMeasure } from '../../store/solfaStore'

// ── LAYOUT ────────────────────────────────────────────────────────────────────
const FONT      = '"Times New Roman", Georgia, serif'
const NOTE_SZ   = 14
const OCT_SZ    = 8
const LYRIC_SZ  = 10
const SYM_SZ    = 11    // size of prefix/suffix dots and commas
const ROW_H     = 28
const LYRIC_H   = 17
const VOICE_G   = 5
const SYS_GAP   = 46
const BRAK_W    = 10
const LABEL_W   = 26
const PAGE_L    = 36
const PAGE_R    = 20
const HDR_H     = 44
const VOICE_H   = ROW_H + LYRIC_H + VOICE_G

const NOTE_W    = 18   // syllable cell width
const PRE_W     = 5    // width per prefix character (, or .)
const SUF_W     = 5    // width per suffix character
const COLON_W   = 9    // ":" beat separator
const SLASH_W   = 9    // "/" visual grouping separator
const PAD       = 8    // bar left/right padding

const C = {
  ink:'#111827', hold:'#374151', rest:'transparent',
  sel:'#1d4ed8', selBg:'rgba(29,78,216,0.10)',
  barline:'#1f2937', bracket:'#1f2937', label:'#1e3a8a',
  lyric:'#1f2937', lyricRul:'#b0b8c8', voiceSep:'#e5e7eb',
  sep:'#6b7280', slash:'#9ca3af', sym:'#374151',
  mBgAlt:'#f8f9fa',
}

// ── SLOT NOTATION DESCRIPTOR ──────────────────────────────────────────────────
// Returns { prefix, suffix } strings for a slot.
// prefix: characters drawn BEFORE the syllable (raised, small)
// suffix: characters drawn AFTER the syllable (same line, small)
function slotSymbols(slotIdx, subdivision) {
  if (subdivision === 1) {
    return { prefix:'', suffix:'' }
  }
  if (subdivision === 2) {
    // slot 0 = first half → suffix "."    renders as  "d."
    // slot 1 = second half → prefix "."   renders as  ".d"
    if (slotIdx === 0) return { prefix:'', suffix:'.' }
    if (slotIdx === 1) return { prefix:'.', suffix:'' }
  }
  if (subdivision === 4) {
    // slot 0 → "d,"      (Q1 only)
    // slot 1 → ",d,"     (Q2 only)
    // slot 2 → ",,d,"    (Q3 only)
    // slot 3 → ",,,d"    (Q4 only)
    const pre  = ','.repeat(slotIdx)
    const suf  = slotIdx < 3 ? ',' : ''
    return { prefix:pre, suffix:suf }
  }
  return { prefix:'', suffix:'' }
}

// Width of one slot cell including its prefix and suffix
function slotWidth(slotIdx, subdivision) {
  const {prefix,suffix} = slotSymbols(slotIdx,subdivision)
  return prefix.length*PRE_W + NOTE_W + suffix.length*SUF_W
}

// Total raw width of one beat (all slots)
function beatWidth(beat) {
  let w = 0
  for (let si=0; si<beat.subdivision; si++) w += slotWidth(si,beat.subdivision)
  return w
}

// Total raw width of one measure (all beats + separators + padding)
function measureRawW(measure, slashSet) {
  if (!measure) return PAD*2 + NOTE_W*4 + COLON_W*3
  const safe = migrateMeasure(measure)
  const nb = safe.beats.length
  let w = PAD*2
  for (let bi=0; bi<nb; bi++) {
    w += beatWidth(safe.beats[bi])
    if (bi < nb-1) {
      // After this beat: slash or colon
      w += slashSet.has(bi) ? SLASH_W : COLON_W
    }
  }
  return w
}

// ── NOTE CELL ─────────────────────────────────────────────────────────────────
function SlotCell({ slot, x, y, w, prefix, suffix, selected, onSelect, onLyricClick }) {
  if (!slot) return null
  const isNote    = slot.type==='note'
  const isHold    = slot.type==='sustain'
  const isRest    = slot.type==='rest'
  const cx        = x + w/2
  const ink       = selected ? C.sel : isNote ? C.ink : isHold ? C.hold : C.rest
  const lyricY    = y + ROW_H + LYRIC_H - 5

  // Position prefix starts
  const preX = x - prefix.length*PRE_W  // prefix is to the LEFT of x

  return (
    <g onClick={onSelect} style={{cursor:'pointer'}}>
      {/* Selection background */}
      {selected && (
        <rect x={x-1} y={y-NOTE_SZ-2} width={w+2} height={NOTE_SZ+5}
          fill={C.selBg} rx={2}/>
      )}

      {/* Prefix symbols (dots/commas before the note) */}
      {prefix.split('').map((ch,i)=>(
        <text key={`pre${i}`}
          x={x - prefix.length*PRE_W + i*PRE_W + PRE_W/2}
          y={ch==='.'?y-5:y}   // dots raised, commas at baseline
          textAnchor="middle" fontFamily={FONT}
          fontSize={SYM_SZ} fill={C.sym} fontWeight={600}>
          {ch}
        </text>
      ))}

      {/* Suffix symbols (dots/commas after the note) */}
      {suffix.split('').map((ch,i)=>(
        <text key={`suf${i}`}
          x={x+NOTE_W + i*SUF_W + SUF_W/2}
          y={ch==='.'?y-5:y}
          textAnchor="middle" fontFamily={FONT}
          fontSize={SYM_SZ} fill={C.sym} fontWeight={600}>
          {ch}
        </text>
      ))}

      {/* Syllable */}
      {isNote && (
        <text x={cx} y={y} textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ} fontWeight={selected?700:400} fill={ink}>
          {slot.syllable||'?'}
        </text>
      )}

      {/* Hold dash */}
      {isHold && (
        <text x={cx} y={y} textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ} fill={C.hold}>–</text>
      )}

      {/* Rest: small dot in lower position */}
      {isRest && (
        <circle cx={cx} cy={y-3} r={1.5} fill={C.lyricRul}/>
      )}

      {/* Superscript octave */}
      {isNote && slot.octave>0 && (
        <text x={x+NOTE_W-1} y={y-NOTE_SZ+2}
          textAnchor="start" fontFamily={FONT} fontSize={OCT_SZ} fontWeight={700}
          fill={selected?C.sel:C.ink} dominantBaseline="auto">
          {slot.octave}
        </text>
      )}
      {/* Subscript octave */}
      {isNote && slot.octave<0 && (
        <text x={x+NOTE_W-1} y={y+3}
          textAnchor="start" fontFamily={FONT} fontSize={OCT_SZ} fontWeight={700}
          fill={selected?C.sel:C.ink} dominantBaseline="hanging">
          {Math.abs(slot.octave)}
        </text>
      )}

      {/* Lyric */}
      <text x={cx} y={lyricY} textAnchor="middle" fontFamily={FONT}
        fontSize={LYRIC_SZ} fill={C.lyric} style={{cursor:'text'}}
        onClick={e=>{e.stopPropagation();onLyricClick?.()}}>
        {slot.lyric||''}
      </text>
      <line x1={x} y1={lyricY+2} x2={x+w} y2={lyricY+2}
        stroke={C.lyricRul} strokeWidth={0.5}/>
    </g>
  )
}

// ── INLINE LYRIC EDITOR ───────────────────────────────────────────────────────
function InlineLyricEditor({x,y,w,value,onCommit,onCancel}) {
  const ref = useRef(null)
  useEffect(()=>{setTimeout(()=>{ref.current?.focus();ref.current?.select()},30)},[])
  return (
    <foreignObject x={x-2} y={y-1} width={Math.max(w+6,60)} height={15}>
      <input ref={ref} defaultValue={value}
        style={{width:'100%',height:'100%',border:'1px solid #2563eb',borderRadius:2,
          fontSize:10,fontFamily:FONT,padding:'0 2px',boxSizing:'border-box',
          background:'white',color:'#111',outline:'none'}}
        onKeyDown={e=>{
          if (e.key==='Enter'||e.key==='Tab'){e.preventDefault();onCommit(e.target.value)}
          if (e.key==='Escape'){e.preventDefault();onCancel()}
        }}
        onBlur={e=>onCommit(e.target.value)}
      />
    </foreignObject>
  )
}

// ── MEASURE ROW ───────────────────────────────────────────────────────────────
function MeasureRow({part,measure,mX,scaledMW,slashSet,y,
                     selectedPartId,selectedMeasureIdx,selectedBeatIdx,selectedSlotIdx,
                     measureIdx,onSelectSlot,onLyricClick}) {
  if (!measure) return null
  // Migrate old notes[] format to new beats[] format defensively
  const safe = migrateMeasure(measure)
  const rawW = measureRawW(safe, slashSet)
  const sc   = scaledMW / rawW

  const cells = []
  let x = mX + PAD*sc

  safe.beats.forEach((beat,bi)=>{
    // Render each slot of this beat
    beat.slots.forEach((slot,si)=>{
      const {prefix,suffix} = slotSymbols(si,beat.subdivision)
      const preW  = prefix.length*PRE_W*sc
      const noteW = NOTE_W*sc
      const sufW  = suffix.length*SUF_W*sc
      const slotX = x + preW   // note cell starts after prefix

      const isSel = (
        part.id===selectedPartId &&
        measureIdx===selectedMeasureIdx &&
        bi===selectedBeatIdx &&
        si===selectedSlotIdx
      )

      cells.push(
        <SlotCell key={slot.id}
          slot={slot} x={slotX} y={y} w={noteW}
          prefix={prefix} suffix={suffix}
          selected={isSel}
          onSelect={()=>onSelectSlot(part.id,measureIdx,bi,si)}
          onLyricClick={()=>onLyricClick(part.id,measureIdx,bi,si,slot.lyric||'')}
        />
      )
      x += preW+noteW+sufW
    })

    // Separator after beat (not after last beat)
    if (bi < safe.beats.length-1) {
      const isSlash = slashSet.has(bi)
      const sepW    = (isSlash?SLASH_W:COLON_W)*sc
      cells.push(
        <text key={`sep-${bi}`} x={x+sepW/2} y={y}
          textAnchor="middle" fontFamily={FONT}
          fontSize={NOTE_SZ}
          fill={isSlash?C.slash:C.sep}
          opacity={isSlash?0.6:1}>
          {isSlash?'/':':'}
        </text>
      )
      x += sepW
    }
  })

  return <g>{cells}</g>
}

// ── MAIN RENDERER ─────────────────────────────────────────────────────────────
export default function SolfaRenderer({onSelectSlot}) {
  const wrapRef          = useRef(null)
  const [svgW,setSvgW]   = useState(900)
  const [lyricEdit,setLyricEdit] = useState(null)

  const score              = useSolfaStore(s=>s.score)
  const selectedPartId     = useSolfaStore(s=>s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s=>s.selectedMeasureIdx)
  const selectedBeatIdx    = useSolfaStore(s=>s.selectedBeatIdx)
  const selectedSlotIdx    = useSolfaStore(s=>s.selectedSlotIdx)
  const selectSlot         = useSolfaStore(s=>s.selectSlot)
  const setLyric           = useSolfaStore(s=>s.setLyric)

  useEffect(()=>{
    if (!wrapRef.current) return
    const ro = new ResizeObserver(e=>setSvgW(e[0].contentRect.width||900))
    ro.observe(wrapRef.current)
    return ()=>ro.disconnect()
  },[])

  const parts    = score.parts||[]
  const numM     = Math.max(...parts.map(p=>p.measures.length),1)
  const top      = score.timeSignature?.beats||4
  const bottom   = score.timeSignature?.beatType||4
  const slashSet = slashPositions(top,bottom)

  // Compute raw measure widths from first part
  const rawMWs = Array.from({length:numM},(_,i)=>{
    const m = migrateMeasure(parts[0]?.measures[i])
    return measureRawW(m,slashSet)
  })

  const leftEdge  = PAGE_L+BRAK_W+LABEL_W
  const available = svgW-leftEdge-PAGE_R

  // Line-break
  const lines = (()=>{
    const ls=[]; let start=0
    while (start<numM) {
      let used=0,count=0
      for (let i=start;i<numM;i++) {
        if (count>0&&used+rawMWs[i]>available) break
        used+=rawMWs[i]; count++
      }
      if (count===0) count=1
      ls.push(Array.from({length:count},(_,i)=>start+i))
      start+=count
    }
    return ls
  })()

  const systemH = parts.length*VOICE_H+SYS_GAP
  const totalH  = HDR_H+lines.length*systemH+40

  const elems = []
  let sysY = HDR_H+20

  elems.push(
    <g key="hdr">
      <text x={PAGE_L} y={HDR_H-8} fontFamily={FONT} fontSize={13}
        fontStyle="italic" fill="#374151">Doh is {score.key||'C'}</text>
      <text x={PAGE_L+88} y={HDR_H-8} fontFamily={FONT} fontSize={17}
        fontWeight={700} fill="#374151">{top}/{bottom}</text>
    </g>
  )

  lines.forEach((lineCols,lineIdx)=>{
    const numCols   = lineCols.length
    const totalRaw  = lineCols.reduce((s,c)=>s+rawMWs[c],0)
    const isLast    = lineIdx===lines.length-1
    const lineScale = (!isLast&&totalRaw<available&&totalRaw>0)?available/totalRaw:1

    const colXs=[]
    let cx=leftEdge
    lineCols.forEach(c=>{colXs.push(cx);cx+=rawMWs[c]*lineScale})

    const lineTop    = sysY-NOTE_SZ-4
    const lineBottom = sysY+(parts.length-1)*VOICE_H+LYRIC_H+4

    // Bracket
    elems.push(
      <g key={`brk-${lineIdx}`}>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+2}          y2={lineBottom}
          stroke={C.bracket} strokeWidth={2.5} strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+BRAK_W+2}   y2={lineTop}
          stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineBottom} x2={PAGE_L+BRAK_W+2}   y2={lineBottom}
          stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
      </g>
    )

    elems.push(<line key={`obar-${lineIdx}`}
      x1={leftEdge} y1={lineTop} x2={leftEdge} y2={lineBottom}
      stroke={C.barline} strokeWidth={1.5}/>)

    elems.push(<text key={`mnum-${lineIdx}`} x={leftEdge+2} y={lineTop-2}
      fontFamily={FONT} fontSize={9} fill="#9ca3af">{lineCols[0]+1}</text>)

    parts.forEach((part,pIdx)=>{
      const rowY = sysY+pIdx*VOICE_H

      elems.push(<text key={`lbl-${lineIdx}-${pIdx}`}
        x={PAGE_L+BRAK_W+2} y={rowY}
        fontFamily={FONT} fontSize={12} fontWeight={700} fill={C.label}>
        {part.label}
      </text>)

      lineCols.forEach((col,ci)=>{
        if (col%2!==0) elems.push(
          <rect key={`bg-${lineIdx}-${pIdx}-${ci}`}
            x={colXs[ci]} y={rowY-NOTE_SZ-3}
            width={rawMWs[col]*lineScale} height={VOICE_H-VOICE_G}
            fill={C.mBgAlt}/>
        )
      })

      lineCols.forEach((col,ci)=>{
        elems.push(
          <MeasureRow key={`mr-${lineIdx}-${pIdx}-${ci}`}
            part={part}
            measure={part.measures[col]}
            mX={colXs[ci]}
            scaledMW={rawMWs[col]*lineScale}
            slashSet={slashSet}
            y={rowY}
            selectedPartId={selectedPartId}
            selectedMeasureIdx={selectedMeasureIdx}
            selectedBeatIdx={selectedBeatIdx}
            selectedSlotIdx={selectedSlotIdx}
            measureIdx={col}
            onSelectSlot={(partId,mIdx,bi,si)=>{
              selectSlot(partId,mIdx,bi,si)
              onSelectSlot?.(partId,mIdx,bi,si)
              setLyricEdit(null)
            }}
            onLyricClick={(partId,mIdx,bi,si,current)=>{
              const rawM  = part.measures[col]
              const m     = migrateMeasure(rawM)
              const beat  = m?.beats[bi]
              const sc2   = (rawMWs[col]*lineScale)/measureRawW(m,slashSet)
              // Approximate lyric X
              let lx = colXs[ci]+PAD*sc2
              for (let b2=0;b2<bi;b2++) {
                lx+=beatWidth(m.beats[b2])*sc2
                lx+=(slashSet.has(b2)?SLASH_W:COLON_W)*sc2
              }
              if (beat) {
                for (let s2=0;s2<si;s2++) lx+=slotWidth(s2,beat.subdivision)*sc2
                const {prefix}=slotSymbols(si,beat.subdivision)
                lx+=prefix.length*PRE_W*sc2
              }
              const lyricY=rowY+ROW_H+LYRIC_H-7
              setLyricEdit({partId,measureIdx:col,beatIdx:bi,slotIdx:si,
                x:lx,y:lyricY,w:NOTE_W*sc2,current})
            }}
          />
        )
      })

      if (pIdx<parts.length-1) {
        const sepY=rowY+ROW_H+LYRIC_H+VOICE_G/2
        elems.push(<line key={`vsep-${lineIdx}-${pIdx}`}
          x1={leftEdge} y1={sepY}
          x2={leftEdge+lineCols.reduce((s,c)=>s+rawMWs[c]*lineScale,0)} y2={sepY}
          stroke={C.voiceSep} strokeWidth={0.6}/>)
      }
    })

    lineCols.forEach((col,ci)=>{
      const bx  =colXs[ci]+rawMWs[col]*lineScale
      const last=ci===numCols-1
      elems.push(<line key={`bline-${lineIdx}-${ci}`}
        x1={bx} y1={lineTop} x2={bx} y2={lineBottom}
        stroke={C.barline} strokeWidth={last?2.5:1.5}/>)
      if (last) elems.push(<line key={`bline2-${lineIdx}`}
        x1={bx+4} y1={lineTop} x2={bx+4} y2={lineBottom}
        stroke={C.barline} strokeWidth={1}/>)
    })

    sysY+=systemH
  })

  if (lyricEdit) elems.push(
    <InlineLyricEditor key="lyric-ed"
      x={lyricEdit.x} y={lyricEdit.y} w={lyricEdit.w} value={lyricEdit.current}
      onCommit={val=>{
        setLyric(lyricEdit.partId,lyricEdit.measureIdx,lyricEdit.beatIdx,lyricEdit.slotIdx,val.trim())
        setLyricEdit(null)
      }}
      onCancel={()=>setLyricEdit(null)}
    />
  )

  return (
    <div ref={wrapRef} style={{width:'100%',overflowX:'auto'}}>
      <svg width={svgW} height={totalH}
        style={{display:'block',fontFamily:FONT,userSelect:'none'}}>
        {elems}
      </svg>
    </div>
  )
}