// src/components/ScoreRenderer/index.jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Accidental, Annotation, StaveConnector, Dot
} from 'vexflow'
import { useScoreStore, DURATION_BEATS, noteDuration } from '../../store/scoreStore'

const MEASURES_PER_LINE   = 4
const MEASURE_WIDTH       = 210
const FIRST_MEASURE_WIDTH = 270
const PART_HEIGHT         = 120
const SYSTEM_GAP          = 60
const STAVE_TOP           = 55
const STAVE_HEIGHT        = 80

// Middle of staff for rests — VexFlow places rest glyph at this key position.
// Bass clef lines (bottom→top): G2 B2 D3 F3 A3 — middle line = D3
// Treble clef lines (bottom→top): E4 G4 B4 D5 F5 — middle line = B4
const REST_KEY = { treble: 'b/4', bass: 'd/3' }

function keyNumToVexflow(num) {
  const map = {
    0:'C', 1:'G', 2:'D', 3:'A', 4:'E', 5:'B', 6:'F#', 7:'C#',
    '-1':'F', '-2':'Bb', '-3':'Eb', '-4':'Ab', '-5':'Db', '-6':'Gb', '-7':'Cb'
  }
  return map[String(num)] ?? 'C'
}

function buildVfNote(n, clef, isSelected, chordExtras = []) {
  const restKey = REST_KEY[clef] || 'b/4'
  // CRITICAL: pass clef to StaveNote so VexFlow uses the correct staff
  // position table. Without this, ALL notes use treble clef positioning,
  // which places bass clef notes and rests in completely wrong positions.
  const clefOpt = clef === 'bass' ? { clef: 'bass' } : {}

  if (n.isRest) {
    const sn = new StaveNote({
      keys: [restKey],
      duration: n.duration + 'r',
      dots: n.dots || 0,
      type: 'r',
      ...clefOpt,
    })
    if (n.dots) Dot.buildAndAttach([sn])
    if (isSelected) sn.setStyle({ fillStyle: '#2563eb', strokeStyle: '#2563eb' })
    return sn
  }

  const defKey = clef === 'bass' ? 'f/3' : 'b/4'
  const allNotes = [n, ...chordExtras]
  const keys = allNotes.map(nn =>
    nn.pitch ? `${nn.pitch.step.toLowerCase()}/${nn.pitch.octave}` : defKey
  )

  const sn = new StaveNote({ keys, duration: n.duration, dots: n.dots || 0, ...clefOpt })
  if (n.dots) Dot.buildAndAttach([sn])
  if (isSelected) sn.setStyle({ fillStyle: '#ea580c', strokeStyle: '#ea580c' })

  allNotes.forEach((nn, ki) => {
    if (nn.pitch?.accidental) sn.addModifier(new Accidental(nn.pitch.accidental), ki)
  })

  if (n.lyric) {
    sn.addModifier(
      new Annotation(n.lyric)
        .setVerticalJustification(Annotation.VerticalJustify.BOTTOM)
        .setFont('serif', 11)
    )
  }
  return sn
}

