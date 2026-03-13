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
const REST_KEY = { treble: 'c/5', bass: 'e/3' }

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

  const defKey = clef === 'bass' ? 'f/3' : 'd/5'
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
  const [dragState, setDragState]   = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const score                = useScoreStore(s => s.score)
  const selectedMeasureIndex = useScoreStore(s => s.selectedMeasureIndex)
  const selectedPartId       = useScoreStore(s => s.selectedPartId)
  const selectedNoteId       = useScoreStore(s => s.selectedNoteId)
  const selectMeasure        = useScoreStore(s => s.selectMeasure)
  const selectNote           = useScoreStore(s => s.selectNote)
  const moveNote             = useScoreStore(s => s.moveNote)
  const playbackBeat         = useScoreStore(s => s.playbackBeat)

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

      {/* Measure zones */}
      {measureZones.map((z) => (
        <div key={`m-${z.partId}-${z.measureIndex}`}
          onClick={() => selectMeasure(z.partId, z.measureIndex)}
          onDragOver={e => { e.preventDefault(); setDropTarget(`${z.partId}-${z.measureIndex}`) }}
          onDrop={e => {
            e.preventDefault(); setDropTarget(null)
            if (dragState) {
              moveNote(dragState.noteId, dragState.partId, dragState.measureIndex, z.partId, z.measureIndex)
              setDragState(null)
            }
          }}
          onDragLeave={() => setDropTarget(null)}
          style={{
            position: 'absolute', left: z.x, top: z.y, width: z.width, height: z.height,
            cursor: 'pointer', borderRadius: 2, boxSizing: 'border-box', zIndex: 1,
            border: dropTarget === `${z.partId}-${z.measureIndex}`
              ? '2px dashed #16a34a'
              : z.selected ? '2px solid #1d4ed8' : '2px solid transparent',
            backgroundColor: dropTarget === `${z.partId}-${z.measureIndex}`
              ? 'rgba(22,163,74,0.08)'
              : z.selected ? 'rgba(29,78,216,0.06)' : 'transparent',
          }}
        />
      ))}

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
