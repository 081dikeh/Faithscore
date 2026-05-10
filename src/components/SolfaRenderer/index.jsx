// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer
//
// RENDERING EXACTLY AS IN THE HANDWRITTEN SAMPLES:
//
// 1. BEAT SEPARATOR ":"
//    Written BEFORE each beat starting from beat 2.
//    So beat 1 has no prefix, beat 2 gets ":", beat 3 gets ":", etc.
//    4/4 whole beats: "d :r :m :f"
//
// 2. SLOT CONNECTOR within a beat
//    subdivision=2 (halves): slots joined by "."  →  "d.r"
//    subdivision=3 (thirds): slots joined by ","  →  "d,r,m"
//    subdivision=4 (quarters): slots joined by "," →  "d,r,m,f"
//    The connector is drawn BETWEEN slots, not before or after.
//
// 3. SLASH "/" mid-bar visual separator
//    Appears INSTEAD of ":" at specific beat boundaries per time sig.
//    4/4: d :r / :m :f     (slash at beat boundary after beat 2, idx 1)
//    Note: slash replaces the ":" at that position.
//    From the Exultet sample: "s,:l,:d :d :t, :d :r" — the commas connect
//    sub-notes WITHIN a beat, the colons separate BEATS.
//
// 4. OCTAVE marks: small superscript/subscript number RIGHT of syllable
//    octave=1 → d¹    octave=-1 → d₁
//    octave=2 → d²    octave=-2 → d₂
//
// 5. REST: small "–" dash (as seen in samples: "d :- :-")
//    Sustain/hold: also "–"
//
// 6. LYRIC: always on ruled underline below each voice row, click to edit

import { useRef, useEffect, useState } from 'react'
import { useSolfaStore, slashPositions, slotConnector, migrateMeasure } from '../../store/solfaStore'

// ── LAYOUT ────────────────────────────────────────────────────────────────────
const FONT     = '"Times New Roman", Georgia, serif'
const NOTE_SZ  = 14
const OCT_SZ   = 8
const LYRIC_SZ = 10
const CON_SZ   = 11   // connector (. or ,) font size

const ROW_H    = 26   // px from note baseline to next row's top
const LYRIC_H  = 17   // px for lyric area
const VOICE_G  = 5    // px gap between voice blocks
const SYS_GAP  = 46   // px between systems
const BRAK_W   = 10
const LABEL_W  = 26
const PAGE_L   = 36
const PAGE_R   = 20
const HDR_H    = 44
const VOICE_H  = ROW_H + LYRIC_H + VOICE_G

// Pixel widths
const NOTE_W   = 18   // one syllable cell
const OCT_W    = 6    // octave number width
const CON_W    = 7    // connector (. or ,) width
const COLON_W  = 9    // ":" beat separator width
const SLASH_W  = 9    // "/" mid-bar separator width
const PAD      = 8    // bar left+right padding each side

const C = {
  ink:'#111827', hold:'#6b7280', rest:'#9ca3af',
  sel:'#1d4ed8', selBg:'rgba(29,78,216,0.10)',
  barline:'#1f2937', bracket:'#1f2937', label:'#1e3a8a',
  lyric:'#1f2937', lyricRul:'#b0b8c8', voiceSep:'#e5e7eb',
  colon:'#374151', slash:'#9ca3af', connector:'#374151',
  mBgAlt:'#f8f9fa',
}

// ── WIDTH CALCULATIONS ────────────────────────────────────────────────────────
// Width of one beat (all its slots + connectors between them)
// Each slot = NOTE_W + OCT_W (for octave mark space, whether used or not)
// Connectors between slots (subdivision-1 of them)
function beatWidth(beat) {
  const sub = beat?.subdivision || 1
  const slotW = NOTE_W + OCT_W
  const connectors = (sub - 1) * CON_W
  return sub * slotW + connectors
}