export default function ScoreRenderer() {
  const containerRef = useRef(null)
  const [zones, setZones] = useState([])
  const [dragState, setDragState]   = useState(null)   // existing-note drag
  const [dropTarget, setDropTarget] = useState(null)   // drop highlight key
  // ghostDrag: active when user drags in Note mode over the score
  // { zKey, x, y, beat, pitch } — used to render the floating ghost note
  const [ghostDrag, setGhostDrag]   = useState(null)

  const score                = useScoreStore(s => s.score)
  const selectedMeasureIndex = useScoreStore(s => s.selectedMeasureIndex)
  const selectedPartId       = useScoreStore(s => s.selectedPartId)
  const selectedNoteId       = useScoreStore(s => s.selectedNoteId)
  const selectMeasure        = useScoreStore(s => s.selectMeasure)
  const selectNote           = useScoreStore(s => s.selectNote)
  const moveNote             = useScoreStore(s => s.moveNote)
  const playbackBeat         = useScoreStore(s => s.playbackBeat)
  const dropNoteAtBeat       = useScoreStore(s => s.dropNoteAtBeat)
  const inputMode            = useScoreStore(s => s.inputMode)
  const selectedDuration     = useScoreStore(s => s.selectedDuration)
  const selectedDots         = useScoreStore(s => s.selectedDots)

  const render = useCallback(() => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const numParts   = score.parts.length
    const totalCols  = Math.max(...score.parts.map(p => p.measures.length), 1)
    const totalLines = Math.ceil(totalCols / MEASURES_PER_LINE)
    const systemH    = numParts * PART_HEIGHT + SYSTEM_GAP
    const canvasW    = FIRST_MEASURE_WIDTH + (MEASURES_PER_LINE - 1) * MEASURE_WIDTH + 60
    const canvasH    = totalLines * systemH + 80

    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG)
    renderer.resize(canvasW, canvasH)
    const ctx = renderer.getContext()
    ctx.setFont('Times New Roman', 10)

    const allZones = []

    for (let line = 0; line < totalLines; line++) {
      const sysY     = line * systemH + STAVE_TOP
      const startCol = line * MEASURES_PER_LINE
      const endCol   = Math.min(startCol + MEASURES_PER_LINE, totalCols)

      // Measure number
      ctx.save()
      ctx.setFont('Arial', 9)
      ctx.fillText(String(startCol + 1), 24, sysY - 10)
      ctx.restore()

      let firstStave = null, lastStave = null

      score.parts.forEach((part, pIdx) => {
        const partY = sysY + pIdx * PART_HEIGHT
        const clef  = part.clef || 'treble'

        for (let col = startCol; col < endCol; col++) {
          const measure = part.measures[col]
          if (!measure) continue

          const colInLine = col - startCol
          const isFirst   = colInLine === 0
          const width     = isFirst ? FIRST_MEASURE_WIDTH : MEASURE_WIDTH
          const x         = isFirst ? 20 : 20 + FIRST_MEASURE_WIDTH + (colInLine - 1) * MEASURE_WIDTH

          const stave = new Stave(x, partY, width)
          if (isFirst) {
            stave.addClef(clef)
            stave.addKeySignature(keyNumToVexflow(measure.keySignature ?? 0))
            if (pIdx === 0) stave.addTimeSignature(
              `${measure.timeSignature.beats}/${measure.timeSignature.beatType}`
            )
          }

          const isMeasureSel = col === selectedMeasureIndex &&
                               part.id === selectedPartId &&
                               !selectedNoteId
          if (isMeasureSel) stave.setStyle({ fillStyle: '#1d4ed8', strokeStyle: '#1d4ed8' })
          stave.setContext(ctx).draw()

          if (isFirst && line === 0) {
            ctx.save()
            ctx.setFont('Times New Roman', 10)
            ctx.fillText(part.name, 24, partY - 6)
            ctx.restore()
          }

          if (isFirst && numParts > 1) {
            if (pIdx === 0)            firstStave = stave
            if (pIdx === numParts - 1) lastStave  = stave
          }

          // Build chord map
          const chordMap = {}
          measure.notes.filter(n => n.chordWith).forEach(n => {
            if (!chordMap[n.chordWith]) chordMap[n.chordWith] = []
            chordMap[n.chordWith].push(n)
          })

          // Render sequence = all non-chord notes (including rests already stored)
          const renderSeq = measure.notes.filter(n => !n.chordWith)

          if (renderSeq.length === 0) {
            allZones.push({ type: 'measure', partId: part.id, measureIndex: col,
              x, y: partY, width, height: STAVE_HEIGHT, selected: isMeasureSel })
            continue
          }

          try {
            const vfNotes = renderSeq.map(n =>
              buildVfNote(n, clef, n.id === selectedNoteId, chordMap[n.id] || [])
            )

            const voice = new Voice({
              num_beats: measure.timeSignature.beats,
              beat_value: measure.timeSignature.beatType,
            }).setStrict(false)
            voice.addTickables(vfNotes)
            new Formatter().joinVoices([voice]).format([voice], width - 48)
            voice.draw(ctx, stave)

            // Measure background zone
            allZones.push({ type: 'measure', partId: part.id, measureIndex: col,
              x, y: partY, width, height: STAVE_HEIGHT, selected: isMeasureSel })

            // Per-note/rest zones
            vfNotes.forEach((vfNote, ni) => {
              try {
                const nx      = vfNote.getAbsoluteX()
                const seqNote = renderSeq[ni]
                allZones.push({
                  type:     seqNote.isRest ? 'rest' : 'note',
                  noteId:   seqNote.id,
                  partId:   part.id,
                  measureIndex: col,
                  x: nx - 10, y: partY + 2,
                  width: 28, height: STAVE_HEIGHT - 4,
                  selected: seqNote.id === selectedNoteId,
                  isRest:   seqNote.isRest,
                })
              } catch (_) {}
            })
          } catch (e) {
            console.warn(`Render err col=${col} part=${part.name}:`, e.message)
            allZones.push({ type: 'measure', partId: part.id, measureIndex: col,
              x, y: partY, width, height: STAVE_HEIGHT, selected: isMeasureSel })
          }
        }
      })

      if (numParts > 1 && firstStave && lastStave) {
        try {
          new StaveConnector(firstStave, lastStave)
            .setType(StaveConnector.type.BRACKET).setContext(ctx).draw()
          new StaveConnector(firstStave, lastStave)
            .setType(StaveConnector.type.BRACE).setContext(ctx).draw()
        } catch (_) {}
      }
    }

    setZones(allZones)
  }, [score, selectedMeasureIndex, selectedPartId, selectedNoteId])

  useEffect(() => { render() }, [render])

  const measureZones = zones.filter(z => z.type === 'measure')
  const noteZones    = zones.filter(z => z.type === 'note' || z.type === 'rest')

  // ── Playback cursor position calculation ──────────────────────────────────
  // Convert the fractional beat position into a pixel X coordinate by
  // finding which measure zone the beat falls in, then interpolating within it.
  // measureZones store the x/width of each bar — we match beat → column → x.
  // This runs on every render (cheap — just array lookups and arithmetic).
  const cursorStyle = (() => {
    if (playbackBeat === null || playbackBeat === undefined) return null
    if (zones.length === 0) return null

    // Beat counter: we need to know the beat START of each measure column
    // We derive this from score data (tempo doesn't affect pixel position)
    const { parts } = score
    if (!parts.length) return null

    // Build a map: measureIndex → { beatStart, totalBeats }
    let runningBeat = 0
    const measureBeatMap = {}
    const numMeasures = Math.max(...parts.map(p => p.measures.length), 0)
    for (let i = 0; i < numMeasures; i++) {
      const beats = parts[0]?.measures[i]?.timeSignature?.beats ?? 4
      measureBeatMap[i] = { beatStart: runningBeat, totalBeats: beats }
      runningBeat += beats
    }

    // Find which measure column the cursor is in
    let targetCol = numMeasures - 1
    for (let i = 0; i < numMeasures; i++) {
      const { beatStart, totalBeats } = measureBeatMap[i]
      if (playbackBeat >= beatStart && playbackBeat < beatStart + totalBeats) {
        targetCol = i
        break
      }
    }

    const { beatStart, totalBeats } = measureBeatMap[targetCol] || { beatStart: 0, totalBeats: 4 }
    const fracWithinMeasure = Math.min(1, (playbackBeat - beatStart) / totalBeats)

    // Find a zone for this column to get its x and width
    const zone = zones.find(z => z.type === 'measure' && z.measureIndex === targetCol)
    if (!zone) return null

    // Pixel X: zone.x is the stave left edge; add clef/key/time glyph offset
    // The first measure has wider left margin (~55px for clef+key+time glyphs)
    const noteAreaStart = targetCol === 0 ? zone.x + 55 : zone.x + 10
    const noteAreaWidth = zone.width - (targetCol === 0 ? 60 : 15)
    const cursorX = noteAreaStart + fracWithinMeasure * noteAreaWidth

    return {
      position: 'absolute',
      left: cursorX,
      top: zone.y - 8,
      width: 2,
      height: score.parts.length * 120 + 16,  // span all parts
      background: 'rgba(239, 68, 68, 0.85)',   // red-500
      borderRadius: 1,
      pointerEvents: 'none',
      zIndex: 20,
      boxShadow: '0 0 6px rgba(239,68,68,0.5)',
      transition: 'left 0.05s linear',          // smooth 50ms interpolation
    }
  })()

  return (
    <div style={{ position: 'relative', display: 'inline-block', minWidth: '100%', lineHeight: 0 }}>
      <div ref={containerRef} style={{ display: 'block' }} />

      {/* Measure zones — handle both ghost-note drags (note mode) and existing-note moves */}
      {measureZones.map((z) => {
        const zKey        = `${z.partId}-${z.measureIndex}`
        const isExistDrop = dropTarget === zKey
        const isGhostDrop = ghostDrag?.zKey === zKey

        const part  = score.parts.find(p => p.id === z.partId)
        const clef  = part?.clef || 'treble'
        const beats = part?.measures[z.measureIndex]?.timeSignature?.beats ?? 4

        // ── X → beat position ─────────────────────────────────────────────
        const getBeatFromX = (clientX) => {
          const container = containerRef.current?.parentElement
          const rect      = container ? container.getBoundingClientRect() : { left: 0, top: 0 }
          const noteStart = z.measureIndex === 0 ? z.x + 55 : z.x + 10
          const noteWidth = z.width - (z.measureIndex === 0 ? 60 : 15)
          const relX      = clientX - rect.left
          const frac      = Math.max(0, Math.min(1, (relX - noteStart) / noteWidth))
          return frac * beats
        }

        // ── Y → pitch (line/space on staff) ───────────────────────────────
        // VexFlow staff: 5 lines, top line at staveTop+10, bottom at staveTop+50
        // Each line/space = 10px apart (STAVE_HEIGHT=80 / 8 positions = 10px)
        // We map Y pixel → staff position (0=top line, 8=bottom line) → pitch
        const getPitchFromY = (clientY) => {
          const container = containerRef.current?.parentElement
          const rect      = container ? container.getBoundingClientRect() : { left: 0, top: 0 }
          const relY      = clientY - rect.top

          // Staff top line ≈ staveY+10, bottom line ≈ staveY+50
          // Positions above/below staff are also valid
          const staffTopY    = z.y + 10   // top line pixel Y
          const staffBottomY = z.y + 50   // bottom line pixel Y
          const staffSpan    = staffBottomY - staffTopY  // 40px for 4 spaces = 10px/space

          // Position 0 = top line, increases downward (lower pitch)
          // Each 10px = one staff position (line or space)
          const rawPos = (relY - staffTopY) / (staffSpan / 4)  // 0=top, 4=bottom line
          // Clamp from -3 (above staff) to 7 (below staff)
          const pos = Math.max(-3, Math.min(7, Math.round(rawPos)))

          if (clef === 'treble') {
            // Treble clef positions (0=F5, 1=E5, 2=D5, 3=C5, 4=B4, 5=A4, 6=G4, 7=F4, 8=E4...)
            // Lines: F5(0), D5(2), B4(4), G4(6), E4(8) — but we index from top line
            const TREBLE = [
              {s:'F',o:5,a:null}, {s:'E',o:5,a:null}, {s:'D',o:5,a:null},
              {s:'C',o:5,a:null}, {s:'B',o:4,a:null}, {s:'A',o:4,a:null},
              {s:'G',o:4,a:null}, {s:'F',o:4,a:null}, {s:'E',o:4,a:null},
              {s:'D',o:4,a:null}, {s:'C',o:4,a:null},
            ]
            const idx = pos + 3  // shift so pos=-3 maps to idx=0
            const p   = TREBLE[Math.max(0, Math.min(TREBLE.length-1, idx))]
            return { step: p.s, octave: p.o, accidental: p.a }
          } else {
            // Bass clef positions (top line = A3, spaces down: G3,F3,E3,D3,C3,B2,A2,G2...)
            const BASS = [
              {s:'A',o:3,a:null}, {s:'G',o:3,a:null}, {s:'F',o:3,a:null},
              {s:'E',o:3,a:null}, {s:'D',o:3,a:null}, {s:'C',o:3,a:null},
              {s:'B',o:2,a:null}, {s:'A',o:2,a:null}, {s:'G',o:2,a:null},
              {s:'F',o:2,a:null}, {s:'E',o:2,a:null},
            ]
            const idx = pos + 3
            const p   = BASS[Math.max(0, Math.min(BASS.length-1, idx))]
            return { step: p.s, octave: p.o, accidental: p.a }
          }
        }

        // ── Shared drag event handler for ghost-note drags ─────────────────
        const handleGhostDragOver = (e) => {
          if (inputMode !== 'note') return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          const container = containerRef.current?.parentElement
          const rect      = container ? container.getBoundingClientRect() : { left:0, top:0 }
          const beat  = getBeatFromX(e.clientX)
          const pitch = getPitchFromY(e.clientY)
          // Compute ghost X pixel (for preview dot)
          const noteStart = z.measureIndex === 0 ? z.x + 55 : z.x + 10
          const noteWidth = z.width - (z.measureIndex === 0 ? 60 : 15)
          const ghostX    = noteStart + Math.min(1, beat / beats) * noteWidth
          // Ghost Y: map pitch back to pixel
          const staffTopY  = z.y + 10
          const staffBotY  = z.y + 50
          const TREBLE_LABELS = ['F5','E5','D5','C5','B4','A4','G4','F4','E4','D4','C4']
          const BASS_LABELS   = ['A3','G3','F3','E3','D3','C3','B2','A2','G2','F2','E2']
          const labels = clef === 'treble' ? TREBLE_LABELS : BASS_LABELS
          const pitchLabel = `${pitch.step}${pitch.octave}`
          const pitchIdx   = labels.indexOf(pitchLabel)
          const ghostY     = pitchIdx >= 0
            ? staffTopY + (pitchIdx / (labels.length - 1)) * (staffBotY - staffTopY)
            : e.clientY - rect.top
          setGhostDrag({ zKey, beat, pitch, ghostX, ghostY })
          setDropTarget(null)
        }

        return (
          <div key={zKey}
            onClick={() => selectMeasure(z.partId, z.measureIndex)}
            onDragOver={e => {
              if (inputMode === 'note') {
                handleGhostDragOver(e)
              } else {
                e.preventDefault()
                setDropTarget(zKey)
              }
            }}
            onDrop={e => {
              e.preventDefault()
              if (inputMode === 'note' && ghostDrag) {
                dropNoteAtBeat(
                  z.partId, z.measureIndex,
                  ghostDrag.pitch,
                  selectedDuration, selectedDots,
                  ghostDrag.beat
                )
              } else if (dragState) {
                moveNote(dragState.noteId, dragState.partId, dragState.measureIndex, z.partId, z.measureIndex)
              }
              setDragState(null)
              setDropTarget(null)
              setGhostDrag(null)
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setDropTarget(null)
                setGhostDrag(null)
              }
            }}
            style={{
              position: 'absolute', left: z.x, top: z.y, width: z.width, height: z.height,
              cursor: inputMode === 'note' ? 'crosshair' : 'pointer',
              borderRadius: 2, boxSizing: 'border-box', zIndex: 1,
              border: isGhostDrop
                ? '2px dashed #16a34a'
                : isExistDrop ? '2px dashed #ea580c'
                : z.selected ? '2px solid #1d4ed8' : '2px solid transparent',
              backgroundColor: isGhostDrop
                ? 'rgba(22,163,74,0.07)'
                : isExistDrop ? 'rgba(234,88,12,0.08)'
                : z.selected ? 'rgba(29,78,216,0.06)' : 'transparent',
            }}
          />
        )
      })}

      {/* Ghost note preview — floating note dot + pitch label while dragging in note mode */}
      {ghostDrag && (() => {
        const dur = selectedDuration
        const sym = dur==='w' ? '𝅝' : dur==='h' ? '𝅗𝅥' : dur==='q' ? '♩' : dur==='8' ? '♪' : '𝅘𝅥𝅰'
        const label = `${ghostDrag.pitch.step}${ghostDrag.pitch.accidental ?? ''}${ghostDrag.pitch.octave}`
        return (
          <>
            {/* Vertical beat-position line */}
            {(() => {
              const z = measureZones.find(mz => mz.partId === ghostDrag.zKey?.split('-')[0]
                && String(mz.measureIndex) === ghostDrag.zKey?.split('-').slice(1).join('-'))
                || measureZones.find(mz => `${mz.partId}-${mz.measureIndex}` === ghostDrag.zKey)
              if (!z) return null
              return <div style={{
                position: 'absolute',
                left: ghostDrag.ghostX,
                top: z.y - 6,
                width: 1.5,
                height: z.height + 12,
                background: 'rgba(22,163,74,0.5)',
                pointerEvents: 'none',
                zIndex: 14,
              }} />
            })()}
            {/* Note symbol at pitch position */}
            <div style={{
              position: 'absolute',
              left: ghostDrag.ghostX - 10,
              top:  ghostDrag.ghostY  - 12,
              pointerEvents: 'none',
              zIndex: 16,
              fontSize: 22,
              color: '#16a34a',
              textShadow: '0 0 8px rgba(22,163,74,0.6)',
              userSelect: 'none',
              lineHeight: 1,
            }}>{sym}</div>
            {/* Pitch label bubble */}
            <div style={{
              position: 'absolute',
              left: ghostDrag.ghostX + 6,
              top:  ghostDrag.ghostY - 20,
              pointerEvents: 'none',
              zIndex: 17,
              background: '#166534',
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}>{label}{selectedDots ? '.' : ''}</div>
          </>
        )
      })()}

      {/* Note / rest zones */}
      {noteZones.map(z => (
        <div key={`n-${z.noteId}`}
          draggable={!z.isRest}
          onDragStart={e => {
            if (z.isRest) return
            e.stopPropagation()
            setDragState({ noteId: z.noteId, partId: z.partId, measureIndex: z.measureIndex })
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDragState(null)}
          onClick={e => { e.stopPropagation(); selectNote(z.noteId, z.partId, z.measureIndex) }}
          title={z.isRest
            ? 'Rest — click to select, then press A–G to fill'
            : 'Note — click to select, drag to move'}
          style={{
            position: 'absolute', left: z.x, top: z.y, width: z.width, height: z.height,
            cursor: z.isRest ? 'pointer' : (dragState ? 'grabbing' : 'grab'),
            borderRadius: 3, boxSizing: 'border-box', zIndex: 10,
            border: z.selected
              ? (z.isRest ? '2px solid #2563eb' : '2px solid #ea580c')
              : '1px solid transparent',
            backgroundColor: z.selected
              ? (z.isRest ? 'rgba(37,99,235,0.10)' : 'rgba(234,88,12,0.10)')
              : 'transparent',
          }}
        />
      ))}
      {/* Playback cursor — red vertical line tracking beat position */}
      {cursorStyle && <div style={cursorStyle} />}
    </div>
  )
}