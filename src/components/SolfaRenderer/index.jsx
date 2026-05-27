// src/components/SolfaRenderer/index.jsx
// FaithScore Solfa Renderer
//
// Each beat has EVENTS. Each event has duration in quarter-units (1-4).
// Offset = sum of previous event durations within the beat.
//
// PREFIX (before syllable) from offset:
//   offset=0 → ""     offset=1 → ","     offset=2 → "."     offset=3 → ".,,"
//
// SUFFIX (after syllable) from duration+offset:
//   if note fills to end of beat (offset+dur=4) → ""
//   duration=4 → ""   duration=3 → ".,"   duration=2 → "."   duration=1 → ","
//   EXCEPT: last event in beat never needs suffix (nothing comes after)
//
// REST events → BLANK (no character rendered, just space)
// SUSTAIN events → "–"
//
// BEAT SEPARATOR: ":" before beat 2+; "/" at slashSet positions

import { useRef, useEffect, useState } from 'react'
import { useSolfaStore, slashPositions, migrateMeasure } from '../../store/solfaStore'

const FONT    = '"Times New Roman", Georgia, serif'
const NOTE_SZ = 14
const OCT_SZ  = 8
const SYM_SZ  = 10
const LYR_SZ  = 10
const ROW_H      = 22    // note row height (baseline of note text)
const LYRIC_H    = 18    // lyric row height
const VOICE_G    = 14    // gap between voice blocks — large enough to prevent overlap
const NOTE_HIT_H = NOTE_SZ + 4   // note click target — only above baseline, not below
const SYS_GAP = 46
const BRAK_W  = 10
const LABEL_W = 26
const PAGE_L  = 36
const PAGE_R  = 20
const HDR_H   = 44
const VOICE_H = ROW_H + LYRIC_H + VOICE_G

const QW    = 9    // px per quarter-unit (note body width)
const SYM_W = 5    // px per prefix/suffix character
const SEP_W = 10   // px for ":" or "/"
const PAD   = 8    // bar padding

const C = {
  ink:'#111827', hold:'#6b7280',
  sel:'#1d4ed8', selBg:'rgba(29,78,216,0.10)',
  barline:'#1f2937', bracket:'#1f2937', label:'#1e3a8a',
  lyric:'#374151', lyricRul:'#b0b8c8', voiceSep:'#e5e7eb',
  sep:'#4b5563', slash:'#9ca3af', sym:'#374151',
  mBgAlt:'#f8f9fa',
  slur:'#374151', slurHover:'#dc2626', slurStart:'#2563eb',
}

// Prefix string for event starting at quarter-unit `offset` within its beat
function getPrefix(offset) {
  if (offset===0) return ''
  if (offset===1) return ''
  if (offset===2) return ''
  if (offset===3) return ''
  return ''
}

// Suffix string for event of `duration` starting at `offset`
// `isLast` = true if this is the last event in the beat
function getSuffix(offset, duration, isLast) {
  const end = offset + duration
  // If fills to beat end, or is the last event, no suffix
  if (end >= 4 || isLast) return ''
  if (duration === 3) return '.,'
  if (duration === 2) return '.'
  if (duration === 1) return ','
  return ''
}

function measureWidth(measure, slashSet) {
  if (!measure?.beats?.length) return PAD*2 + QW*4*4 + SEP_W*3
  const nb=measure.beats.length
  let w=PAD*2
  for (let bi=0;bi<nb;bi++) {
    const beat=measure.beats[bi]
    const events=beat?.events||[]
    let beatW=0
    let offset=0
    events.forEach((ev,ei)=>{
      const isRest=ev.type==='rest'
      const isLast=ei===events.length-1
      const pre=isRest?'':getPrefix(offset)
      const suf=isRest?'':getSuffix(offset,ev.duration,isLast)
      beatW+=pre.length*SYM_W + ev.duration*QW + suf.length*SYM_W
      offset+=ev.duration
    })
    if (beatW===0) beatW=QW*4
    w+=beatW
    if (bi<nb-1) w+=SEP_W
  }
  return w
}

