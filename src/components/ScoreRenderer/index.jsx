// src/components/ScoreRenderer/index.jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Renderer, Stave, StaveNote, Voice, Formatter,
  Accidental, Annotation, StaveConnector, Dot, Beam, StaveTie, Curve
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
  const addChordNote         = useScoreStore(s => s.addChordNote)
  const chordMode            = useScoreStore(s => s.chordMode)
  const selectedNoteId_store = useScoreStore(s => s.selectedNoteId)
  const inputMode            = useScoreStore(s => s.inputMode)
  const selectedDuration     = useScoreStore(s => s.selectedDuration)
  const selectedDots         = useScoreStore(s => s.selectedDots)
  const zoom                 = useScoreStore(s => s.zoom)
  const dynamics             = useScoreStore(s => s.score.dynamics || [])
  const hairpins             = useScoreStore(s => s.score.hairpins || [])
  const rehearsalMarks       = useScoreStore(s => s.score.rehearsalMarks || [])

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

          // Rehearsal mark (square box above staff) — only on first part
          if (pIdx === 0) {
            const rm = rehearsalMarks.find(r => r.measureIndex === col)
            if (rm) {
              ctx.save()
              ctx.setFont('Arial', 13)
              const rmW = Math.max(20, rm.text.length * 10 + 8)
              ctx.setFillStyle('#1d3a6e')
              ctx.fillRect(x + 2, partY - 30, rmW, 20)
              ctx.setFillStyle('white')
              ctx.fillText(rm.text, x + 5, partY - 14)
              ctx.restore()
            }
          }

          if (isFirst) {
            ctx.save()
            ctx.setFont('Times New Roman', line === 0 ? 11 : 9)
            // Full name on first system, abbreviation (first 3 chars + '.') on subsequent
            const label = line === 0 ? part.name : (part.name.slice(0, 3) + '.')
            ctx.fillText(label, 24, partY - 6)
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

            // ── Auto-beaming ────────────────────────────────────────────────
            // Generate beams for 8th/16th notes based on time signature
            try {
              const beamGroups = Beam.generateBeams(
                vfNotes.filter(n => {
                  const dur = n.getDuration()
                  return dur === '8' || dur === '16' || dur === '32'
                }),
                { stem_direction: 1 }
              )
              beamGroups.forEach(b => b.setContext(ctx).draw())
            } catch(_) {}

            // ── Ties ────────────────────────────────────────────────────────
            // Draw a tie from each note with tieStart=true to the next note
            // with the same pitch (in this measure or the next)
            renderSeq.forEach((seqNote, ni) => {
              if (!seqNote.tieStart || seqNote.isRest) return
              const nextNote = renderSeq[ni + 1]
              if (!nextNote || nextNote.isRest) return
              try {
                const tie = new StaveTie({
                  first_note:    vfNotes[ni],
                  last_note:     vfNotes[ni + 1],
                  first_indices: [0],
                  last_indices:  [0],
                })
                tie.setContext(ctx).draw()
              } catch(_) {}
            })

            // ── Slurs ────────────────────────────────────────────────────────
            // Draw a slur arc from slurStart note to the next real note
            renderSeq.forEach((seqNote, ni) => {
              if (!seqNote.slurStart || seqNote.isRest) return
              const nextIdx = renderSeq.findIndex((n, i) => i > ni && !n.isRest)
              if (nextIdx < 0) return
              try {
                const curve = new Curve(vfNotes[ni], vfNotes[nextIdx], {
                  cps: [{ x: 0, y: 12 }, { x: 0, y: 12 }],
                })
                curve.setContext(ctx).draw()
              } catch(_) {}
            })

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
    <div style={{
      position: 'relative', display: 'inline-block', minWidth: '100%', lineHeight: 0,
      transform: `scale(${zoom})`, transformOrigin: 'top left',
      // Adjust container height for zoom so scrollbar reflects true size
      marginBottom: zoom !== 1 ? `${(zoom - 1) * 100}%` : 0,
    }}>
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
          const rawBeat = frac * beats
          // Snap to nearest 16th note (0.25 beats) for precise placement
          const SNAP = 0.25
          return Math.round(rawBeat / SNAP) * SNAP
        }

        // ── Y → pitch (line/space on staff) — PRECISE version ───────────────
        // Staff geometry: VexFlow places 5 lines with 10px spacing.
        // staveY is the top of the stave div zone; the top staff LINE is ~15px down.
        // Each half-step position (line or space) = 5px.
        // We cover 3 ledger lines above and below = 22 positions total.
        const getPitchFromY = (clientY) => {
          const container = containerRef.current?.parentElement
          const rect      = container ? container.getBoundingClientRect() : { left: 0, top: 0 }
          const relY      = clientY - rect.top

          // Top staff line pixel Y (approx). Staff lines are at +15,+25,+35,+45,+55 from zone top
          const topLineY = z.y + 15
          // Each staff position = 5px (half the 10px line spacing = 1 space)
          const PX_PER_POS = 5

          // pos 0 = top line, increases downward (pitch decreases going down)
          // Negative pos = above top line (higher pitch)
          const rawPos = (relY - topLineY) / PX_PER_POS
          // Allow up to 6 ledger positions above and below the staff
          const pos = Math.max(-6, Math.min(14, Math.round(rawPos)))

          // Full chromatic pitch tables indexed by staff POSITION (not pitch name)
          // Each position maps to a diatonic pitch. Accidentals applied separately via toolbar.
          // Treble: top line F5, then E5 D5 C5 B4 A4 G4 F4 E4 D4 C4 B3...
          const TREBLE_POS = [
            // pos -6..-1 (above staff)
            {s:'E',o:6}, {s:'D',o:6}, {s:'C',o:6}, {s:'B',o:5}, {s:'A',o:5}, {s:'G',o:5},
            // pos 0..4 (5 staff lines, 4 spaces between)
            {s:'F',o:5}, {s:'E',o:5}, {s:'D',o:5}, {s:'C',o:5}, {s:'B',o:4},
            // pos 5..9 (spaces + bottom)
            {s:'A',o:4}, {s:'G',o:4}, {s:'F',o:4}, {s:'E',o:4}, {s:'D',o:4},
            // pos 10..14 (below staff)
            {s:'C',o:4}, {s:'B',o:3}, {s:'A',o:3}, {s:'G',o:3}, {s:'F',o:3},
          ]
          // Bass: top line A3, then G3 F3 E3 D3 C3 B2 A2 G2 F2 E2 D2...
          const BASS_POS = [
            // pos -6..-1 (above staff)
            {s:'C',o:5}, {s:'B',o:4}, {s:'A',o:4}, {s:'G',o:4}, {s:'F',o:4}, {s:'E',o:4},
            // pos 0..4
            {s:'A',o:3}, {s:'G',o:3}, {s:'F',o:3}, {s:'E',o:3}, {s:'D',o:3},
            // pos 5..9
            {s:'C',o:3}, {s:'B',o:2}, {s:'A',o:2}, {s:'G',o:2}, {s:'F',o:2},
            // pos 10..14
            {s:'E',o:2}, {s:'D',o:2}, {s:'C',o:2}, {s:'B',o:1}, {s:'A',o:1},
          ]

          const table = clef === 'treble' ? TREBLE_POS : BASS_POS
          const idx   = pos + 6   // shift: pos=-6 → idx=0
          const entry = table[Math.max(0, Math.min(table.length - 1, idx))]
          return { step: entry.s, octave: entry.o, accidental: null }
        }

        // Convert a pitch back to a Y pixel (for ghost note rendering)
        const getYFromPitch = (pitch) => {
          const TREBLE_POS = [
            {s:'E',o:6},{s:'D',o:6},{s:'C',o:6},{s:'B',o:5},{s:'A',o:5},{s:'G',o:5},
            {s:'F',o:5},{s:'E',o:5},{s:'D',o:5},{s:'C',o:5},{s:'B',o:4},
            {s:'A',o:4},{s:'G',o:4},{s:'F',o:4},{s:'E',o:4},{s:'D',o:4},
            {s:'C',o:4},{s:'B',o:3},{s:'A',o:3},{s:'G',o:3},{s:'F',o:3},
          ]
          const BASS_POS = [
            {s:'C',o:5},{s:'B',o:4},{s:'A',o:4},{s:'G',o:4},{s:'F',o:4},{s:'E',o:4},
            {s:'A',o:3},{s:'G',o:3},{s:'F',o:3},{s:'E',o:3},{s:'D',o:3},
            {s:'C',o:3},{s:'B',o:2},{s:'A',o:2},{s:'G',o:2},{s:'F',o:2},
            {s:'E',o:2},{s:'D',o:2},{s:'C',o:2},{s:'B',o:1},{s:'A',o:1},
          ]
          const table   = clef === 'treble' ? TREBLE_POS : BASS_POS
          const posIdx  = table.findIndex(e => e.s === pitch.step && e.o === pitch.octave)
          if (posIdx < 0) return z.y + 35  // fallback to middle
          const pos     = posIdx - 6
          return z.y + 15 + pos * 5
        }

        // ── Shared drag event handler for ghost-note drags ─────────────────
        const handleGhostDragOver = (e) => {
          if (inputMode !== 'note') return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          const beat  = getBeatFromX(e.clientX)
          const pitch = getPitchFromY(e.clientY)
          const noteStart = z.measureIndex === 0 ? z.x + 55 : z.x + 10
          const noteWidth = z.width - (z.measureIndex === 0 ? 60 : 15)
          const ghostX    = noteStart + Math.min(1, beat / beats) * noteWidth
          const ghostY    = getYFromPitch(pitch)
          // isChord: we're in chord mode or there's a selected real note in this measure
          const isChordDrop = chordMode && selectedNoteId_store
          setGhostDrag({ zKey, beat, pitch, ghostX, ghostY, isChord: isChordDrop })
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
                if (ghostDrag.isChord && selectedNoteId_store) {
                  // Chord drop: stack onto the currently selected note
                  addChordNote(z.partId, z.measureIndex, selectedNoteId_store, ghostDrag.pitch)
                } else {
                  dropNoteAtBeat(
                    z.partId, z.measureIndex,
                    ghostDrag.pitch,
                    selectedDuration, selectedDots,
                    ghostDrag.beat
                  )
                }
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
            {/* Pitch label bubble — shows chord indicator if in chord mode */}
            <div style={{
              position: 'absolute',
              left: ghostDrag.ghostX + 6,
              top:  ghostDrag.ghostY - 20,
              pointerEvents: 'none',
              zIndex: 17,
              background: ghostDrag.isChord ? '#7c3aed' : '#166534',
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}>{ghostDrag.isChord ? '+ ' : ''}{label}{selectedDots ? '.' : ''}</div>
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

      {/* ── Dynamics overlays ─────────────────────────────────────────── */}
      {dynamics.map(dyn => {
        const z = measureZones.find(mz => mz.partId === dyn.partId && mz.measureIndex === dyn.measureIndex)
        if (!z) return null
        const noteStart = dyn.measureIndex === 0 ? z.x + 55 : z.x + 10
        const noteWidth = z.width - (dyn.measureIndex === 0 ? 60 : 15)
        const part      = score.parts.find(p => p.id === dyn.partId)
        const beats     = part?.measures[dyn.measureIndex]?.timeSignature?.beats ?? 4
        const px        = noteStart + (dyn.beat / beats) * noteWidth
        return (
          <div key={dyn.id} style={{
            position: 'absolute', left: px - 8, top: z.y + z.height - 4,
            fontSize: 13, fontStyle: 'italic', fontFamily: 'Times New Roman, serif',
            fontWeight: 700, color: '#1e293b', pointerEvents: 'none', zIndex: 12,
            whiteSpace: 'nowrap', userSelect: 'none',
          }}>{dyn.value}</div>
        )
      })}

      {/* ── Hairpin overlays (crescendo/decrescendo wedges) ────────────── */}
      {hairpins.map(hp => {
        const z1 = measureZones.find(mz => mz.partId === hp.partId && mz.measureIndex === hp.startMeasure)
        const z2 = measureZones.find(mz => mz.partId === hp.partId && mz.measureIndex === hp.endMeasure) || z1
        if (!z1) return null
        const beatToX = (z, beat) => {
          const ns = z.measureIndex === 0 ? z.x + 55 : z.x + 10
          const nw = z.width - (z.measureIndex === 0 ? 60 : 15)
          const part = score.parts.find(p => p.id === hp.partId)
          const beats = part?.measures[z.measureIndex]?.timeSignature?.beats ?? 4
          return ns + (beat / beats) * nw
        }
        const x1   = beatToX(z1, hp.startBeat)
        const x2   = beatToX(z2, hp.endBeat)
        const y    = z1.y + z1.height + 8
        const mid  = 5
        const isC  = hp.type === 'cresc'
        // Draw SVG wedge inline
        const d = isC
          ? `M ${x1} ${y} L ${x2} ${y - mid} M ${x1} ${y} L ${x2} ${y + mid}`
          : `M ${x1} ${y - mid} L ${x2} ${y} M ${x1} ${y + mid} L ${x2} ${y}`
        return (
          <svg key={hp.id} style={{
            position: 'absolute', left: 0, top: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 11, overflow: 'visible',
          }}>
            <path d={d} stroke="#1e293b" strokeWidth="1.5" fill="none" />
          </svg>
        )
      })}

      {/* ── Staff text overlays ────────────────────────────────────────── */}
      {(score.staffTexts || []).map(st => {
        const z = measureZones.find(mz => mz.partId === st.partId && mz.measureIndex === st.measureIndex)
        if (!z) return null
        const ns = z.measureIndex === 0 ? z.x + 55 : z.x + 10
        const nw = z.width - (z.measureIndex === 0 ? 60 : 15)
        const part = score.parts.find(p => p.id === st.partId)
        const beats = part?.measures[st.measureIndex]?.timeSignature?.beats ?? 4
        const px = ns + (st.beat / beats) * nw
        return (
          <div key={st.id} style={{
            position: 'absolute', left: px, top: z.y - 22,
            fontSize: 11, fontFamily: 'Times New Roman, serif',
            color: '#374151', pointerEvents: 'none', zIndex: 12,
            whiteSpace: 'nowrap', fontStyle: 'italic',
          }}>{st.text}</div>
        )
      })}
    </div>
  )
}