// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer
//
// NOTATION (matching handwritten samples exactly):
//
//  d :r / :m :f       4/4 — colon before each beat, slash at midpoint
//  d.r :m :f          beat 1 split into 2 halves with dot connector
//  d,r,m,f :s :l :t   beat 1 split into 4 quarters with comma connector
//  d. , :r            beat 1 is 3/4 beat (half+quarter): "d. ," 
//                     slot 0=half (d.), slot 1=quarter (,)
//
//  SLASH "/" position:
//    - Stored in slashSet as the beat index AFTER which the slash appears.
//    - When rendering beat bi, IF slashSet.has(bi-1) THEN use "/" ELSE use ":"
//    - 4/4: slashSet={1} → slash before beat idx 2 (the 3rd beat)
//      Result: d :r / :m :f  ✓
//
//  LYRIC INPUT:
//    Click the underline below any note slot → inline text input appears.
//    Press Enter or Tab to confirm, Escape to cancel.

import { useRef, useEffect, useState } from 'react'
import { useSolfaStore, slashPositions, slotConnector, migrateMeasure } from '../../store/solfaStore'

// ── LAYOUT ────────────────────────────────────────────────────────────────────
const FONT     = '"Times New Roman", Georgia, serif'
const NOTE_SZ  = 14
const OCT_SZ   = 8
const LYRIC_SZ = 10
const CON_SZ   = 11

const ROW_H    = 26
const LYRIC_H  = 17
const VOICE_G  = 5
const SYS_GAP  = 46
const BRAK_W   = 10
const LABEL_W  = 26
const PAGE_L   = 36
const PAGE_R   = 20
const HDR_H    = 44
const VOICE_H  = ROW_H + LYRIC_H + VOICE_G

const NOTE_W   = 18   // syllable cell
const OCT_W    = 5    // space for octave mark right of syllable
const CON_W    = 6    // connector (. or ,) between slots
const COLON_W  = 9    // ":" separator
const SLASH_W  = 10   // "/" separator
const PAD      = 8    // bar padding each side

const C = {
  ink:'#111827', hold:'#6b7280', rest:'#aab0bc',
  sel:'#1d4ed8', selBg:'rgba(29,78,216,0.10)',
  barline:'#1f2937', bracket:'#1f2937', label:'#1e3a8a',
  lyric:'#374151', lyricRul:'#b0b8c8', voiceSep:'#e5e7eb',
  colon:'#4b5563', slash:'#9ca3af', connector:'#374151',
  mBgAlt:'#f8f9fa',
}

// Width of one slot cell (note + space for octave mark)
const SLOT_W = NOTE_W + OCT_W

// Width of a beat: slots + connectors between them
// specialSub='3q': 2 slots but first is double-width (half+quarter = 2+1 units)
function beatWidth(beat) {
  if (!beat) return SLOT_W
  const sub = beat.subdivision||1
  if (beat.specialSub==='3q') {
    // 2 slots: [half-slot=NOTE_W*2+OCT_W, quarter-slot=NOTE_W+OCT_W], 1 connector
    return (NOTE_W*2+OCT_W) + CON_W + SLOT_W
  }
  return sub*SLOT_W + Math.max(0,sub-1)*CON_W
}

// Width of one measure
function measureWidth(measure, slashSet) {
  if (!measure?.beats) return PAD*2 + SLOT_W*4 + COLON_W*3
  const nb=measure.beats.length
  let w=PAD*2
  for (let bi=0;bi<nb;bi++) {
    w+=beatWidth(measure.beats[bi])
    if (bi<nb-1) {
      // The separator AFTER beat bi:
      // slash if slashSet contains bi (slash appears AFTER beat index bi)
      w+=slashSet.has(bi)?SLASH_W:COLON_W
    }
  }
  return w
}

// ── INLINE LYRIC EDITOR ───────────────────────────────────────────────────────
function InlineLyricEditor({x,y,w,value,onCommit,onCancel}) {
  const ref=useRef(null)
  useEffect(()=>{setTimeout(()=>{ref.current?.focus();ref.current?.select()},30)},[])
  return (
    <foreignObject x={x-2} y={y-1} width={Math.max(w+6,60)} height={15}>
      <input ref={ref} defaultValue={value}
        style={{width:'100%',height:'100%',border:'1px solid #2563eb',borderRadius:2,
          fontSize:10,fontFamily:FONT,padding:'0 2px',boxSizing:'border-box',
          background:'white',color:'#111',outline:'none'}}
        onKeyDown={e=>{
          if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();onCommit(e.target.value)}
          if(e.key==='Escape'){e.preventDefault();onCancel()}
        }}
        onBlur={e=>onCommit(e.target.value)}
      />
    </foreignObject>
  )
}