function InlineLyricEditor({x,y,w,value,onCommit,onCancel}) {
  const ref=useRef(null)
  useEffect(()=>{setTimeout(()=>{ref.current?.focus();ref.current?.select()},30)},[])
  return (
    <foreignObject x={x} y={y} width={Math.max(w+4,70)} height={18}>
      <input ref={ref} defaultValue={value}
        placeholder="lyric…"
        style={{
          width:'100%', height:'100%',
          border:'1.5px solid #2563eb', borderRadius:3,
          fontSize:10, fontFamily:FONT, padding:'0 3px',
          boxSizing:'border-box', background:'#eff6ff',
          color:'#111', outline:'none',
        }}
        onKeyDown={e=>{
          if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();onCommit(e.target.value)}
          if(e.key==='Escape'){e.preventDefault();onCancel()}
        }}
        onBlur={e=>onCommit(e.target.value)}
      />
    </foreignObject>
  )
}

export default function SolfaRenderer({onSelectEvent}) {
  const wrapRef        = useRef(null)
  const [svgW,setSvgW] = useState(900)
  const [lyricEdit,setLyricEdit] = useState(null)
  const [hoveredSlurId,setHoveredSlurId] = useState(null)

  const score              = useSolfaStore(s=>s.score)
  const selectedPartId     = useSolfaStore(s=>s.selectedPartId)
  const selectedMeasureIdx = useSolfaStore(s=>s.selectedMeasureIdx)
  const selectedBeatIdx    = useSolfaStore(s=>s.selectedBeatIdx)
  const selectedEventIdx   = useSolfaStore(s=>s.selectedEventIdx)
  const selectEvent        = useSolfaStore(s=>s.selectEvent)
  const setLyric           = useSolfaStore(s=>s.setLyric)
  const inputMode          = useSolfaStore(s=>s.inputMode)
  const slurStart          = useSolfaStore(s=>s.slurStart)
  const setSlurStart       = useSolfaStore(s=>s.setSlurStart)
  const clearSlurStart     = useSolfaStore(s=>s.clearSlurStart)
  const addSlur            = useSolfaStore(s=>s.addSlur)
  const removeSlur         = useSolfaStore(s=>s.removeSlur)

  // Map of "partId:measureIdx:beatIdx:eventIdx" → {cx, bottomY} for slur drawing
  const eventPosMap = useRef({})

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
  const totalH =HDR_H+lines.length*systemH+40
  const elems=[]
  let sysY=HDR_H+20
  eventPosMap.current = {}

  elems.push(
    <g key="hdr">
      <text x={PAGE_L} y={HDR_H-8} fontFamily={FONT} fontSize={13} fontStyle="italic" fill="#374151">
        Doh is {score.key||'C'}
      </text>
      <text x={PAGE_L+88} y={HDR_H-8} fontFamily={FONT} fontSize={17} fontWeight={700} fill="#374151">
        {topNum}/{botNum}
      </text>
    </g>
  )

  lines.forEach((lineCols,lineIdx)=>{
    const numCols  = lineCols.length
    const totalRaw = lineCols.reduce((s,c)=>s+rawMWs[c],0)
    const isLast   = lineIdx===lines.length-1
    const sc2      = (!isLast&&totalRaw<available&&totalRaw>0)?available/totalRaw:1

    const colXs=[]; let cxPos=leftEdge
    lineCols.forEach(c=>{colXs.push(cxPos);cxPos+=rawMWs[c]*sc2})

    const lineTop    = sysY-NOTE_SZ-4
    const lineBottom = sysY+(parts.length-1)*VOICE_H+LYRIC_H+4

    elems.push(
      <g key={`brk-${lineIdx}`}>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+2}         y2={lineBottom} stroke={C.bracket} strokeWidth={2.5} strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineTop}    x2={PAGE_L+BRAK_W+2} y2={lineTop}    stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
        <line x1={PAGE_L+2} y1={lineBottom} x2={PAGE_L+BRAK_W+2} y2={lineBottom} stroke={C.bracket} strokeWidth={2}   strokeLinecap="round"/>
      </g>
    )
    elems.push(<line key={`obar-${lineIdx}`} x1={leftEdge} y1={lineTop} x2={leftEdge} y2={lineBottom} stroke={C.barline} strokeWidth={1.5}/>)
    elems.push(<text key={`mnum-${lineIdx}`} x={leftEdge+2} y={lineTop-2} fontFamily={FONT} fontSize={9} fill="#9ca3af">{lineCols[0]+1}</text>)

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
        const scaledMW = rawMWs[col]*sc2
        const rawW     = measureWidth(measure,slashSet)
        const sc3      = rawW>0?scaledMW/rawW:1

        // Alternating measure background — covers note row + lyric row
        if (col%2!==0) {
          elems.push(
            <rect key={`bg-${lineIdx}-${pIdx}-${ci}`}
              x={colXs[ci]} y={rowY - NOTE_SZ - 2}
              width={scaledMW}
              height={NOTE_SZ + 2 + 4 + LYRIC_H + 2}
              fill={C.mBgAlt}/>
          )
        }

        let x=colXs[ci]+PAD*sc3

        measure.beats.forEach((beat,bi)=>{
          const events=beat?.events||[]

          // Beat separator
          if (bi>0) {
            const isSlash=slashSet.has(bi-1)
            const sw=SEP_W*sc3
            elems.push(
              <text key={`sep-${lineIdx}-${pIdx}-${col}-${bi}`}
                x={x+sw/2} y={rowY} textAnchor="middle"
                fontFamily={FONT} fontSize={NOTE_SZ}
                fill={isSlash?C.slash:C.sep} opacity={isSlash?0.55:1}
                style={{pointerEvents:'none'}}>
                {isSlash?'/':':'}
              </text>
            )
            x+=sw
          }

          let offset=0
          events.forEach((ev,ei)=>{
            const isNote  = ev.type==='note'
            const isHold  = ev.type==='sustain'
            const isRest  = ev.type==='rest'
            const isLastEv= ei===events.length-1
            const isSel   = (
              part.id===selectedPartId &&
              col===selectedMeasureIdx &&
              bi===selectedBeatIdx &&
              ei===selectedEventIdx
            )

            const pre    = isRest?'':getPrefix(offset)
            const suf    = isRest?'':getSuffix(offset,ev.duration,isLastEv)
            const preW   = pre.length*SYM_W*sc3
            const bodyW  = ev.duration*QW*sc3
            const sufW   = suf.length*SYM_W*sc3
            const totalW = preW+bodyW+sufW

            const noteX  = x+preW
            const noteCX = noteX+bodyW/2

            // Record note center position for slur drawing
            const posKey = `${part.id}:${col}:${bi}:${ei}`
            const noteBottomY = rowY + 6   // just below the note baseline, above lyrics
            if (isNote) {
              eventPosMap.current[posKey] = { cx: noteCX, bottomY: noteBottomY }
            }

            // Selection bg (note zone only — above baseline)
            if (isSel) {
              elems.push(
                <rect key={`sel-${ev.id}`}
                  x={x} y={rowY - NOTE_SZ - 2}
                  width={Math.max(totalW, 8*sc3)} height={NOTE_HIT_H}
                  fill={C.selBg} rx={2}/>
              )
            }

            // Slur start highlight
            const isSlurStart = inputMode==='slur' && slurStart &&
              slurStart.partId===part.id && slurStart.measureIdx===col &&
              slurStart.beatIdx===bi && slurStart.eventIdx===ei
            if (isSlurStart) {
              elems.push(
                <rect key={`slurhl-${ev.id}`}
                  x={x} y={rowY - NOTE_SZ - 2}
                  width={Math.max(totalW, 8*sc3)} height={NOTE_HIT_H}
                  fill="rgba(37,99,235,0.18)" rx={2} style={{pointerEvents:'none'}}/>
              )
            }

            // Note click target — covers ONLY above the note baseline, never into lyric zone
            elems.push(
              <rect key={`hit-${ev.id}`}
                x={x} y={rowY - NOTE_SZ - 2}
                width={Math.max(totalW, 8*sc3)} height={NOTE_HIT_H}
                fill="transparent" style={{cursor: inputMode==='slur' && isNote ? 'crosshair' : 'pointer'}}
                onClick={()=>{
                  if (inputMode === 'slur' && isNote) {
                    if (!slurStart) {
                      // First click — set slur start
                      setSlurStart({ partId: part.id, measureIdx: col, beatIdx: bi, eventIdx: ei })
                    } else if (
                      slurStart.partId === part.id &&
                      (col > slurStart.measureIdx ||
                        (col === slurStart.measureIdx && bi > slurStart.beatIdx) ||
                        (col === slurStart.measureIdx && bi === slurStart.beatIdx && ei > slurStart.eventIdx))
                    ) {
                      // Second click — create slur (must be after start)
                      addSlur(slurStart.partId, slurStart.measureIdx, slurStart.beatIdx, slurStart.eventIdx, col, bi, ei)
                      clearSlurStart()
                    } else {
                      // Clicked before start or same note — reset start
                      setSlurStart({ partId: part.id, measureIdx: col, beatIdx: bi, eventIdx: ei })
                    }
                    return
                  }
                  selectEvent(part.id,col,bi,ei)
                  onSelectEvent?.(part.id,col,bi,ei)
                  setLyricEdit(null)
                }}
              />
            )

            // Prefix characters
            pre.split('').forEach((ch,chi)=>{
              elems.push(
                <text key={`pre-${ev.id}-${chi}`}
                  x={x+chi*SYM_W*sc3+SYM_W*sc3/2} y={ch==='.'?rowY-4:rowY}
                  textAnchor="middle" fontFamily={FONT} fontSize={SYM_SZ}
                  fill={isSel?C.sel:C.sym} fontWeight={600}
                  style={{pointerEvents:'none'}}>
                  {ch}
                </text>
              )
            })

            // Note / sustain (rest = nothing)
            if (isNote) {
              elems.push(
                <text key={`n-${ev.id}`}
                  x={noteCX} y={rowY} textAnchor="middle"
                  fontFamily={FONT} fontSize={NOTE_SZ} fontWeight={isSel?700:400}
                  fill={isSel?C.sel:C.ink} style={{pointerEvents:'none'}}>
                  {ev.syllable||'?'}
                </text>
              )
              if (ev.octave!==0) {
                elems.push(
                  <text key={`oct-${ev.id}`}
                    x={noteX+bodyW} y={ev.octave>0?rowY-NOTE_SZ+2:rowY+3}
                    textAnchor="start" fontFamily={FONT} fontSize={OCT_SZ} fontWeight={700}
                    fill={isSel?C.sel:C.ink}
                    dominantBaseline={ev.octave>0?'auto':'hanging'}
                    style={{pointerEvents:'none'}}>
                    {Math.abs(ev.octave)}
                  </text>
                )
              }
            } else if (isHold) {
              elems.push(
                <text key={`h-${ev.id}`}
                  x={noteCX} y={rowY} textAnchor="middle"
                  fontFamily={FONT} fontSize={NOTE_SZ}
                  fill={isSel?C.sel:C.hold} style={{pointerEvents:'none'}}>
                  –
                </text>
              )
            }
            // REST = blank, nothing rendered

            // Suffix characters
            if (suf) {
              const sufStartX=noteX+bodyW
              suf.split('').forEach((ch,chi)=>{
                elems.push(
                  <text key={`suf-${ev.id}-${chi}`}
                    x={sufStartX+chi*SYM_W*sc3+SYM_W*sc3/2} y={ch==='.'?rowY-4:rowY}
                    textAnchor="middle" fontFamily={FONT} fontSize={SYM_SZ}
                    fill={isSel?C.sel:C.sym} fontWeight={600}
                    style={{pointerEvents:'none'}}>
                    {ch}
                  </text>
                )
              })
            }

            // Lyric zone — sits immediately below note baseline
            // Top of lyric zone = rowY + 4 (small gap after note)
            // This keeps it well above the next voice's note hit rect
            const lyricZoneY  = rowY + 4
            const lyricZoneH  = LYRIC_H
            const lyricTextY  = lyricZoneY + LYRIC_H * 0.7
            const lyricSlotW  = Math.max(totalW, 8 * sc3)

            // Lyric zone — only for notes
            if (isNote) {
              const lyricZoneY  = rowY + 4
              const lyricZoneH  = LYRIC_H
              const lyricTextY  = lyricZoneY + LYRIC_H * 0.7
              const lyricSlotW  = Math.max(totalW, 8 * sc3)

              elems.push(
                <line key={`lu-${ev.id}`}
                  x1={x} y1={lyricZoneY + lyricZoneH - 2}
                  x2={x + lyricSlotW} y2={lyricZoneY + lyricZoneH - 2}
                  stroke={C.lyricRul} strokeWidth={0.6}
                  style={{pointerEvents:'none'}}/>
              )
              elems.push(
                <text key={`ly-${ev.id}`}
                  x={x + lyricSlotW/2} y={lyricTextY}
                  textAnchor="middle" fontFamily={FONT}
                  fontSize={LYR_SZ} fill={C.lyric}
                  style={{pointerEvents:'none', userSelect:'none'}}>
                  {ev.lyric || ''}
                </text>
              )
              elems.push(
                <rect key={`lhit-${ev.id}`}
                  x={x} y={lyricZoneY}
                  width={lyricSlotW} height={lyricZoneH}
                  fill="transparent" style={{cursor:'text'}}
                  onClick={e=>{
                    e.stopPropagation()
                    setLyricEdit({
                      partId:part.id, measureIdx:col, beatIdx:bi, eventIdx:ei,
                      x, y:lyricZoneY+1, w:lyricSlotW, current:ev.lyric||'',
                    })
                  }}/>
              )
            }

            x+=totalW
            offset+=ev.duration
          })
        })
      })

      // Voice separator — sits below lyric zone, above next voice's note area
      if (pIdx < parts.length - 1) {
        // rowY + 4 (lyricZoneY) + LYRIC_H + 3 = bottom of lyric + small gap
        const sepY = rowY + 4 + LYRIC_H + 3
        elems.push(
          <line key={`vsep-${lineIdx}-${pIdx}`}
            x1={leftEdge} y1={sepY}
            x2={leftEdge + lineCols.reduce((s,c) => s + rawMWs[c]*sc2, 0)} y2={sepY}
            stroke={C.voiceSep} strokeWidth={0.6}/>
        )
      }
    })

    lineCols.forEach((col,ci)=>{
      const bx=colXs[ci]+rawMWs[col]*sc2
      const last=ci===numCols-1
      elems.push(<line key={`bline-${lineIdx}-${ci}`} x1={bx} y1={lineTop} x2={bx} y2={lineBottom} stroke={C.barline} strokeWidth={last?2.5:1.5}/>)
      if (last) elems.push(<line key={`bline2-${lineIdx}`} x1={bx+4} y1={lineTop} x2={bx+4} y2={lineBottom} stroke={C.barline} strokeWidth={1}/>)
    })

    sysY+=systemH
  })

  // ── Render slurs ──────────────────────────────────────────────────────────
  // Slurs are cubic bezier curves drawn below the lyric zone
  const slurs = score.slurs || []
  slurs.forEach(sl => {
    const startKey = `${sl.partId}:${sl.startMeasure}:${sl.startBeat}:${sl.startEvent}`
    const endKey   = `${sl.partId}:${sl.endMeasure}:${sl.endBeat}:${sl.endEvent}`
    const startPos = eventPosMap.current[startKey]
    const endPos   = eventPosMap.current[endKey]
    if (!startPos || !endPos) return

    const x1 = startPos.cx
    const x2 = endPos.cx
    const y  = Math.max(startPos.bottomY, endPos.bottomY)
    const w  = x2 - x1
    const bow = Math.min(Math.max(w * 0.12, 4), 10)  // subtle bow, capped at 10px

    // Cubic bezier: starts and ends at note centers, bows gently downward
    const d = `M ${x1} ${y} C ${x1 + w*0.25} ${y + bow}, ${x2 - w*0.25} ${y + bow}, ${x2} ${y}`
    const isHovered = hoveredSlurId === sl.id

    elems.push(
      <g key={`slur-${sl.id}`}>
        {/* Wider invisible hit area for hover/click */}
        <path d={d} fill="none" stroke="transparent" strokeWidth={8}
          style={{cursor:'pointer'}}
          onMouseEnter={()=>setHoveredSlurId(sl.id)}
          onMouseLeave={()=>setHoveredSlurId(null)}
          onClick={e=>{e.stopPropagation(); removeSlur(sl.id)}}
        />
        {/* Visible slur curve */}
        <path d={d} fill="none"
          stroke={isHovered ? C.slurHover : C.slur}
          strokeWidth={isHovered ? 1.2 : 0.9}
          strokeLinecap="round"
          opacity={isHovered ? 1 : 0.65}
          style={{pointerEvents:'none'}}
        />
      </g>
    )
  })

  if (lyricEdit) {
    elems.push(
      <InlineLyricEditor key="lyric-ed"
        x={lyricEdit.x} y={lyricEdit.y} w={lyricEdit.w} value={lyricEdit.current}
        onCommit={val=>{
          setLyric(lyricEdit.partId,lyricEdit.measureIdx,lyricEdit.beatIdx,lyricEdit.eventIdx,val.trim())
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