// Width of one measure
function measureWidth(measure, slashSet) {
  if (!measure?.beats) return PAD*2 + (NOTE_W+OCT_W)*4 + COLON_W*3
  const nb = measure.beats.length
  let w = PAD * 2
  for (let bi=0; bi<nb; bi++) {
    w += beatWidth(measure.beats[bi])
    if (bi < nb-1) {
      // separator after this beat
      w += slashSet.has(bi) ? SLASH_W : COLON_W
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
  const slashSet = slashPositions(topNum,botNum)

  // Compute raw measure widths
  const rawMWs = Array.from({length:numM},(_,i)=>{
    const m=migrateMeasure(parts[0]?.measures[i])
    return measureWidth(m,slashSet)
  })

  const leftEdge  = PAGE_L+BRAK_W+LABEL_W
  const available = svgW-leftEdge-PAGE_R

  // Line-break into systems
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

  const systemH = parts.length*VOICE_H+SYS_GAP
  const totalH  = HDR_H+lines.length*systemH+40

  const elems=[]
  let sysY=HDR_H+20

  // Header
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

    const colXs=[]
    let cx=leftEdge
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

    // Opening barline
    elems.push(<line key={`obar-${lineIdx}`} x1={leftEdge} y1={lineTop} x2={leftEdge} y2={lineBottom} stroke={C.barline} strokeWidth={1.5}/>)

    // Measure number
    elems.push(<text key={`mnum-${lineIdx}`} x={leftEdge+2} y={lineTop-2} fontFamily={FONT} fontSize={9} fill="#9ca3af">{lineCols[0]+1}</text>)

    // Each voice
    parts.forEach((part,pIdx)=>{
      const rowY=sysY+pIdx*VOICE_H

      // Voice label
      elems.push(
        <text key={`lbl-${lineIdx}-${pIdx}`} x={PAGE_L+BRAK_W+2} y={rowY}
          fontFamily={FONT} fontSize={12} fontWeight={700} fill={C.label}>
          {part.label}
        </text>
      )

      // Each measure
      lineCols.forEach((col,ci)=>{
        const measure   = migrateMeasure(part.measures[col])
        const scaledMW  = rawMWs[col]*lineScale
        const rawW      = measureWidth(measure,slashSet)
        const sc        = scaledMW/rawW

        // Alternating measure background
        if (col%2!==0) {
          elems.push(
            <rect key={`bg-${lineIdx}-${pIdx}-${ci}`}
              x={colXs[ci]} y={rowY-NOTE_SZ-3}
              width={scaledMW} height={VOICE_H-VOICE_G}
              fill={C.mBgAlt}/>
          )
        }

        // Render measure content
        let x=colXs[ci]+PAD*sc

        measure.beats.forEach((beat,bi)=>{
          const sub      = beat.subdivision||1
          const connector= slotConnector(sub)
          const slotW    = (NOTE_W+OCT_W)*sc
          const conW     = CON_W*sc

          // ── Beat separator (: or /) before this beat (except beat 0) ────
          if (bi>0) {
            const isSlash = slashSet.has(bi-1)  // slash is AFTER the previous beat (bi-1)
            const sepChar = isSlash ? '/' : ':'
            const sepW    = (isSlash?SLASH_W:COLON_W)*sc
            elems.push(
              <text key={`sep-${lineIdx}-${pIdx}-${col}-${bi}`}
                x={x+sepW/2} y={rowY}
                textAnchor="middle" fontFamily={FONT}
                fontSize={NOTE_SZ}
                fill={isSlash?C.slash:C.colon}
                opacity={isSlash?0.5:1}>
                {sepChar}
              </text>
            )
            x+=sepW
          }

          // ── Slots within this beat ───────────────────────────────────────
          beat.slots.forEach((slot,si)=>{
            const isSel=(
              part.id===selectedPartId &&
              col===selectedMeasureIdx &&
              bi===selectedBeatIdx &&
              si===selectedSlotIdx
            )

            const noteX = x
            const noteW = NOTE_W*sc
            const isNote    = slot.type==='note'
            const isHold    = slot.type==='sustain'
            const isRest    = slot.type==='rest'
            const ink       = isSel?C.sel:isNote?C.ink:isHold?C.hold:C.rest
            const cx2       = noteX+noteW/2
            const lyricY    = rowY+ROW_H+LYRIC_H-5

            // Selection highlight
            if (isSel) {
              elems.push(
                <rect key={`sel-${slot.id}`}
                  x={noteX-1} y={rowY-NOTE_SZ-2}
                  width={noteW+2} height={NOTE_SZ+5}
                  fill={C.selBg} rx={2}/>
              )
            }

            // Syllable / hold / rest
            if (isNote) {
              elems.push(
                <text key={`n-${slot.id}`}
                  x={cx2} y={rowY}
                  textAnchor="middle" fontFamily={FONT}
                  fontSize={NOTE_SZ} fontWeight={isSel?700:400}
                  fill={ink}
                  onClick={()=>{
                    selectSlot(part.id,col,bi,si)
                    onSelectSlot?.(part.id,col,bi,si)
                    setLyricEdit(null)
                  }}
                  style={{cursor:'pointer'}}>
                  {slot.syllable||'?'}
                </text>
              )
            } else if (isHold) {
              elems.push(
                <text key={`h-${slot.id}`}
                  x={cx2} y={rowY}
                  textAnchor="middle" fontFamily={FONT}
                  fontSize={NOTE_SZ} fill={C.hold}
                  onClick={()=>{selectSlot(part.id,col,bi,si);onSelectSlot?.(part.id,col,bi,si)}}
                  style={{cursor:'pointer'}}>
                  –
                </text>
              )
            } else {
              // Rest: small dash, lighter
              elems.push(
                <text key={`r-${slot.id}`}
                  x={cx2} y={rowY}
                  textAnchor="middle" fontFamily={FONT}
                  fontSize={NOTE_SZ} fill={C.rest}
                  onClick={()=>{selectSlot(part.id,col,bi,si);onSelectSlot?.(part.id,col,bi,si)}}
                  style={{cursor:'pointer'}}>
                  –
                </text>
              )
            }

            // Invisible click target (makes empty slots selectable)
            elems.push(
              <rect key={`hit-${slot.id}`}
                x={noteX} y={rowY-NOTE_SZ-2}
                width={noteW} height={NOTE_SZ+5}
                fill="transparent"
                style={{cursor:'pointer'}}
                onClick={()=>{
                  selectSlot(part.id,col,bi,si)
                  onSelectSlot?.(part.id,col,bi,si)
                  setLyricEdit(null)
                }}
              />
            )

            // Octave mark (superscript or subscript)
            if (isNote&&slot.octave!==0) {
              const octX = noteX+noteW
              const octY = slot.octave>0 ? rowY-NOTE_SZ+2 : rowY+3
              const domBase = slot.octave>0 ? 'auto' : 'hanging'
              elems.push(
                <text key={`oct-${slot.id}`}
                  x={octX} y={octY}
                  textAnchor="start" fontFamily={FONT}
                  fontSize={OCT_SZ} fontWeight={700}
                  fill={isSel?C.sel:C.ink}
                  dominantBaseline={domBase}>
                  {Math.abs(slot.octave)}
                </text>
              )
            }

            // Lyric text
            elems.push(
              <text key={`ly-${slot.id}`}
                x={cx2} y={lyricY}
                textAnchor="middle" fontFamily={FONT}
                fontSize={LYRIC_SZ} fill={C.lyric}
                style={{cursor:'text'}}
                onClick={e=>{
                  e.stopPropagation()
                  setLyricEdit({
                    partId:part.id, measureIdx:col, beatIdx:bi, slotIdx:si,
                    x:noteX, y:lyricY, w:noteW, current:slot.lyric||'',
                  })
                }}>
                {slot.lyric||''}
              </text>
            )

            // Lyric underline (always visible — shows where to click)
            elems.push(
              <line key={`lu-${slot.id}`}
                x1={noteX} y1={lyricY+2} x2={noteX+noteW} y2={lyricY+2}
                stroke={C.lyricRul} strokeWidth={0.5}/>
            )

            x+=slotW

            // Connector between slots (. or ,) — not after last slot
            if (si<sub-1) {
              elems.push(
                <text key={`con-${slot.id}`}
                  x={x+conW/2} y={connector==='.'?rowY-4:rowY}
                  textAnchor="middle" fontFamily={FONT}
                  fontSize={CON_SZ} fill={C.connector} fontWeight={600}>
                  {connector}
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