// ── RENDER ONE SLOT ───────────────────────────────────────────────────────────
function renderSlot({slot, x, y, w, isSel, partId, col, bi, si,
                     selectSlot, onSelectSlot, setLyricEdit, elems, slotKey}) {
  const isNote=slot.type==='note'
  const isHold=slot.type==='sustain'
  const isRest=slot.type==='rest'
  const cx=x+w/2
  const ink=isSel?C.sel:isNote?C.ink:isHold?C.hold:C.rest
  const lyricY=y+ROW_H+LYRIC_H-5

  // Selection highlight
  if (isSel) elems.push(
    <rect key={`sel-${slotKey}`} x={x-1} y={y-NOTE_SZ-2} width={w+2} height={NOTE_SZ+5}
      fill={C.selBg} rx={2}/>
  )

  // Invisible click target (always full size for easy clicking)
  elems.push(
    <rect key={`hit-${slotKey}`} x={x} y={y-NOTE_SZ-2} width={w} height={NOTE_SZ+5}
      fill="transparent" style={{cursor:'pointer'}}
      onClick={()=>{selectSlot(partId,col,bi,si);onSelectSlot?.(partId,col,bi,si);}}
    />
  )

  // Syllable / hold / rest
  if (isNote) {
    elems.push(
      <text key={`n-${slotKey}`} x={cx} y={y} textAnchor="middle"
        fontFamily={FONT} fontSize={NOTE_SZ} fontWeight={isSel?700:400} fill={ink}
        style={{cursor:'pointer',pointerEvents:'none'}}>
        {slot.syllable||'?'}
      </text>
    )
  } else {
    // Hold and rest both render as "–", rest is lighter
    elems.push(
      <text key={`d-${slotKey}`} x={cx} y={y} textAnchor="middle"
        fontFamily={FONT} fontSize={NOTE_SZ} fill={ink}
        style={{cursor:'pointer',pointerEvents:'none'}}>
        –
      </text>
    )
  }

  // Octave mark
  if (isNote&&slot.octave!==0) {
    const octX=x+NOTE_W
    const octY=slot.octave>0?y-NOTE_SZ+2:y+3
    elems.push(
      <text key={`oct-${slotKey}`} x={octX} y={octY}
        textAnchor="start" fontFamily={FONT} fontSize={OCT_SZ} fontWeight={700}
        fill={isSel?C.sel:C.ink}
        dominantBaseline={slot.octave>0?'auto':'hanging'}
        style={{pointerEvents:'none'}}>
        {Math.abs(slot.octave)}
      </text>
    )
  }

  // Lyric text — click to edit
  elems.push(
    <text key={`ly-${slotKey}`} x={cx} y={lyricY} textAnchor="middle"
      fontFamily={FONT} fontSize={LYRIC_SZ} fill={C.lyric} style={{cursor:'text'}}
      onClick={e=>{
        e.stopPropagation()
        setLyricEdit({partId,measureIdx:col,beatIdx:bi,slotIdx:si,
          x,y:lyricY,w,current:slot.lyric||''})
      }}>
      {slot.lyric||''}
    </text>
  )

  // Lyric underline (always visible — shows it's clickable)
  elems.push(
    <line key={`lu-${slotKey}`}
      x1={x} y1={lyricY+2} x2={x+w} y2={lyricY+2}
      stroke={C.lyricRul} strokeWidth={0.5}/>
  )
}

// ── MAIN RENDERER ─────────────────────────────────────────────────────────────
export default function SolfaRenderer({onSelectSlot}) {
  const wrapRef         = useRef(null)
  const [svgW,setSvgW]  = useState(900)
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
    const ro=new ResizeObserver(e=>setSvgW(e[0].contentRect.width||900))
    ro.observe(wrapRef.current)
    return ()=>ro.disconnect()
  },[])

  const parts    = score.parts||[]
  const numM     = Math.max(...parts.map(p=>p.measures.length),1)
  const topNum   = score.timeSignature?.beats||4
  const botNum   = score.timeSignature?.beatType||4
  // slashSet: Set of beat indices AFTER which "/" appears
  const slashSet = slashPositions(topNum,botNum)

  const rawMWs=Array.from({length:numM},(_,i)=>{
    const m=migrateMeasure(parts[0]?.measures[i])
    return measureWidth(m,slashSet)
  })

  const leftEdge  = PAGE_L+BRAK_W+LABEL_W
  const available = svgW-leftEdge-PAGE_R

  const lines=(()=>{
    const ls=[]; let start=0
    while(start<numM){
      let used=0,count=0
      for(let i=start;i<numM;i++){
        if(count>0&&used+rawMWs[i]>available) break
        used+=rawMWs[i]; count++
      }
      if(count===0) count=1
      ls.push(Array.from({length:count},(_,i)=>start+i))
      start+=count
    }
    return ls
  })()

  const systemH=parts.length*VOICE_H+SYS_GAP
  const totalH  =HDR_H+lines.length*systemH+40

  const elems=[]
  let sysY=HDR_H+20

  // ── Header ─────────────────────────────────────────────────────────────────
  elems.push(
    <g key="hdr">
      <text x={PAGE_L} y={HDR_H-8} fontFamily={FONT} fontSize={13}
        fontStyle="italic" fill="#374151">Doh is {score.key||'C'}</text>
      <text x={PAGE_L+88} y={HDR_H-8} fontFamily={FONT} fontSize={17}
        fontWeight={700} fill="#374151">{topNum}/{botNum}</text>
    </g>
  )

  lines.forEach((lineCols,lineIdx)=>{
    const numCols  = lineCols.length
    const totalRaw = lineCols.reduce((s,c)=>s+rawMWs[c],0)
    const isLast   = lineIdx===lines.length-1
    const lineScale= (!isLast&&totalRaw<available&&totalRaw>0)?available/totalRaw:1

    const colXs=[]; let cx=leftEdge
    lineCols.forEach(c=>{colXs.push(cx);cx+=rawMWs[c]*lineScale})

    const lineTop    = sysY-NOTE_SZ-4
    const lineBottom = sysY+(parts.length-1)*VOICE_H+LYRIC_H+4

    // Bracket
    elems.push(
      <g key={`brk-${lineIdx}`}>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+2}         y2={lineBottom} stroke={C.bracket} strokeWidth={2.5} strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+BRAK_W+2} y2={lineTop}    stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineBottom} x2={PAGE_L+BRAK_W+2} y2={lineBottom} stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
      </g>
    )
    elems.push(<line key={`obar-${lineIdx}`} x1={leftEdge} y1={lineTop} x2={leftEdge} y2={lineBottom} stroke={C.barline} strokeWidth={1.5}/>)
    elems.push(<text key={`mnum-${lineIdx}`} x={leftEdge+2} y={lineTop-2} fontFamily={FONT} fontSize={9} fill="#9ca3af">{lineCols[0]+1}</text>)

    // ── Each voice ────────────────────────────────────────────────────────────
    parts.forEach((part,pIdx)=>{
      const rowY=sysY+pIdx*VOICE_H

      elems.push(
        <text key={`lbl-${lineIdx}-${pIdx}`} x={PAGE_L+BRAK_W+2} y={rowY}
          fontFamily={FONT} fontSize={12} fontWeight={700} fill={C.label}>
          {part.label}
        </text>
      )

      lineCols.forEach((col,ci)=>{
        const measure  = migrateMeasure(part.measures[col])
        const scaledMW = rawMWs[col]*lineScale
        const rawW     = measureWidth(measure,slashSet)
        const sc       = scaledMW/rawW

        // Alternating measure background
        if (col%2!==0) {
          elems.push(
            <rect key={`bg-${lineIdx}-${pIdx}-${ci}`}
              x={colXs[ci]} y={rowY-NOTE_SZ-3}
              width={scaledMW} height={VOICE_H-VOICE_G}
              fill={C.mBgAlt}/>
          )
        }

        let x=colXs[ci]+PAD*sc

        measure.beats.forEach((beat,bi)=>{
          const sub       = beat.subdivision||1
          const is3q      = beat.specialSub==='3q'
          const connector = slotConnector(sub)

          // ── Beat separator ":"  or  "/" ──────────────────────────────────
          // The separator is placed BEFORE beat bi (for bi>0).
          // It's a "/" if slashSet contains the PREVIOUS beat index (bi-1).
          // Because slashSet stores: "slash appears AFTER beat index X" = before beat X+1.
          if (bi>0) {
            // slash appears AFTER beat (bi-1), i.e., BEFORE beat bi
            const isSlash = slashSet.has(bi-1)
            const sepW    = (isSlash?SLASH_W:COLON_W)*sc
            elems.push(
              <text key={`sep-${lineIdx}-${pIdx}-${col}-${bi}`}
                x={x+sepW/2} y={rowY}
                textAnchor="middle" fontFamily={FONT}
                fontSize={NOTE_SZ}
                fill={isSlash?C.slash:C.colon}
                opacity={isSlash?0.55:1}
                style={{pointerEvents:'none'}}>
                {isSlash?'/':':'}
              </text>
            )
            x+=sepW
          }

          // ── Slots within this beat ───────────────────────────────────────
          beat.slots.forEach((slot,si)=>{
            const isSel=(
              part.id===selectedPartId&&
              col===selectedMeasureIdx&&
              bi===selectedBeatIdx&&
              si===selectedSlotIdx
            )

            // 3q beat: slot 0 is a half-slot (wider), slot 1 is a quarter-slot
            let slotDisplayW
            if (is3q) {
              slotDisplayW = si===0 ? (NOTE_W*2+OCT_W)*sc : SLOT_W*sc
            } else {
              slotDisplayW = SLOT_W*sc
            }

            // For narrow slots (3q slot 1), center the note
            const noteW = Math.min(slotDisplayW, SLOT_W*sc)

            renderSlot({
              slot, x, y:rowY, w:slotDisplayW,
              isSel, partId:part.id, col, bi, si,
              selectSlot, onSelectSlot, setLyricEdit, elems,
              slotKey:`${lineIdx}-${pIdx}-${col}-${bi}-${si}`,
            })

            x+=slotDisplayW

            // Connector between slots (not after last slot)
            if (si<beat.slots.length-1) {
              const conW=CON_W*sc
              // For 3q: use ". ," notation (dot after half, comma before quarter)
              // slot 0→1: dot after = ".", slot 1→2: not applicable (only 2 slots)
              const conChar = is3q ? (si===0?'.':',') : connector
              const conY    = conChar==='.'?rowY-4:rowY
              elems.push(
                <text key={`con-${lineIdx}-${pIdx}-${col}-${bi}-${si}`}
                  x={x+conW/2} y={conY}
                  textAnchor="middle" fontFamily={FONT}
                  fontSize={CON_SZ} fill={C.connector} fontWeight={600}
                  style={{pointerEvents:'none'}}>
                  {conChar}
                </text>
              )
              x+=conW
            }
          })
        })
      })

      // Voice separator line
      if (pIdx<parts.length-1) {
        const sepY=rowY+ROW_H+LYRIC_H+VOICE_G/2
        elems.push(
          <line key={`vsep-${lineIdx}-${pIdx}`}
            x1={leftEdge} y1={sepY}
            x2={leftEdge+lineCols.reduce((s,c)=>s+rawMWs[c]*lineScale,0)} y2={sepY}
            stroke={C.voiceSep} strokeWidth={0.6}/>
        )
      }
    })

    // Closing barlines
    lineCols.forEach((col,ci)=>{
      const bx  =colXs[ci]+rawMWs[col]*lineScale
      const last=ci===numCols-1
      elems.push(<line key={`bline-${lineIdx}-${ci}`} x1={bx} y1={lineTop} x2={bx} y2={lineBottom} stroke={C.barline} strokeWidth={last?2.5:1.5}/>)
      if (last) elems.push(<line key={`bline2-${lineIdx}`} x1={bx+4} y1={lineTop} x2={bx+4} y2={lineBottom} stroke={C.barline} strokeWidth={1}/>)
    })

    sysY+=systemH
  })

  // Inline lyric editor
  if (lyricEdit) {
    elems.push(
      <InlineLyricEditor key="lyric-ed"
        x={lyricEdit.x} y={lyricEdit.y} w={lyricEdit.w} value={lyricEdit.current}
        onCommit={val=>{
          setLyric(lyricEdit.partId,lyricEdit.measureIdx,lyricEdit.beatIdx,lyricEdit.slotIdx,val.trim())
          setLyricEdit(null)
        }}
        onCancel={()=>setLyricEdit(null)}
      />
    )
  }

  return (
    <div ref={wrapRef} style={{width:'100%',overflowX:'auto'}}>
      <svg width={svgW} height={totalH} style={{display:'block',fontFamily:FONT,userSelect:'none'}}>
        {elems}
      </svg>
    </div>
  )
}