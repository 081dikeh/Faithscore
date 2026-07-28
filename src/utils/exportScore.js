// src/utils/exportScore.js
// ─────────────────────────────────────────────────────────────────────────────
// Export utilities: MusicXML, MIDI (via binary), Print/PDF
// ─────────────────────────────────────────────────────────────────────────────

import { DURATION_BEATS, noteDuration, measureCapacity, normalizeMeasure, PAGE_SIZES_MM } from '../store/scoreStore'

// ── Helpers ───────────────────────────────────────────────────────────────────
function xml(tag, attrs, ...children) {
  const attrStr = Object.entries(attrs||{}).map(([k,v]) => ` ${k}="${v}"`).join('')
  const inner = children.flat().join('\n')
  return `<${tag}${attrStr}>${inner}</${tag}>`
}
function xmlLeaf(tag, val, attrs) {
  const attrStr = Object.entries(attrs||{}).map(([k,v]) => ` ${k}="${v}"`).join('')
  return `<${tag}${attrStr}>${val}</${tag}>`
}

const DUR_TO_XML = { w:'whole', h:'half', q:'quarter', '8':'eighth', '16':'16th', '32':'32nd' }
const DUR_TO_DIVS = { w:16, h:8, q:4, '8':2, '16':1, '32':0 }  // divisions=4 per quarter
const DIVISIONS = 4  // quarter note = 4 divisions

// Maps our internal articulation-mark names to MusicXML notation elements.
// Some live under <articulations>, some are their own <notations> sibling
// (fermata), and some live under <ornaments>.
const ARTICULATION_XML = {
  staccato: { group: 'articulations', tag: 'staccato' },
  staccatissimo: { group: 'articulations', tag: 'staccatissimo' },
  tenuto: { group: 'articulations', tag: 'tenuto' },
  accent: { group: 'articulations', tag: 'accent' },
  marcato: { group: 'articulations', tag: 'strong-accent' },
  portato: { group: 'articulations', tag: 'detached-legato' },
  fermata: { group: 'fermata', tag: 'fermata' },
  trill: { group: 'ornaments', tag: 'trill-mark' },
  mordent: { group: 'ornaments', tag: 'mordent' },
  turn: { group: 'ornaments', tag: 'turn' },
  harmonic: { group: 'technical', tag: 'harmonic' },
  'snap-pizz': { group: 'technical', tag: 'snap-pizzicato' },
}

const DYNAMIC_TAGS = new Set(['ppp','pp','p','mp','mf','f','ff','fff','sfz','fp'])

// ── MusicXML Export ────────────────────────────────────────────────────────────
export function exportMusicXML(score) {
  const parts = score.parts
  const numMeasures = Math.max(...parts.map(p => p.measures.length), 0)

  const partListItems = parts.map((p, i) =>
    xml('score-part', { id: `P${i+1}` },
      xmlLeaf('part-name', p.name)
    )
  )

  const partElements = parts.map((part, pi) => {
    const clef = part.clef || 'treble'
    const measures = []

    for (let mi = 0; mi < numMeasures; mi++) {
      const m   = part.measures[mi]
      if (!m) continue
      const ts  = m.timeSignature || { beats: 4, beatType: 4 }
      const ks  = m.keySignature ?? 0
      const capacity = measureCapacity(ts)

      const attrs = mi === 0 ? xml('attributes', {},
        xmlLeaf('divisions', DIVISIONS),
        xml('key', {}, xmlLeaf('fifths', ks)),
        xml('time', {}, xmlLeaf('beats', ts.beats), xmlLeaf('beat-type', ts.beatType)),
        xml('clef', {},
          xmlLeaf('sign', clef === 'bass' ? 'F' : 'G'),
          xmlLeaf('line', clef === 'bass' ? '4' : '2')
        )
      ) : ''

      // ── Gather every marking that belongs to this part+measure, tagged with
      // the beat it should appear before ────────────────────────────────────
      const pending = []
      ;(score.dynamics||[]).forEach(d => {
        if (d.partId === part.id && d.measureIndex === mi)
          pending.push({ beat: d.beat, xml: xml('direction', { placement: 'below' },
            xml('direction-type', {}, xml('dynamics', {},
              DYNAMIC_TAGS.has(d.value) ? xml(d.value, {}) : xmlLeaf('other-dynamics', d.value)
            ))
          )})
      })
      ;(score.staffTexts||[]).forEach(t => {
        if (t.partId === part.id && t.measureIndex === mi)
          pending.push({ beat: t.beat, xml: xml('direction', { placement: 'above' },
            xml('direction-type', {}, xmlLeaf('words', t.text))
          )})
      })
      ;(score.rehearsalMarks||[]).forEach(r => {
        if (r.measureIndex === mi && pi === 0) // rehearsal marks are score-wide; attach once, on the top part
          pending.push({ beat: 0, xml: xml('direction', { placement: 'above' },
            xml('direction-type', {}, xmlLeaf('rehearsal', r.text))
          )})
      })
      ;(score.hairpins||[]).forEach(h => {
        if (h.partId !== part.id) return
        if (h.startMeasure === mi)
          pending.push({ beat: h.startBeat, xml: xml('direction', { placement: 'below' },
            xml('direction-type', {}, xml('wedge', { type: h.type === 'cresc' ? 'crescendo' : 'diminuendo', number: '1' }))
          )})
        if (h.endMeasure === mi)
          pending.push({ beat: h.endBeat, xml: xml('direction', { placement: 'below' },
            xml('direction-type', {}, xml('wedge', { type: 'stop', number: '1' }))
          )})
      })
      pending.sort((a, b) => a.beat - b.beat)

      let cursorBeat = 0
      const noteElements = []
      const flushPendingUpTo = (beat) => {
        while (pending.length && pending[0].beat <= beat + 1e-6) {
          noteElements.push(pending.shift().xml)
        }
      }

      m.notes.filter(n => !n.chordWith).forEach(n => {
        flushPendingUpTo(cursorBeat)

        const dur  = noteDuration(n)
        const divs = Math.round(dur * DIVISIONS)
        const type = DUR_TO_XML[n.duration] || 'quarter'

        // Per-note notations: articulations / fermata / ornaments / technical
        const marks = n.articulations || (n.articulation ? [n.articulation] : [])
        const grouped = {}
        marks.forEach(mark => {
          const info = ARTICULATION_XML[mark]
          if (!info) return
          grouped[info.group] = grouped[info.group] || []
          grouped[info.group].push(xml(info.tag, {}))
        })
        const notationChildren = []
        if (n.tieStart) notationChildren.push(xml('tied', { type: 'start' }))
        if (grouped.articulations) notationChildren.push(xml('articulations', {}, ...grouped.articulations))
        if (grouped.fermata) notationChildren.push(...grouped.fermata)
        if (grouped.ornaments) notationChildren.push(xml('ornaments', {}, ...grouped.ornaments))
        if (grouped.technical) notationChildren.push(xml('technical', {}, ...grouped.technical))
        const notations = notationChildren.length ? xml('notations', {}, ...notationChildren) : ''

        if (n.isRest) {
          noteElements.push(xml('note', {},
            xml('rest', {}),
            xmlLeaf('duration', divs),
            xmlLeaf('type', type),
          ))
        } else {
          const p   = n.pitch
          const acc = p.accidental === '#' ? 'sharp' : p.accidental === 'b' ? 'flat'
                    : p.accidental === '##' ? 'double-sharp' : p.accidental === 'bb' ? 'flat-flat' : ''

          noteElements.push(xml('note', {},
            xml('pitch', {},
              xmlLeaf('step', p.step),
              acc ? xmlLeaf('alter', acc === 'sharp' ? 1 : acc === 'flat' ? -1 : acc === 'double-sharp' ? 2 : -2) : '',
              xmlLeaf('octave', p.octave),
            ),
            xmlLeaf('duration', divs),
            xmlLeaf('type', type),
            acc ? xml('accidental', {}, acc) : '',
            n.dots ? xml('dot', {}) : '',
            n.tieStart ? xml('tie', { type: 'start' }) : '',
            n.lyric ? xml('lyric', { number: '1' }, xmlLeaf('text', n.lyric)) : '',
            notations,
          ))
        }
        cursorBeat += dur
      })
      // Anything still pending belongs at the very end of the measure
      flushPendingUpTo(capacity)

      // ── Barline (double / final / repeat marks) ───────────────────────────
      const barlineEntry = (score.barlines||[]).find(b => b.measureIndex === mi)
      let barlineElements = []
      if (barlineEntry) {
        if (barlineEntry.type === 'repeat-start') {
          barlineElements.push(xml('barline', { location: 'left' },
            xmlLeaf('bar-style', 'heavy-light'),
            xml('repeat', { direction: 'forward' })
          ))
        } else {
          const styleMap = { double: 'light-light', final: 'light-heavy', 'repeat-end': 'light-heavy', 'repeat-both': 'light-heavy' }
          barlineElements.push(xml('barline', { location: 'right' },
            xmlLeaf('bar-style', styleMap[barlineEntry.type] || 'regular'),
            (barlineEntry.type === 'repeat-end' || barlineEntry.type === 'repeat-both') ? xml('repeat', { direction: 'backward' }) : ''
          ))
        }
      }

      measures.push(xml('measure', { number: mi + 1 }, attrs, ...noteElements, ...barlineElements))
    }

    return xml('part', { id: `P${pi+1}` }, ...measures)
  })

  const doc = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
${xml('score-partwise', { version: '3.1' },
  xml('work', {}, xmlLeaf('work-title', score.title || 'Untitled')),
  xmlLeaf('movement-title', score.title || 'Untitled'),
  xml('identification', {},
    xml('encoding', {}, xmlLeaf('software', 'ScoreAI'))
  ),
  xml('part-list', {}, ...partListItems),
  ...partElements
)}`

  download(doc, `${score.title || 'score'}.xml`, 'application/vnd.recordare.musicxml+xml')
}

// ── MusicXML Import ────────────────────────────────────────────────────────────
const XML_TO_DUR = { whole:'w', half:'h', quarter:'q', eighth:'8', '16th':'16', '32nd':'32', '64th':'64' }
const XML_TO_ARTICULATION = {}
Object.entries(ARTICULATION_XML).forEach(([name, info]) => { XML_TO_ARTICULATION[info.tag] = name })

function importUid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// Parses a MusicXML string (score-partwise) into a score object matching this
// app's data model (see EMPTY_SCORE in scoreStore.js). Returns { score, warnings }.
// score is null if the file couldn't be parsed at all; warnings lists anything
// that was skipped or approximated (this app doesn't support every MusicXML
// feature — multi-voice staves and grace notes are the main gaps).
export function importMusicXML(xmlText) {
  let doc
  try {
    doc = new DOMParser().parseFromString(xmlText, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('The file is not valid XML.')
  } catch (e) {
    return { score: null, warnings: ['Could not parse this file as MusicXML: ' + e.message] }
  }

  const root = doc.documentElement
  if (root.tagName === 'score-timewise') {
    return { score: null, warnings: [
      'This file uses "timewise" MusicXML layout, which isn\'t supported. ' +
      'Please re-export it as "partwise" (the default in most notation software).'
    ] }
  }
  if (root.tagName !== 'score-partwise') {
    return { score: null, warnings: ['This doesn\'t look like a MusicXML file (expected <score-partwise>).'] }
  }

  const title = root.querySelector('work > work-title')?.textContent?.trim()
    || root.querySelector('movement-title')?.textContent?.trim()
    || 'Imported Score'
  const composerEl = Array.from(root.querySelectorAll('identification > creator'))
    .find(c => c.getAttribute('type') === 'composer')
  const composer = composerEl?.textContent?.trim() || ''

  let tempo = 120
  const soundTempo = root.querySelector('sound[tempo]')
  if (soundTempo) {
    const t = Math.round(parseFloat(soundTempo.getAttribute('tempo')))
    if (t > 0) tempo = t
  } else {
    const perMin = root.querySelector('metronome > per-minute')
    if (perMin) {
      const t = Math.round(parseFloat(perMin.textContent))
      if (t > 0) tempo = t
    }
  }

  const partNameById = {}
  root.querySelectorAll('part-list > score-part').forEach(sp => {
    partNameById[sp.getAttribute('id')] = sp.querySelector('part-name')?.textContent?.trim() || sp.getAttribute('id')
  })

  const partEls = Array.from(root.querySelectorAll('part'))
  if (!partEls.length) return { score: null, warnings: ['No parts found in this file.'] }

  const dynamics = [], hairpins = [], rehearsalMarks = [], staffTexts = [], barlines = []
  let skippedVoiceNotes = 0, sawGraceNotes = false, sawUnsupportedDur = false

  const parts = partEls.map((partEl, pi) => {
    const xmlPartId = partEl.getAttribute('id')
    const name = partNameById[xmlPartId] || `Part ${pi + 1}`
    const internalPartId = `part-${importUid()}`

    let divisions = 4
    let clef = 'treble'
    let currentTs = { beats: 4, beatType: 4 }
    let currentKs = 0

    const measures = Array.from(partEl.querySelectorAll('measure')).map((measureEl, mi) => {
      const attrsEl = measureEl.querySelector('attributes')
      if (attrsEl) {
        const divEl = attrsEl.querySelector('divisions')
        if (divEl) divisions = parseFloat(divEl.textContent) || divisions
        const fifths = attrsEl.querySelector('key > fifths')
        if (fifths) currentKs = parseInt(fifths.textContent, 10) || 0
        const beats = attrsEl.querySelector('time > beats')
        const beatType = attrsEl.querySelector('time > beat-type')
        if (beats && beatType) {
          currentTs = { beats: parseInt(beats.textContent, 10) || 4, beatType: parseInt(beatType.textContent, 10) || 4 }
        }
        const clefSign = attrsEl.querySelector('clef > sign')
        if (clefSign) {
          const sign = clefSign.textContent
          clef = sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : 'treble'
        }
      }

      const capacity = measureCapacity(currentTs)
      const notes = []
      let cursorBeat = 0
      let firstVoiceSeen = null
      let lastRealNoteId = null

      Array.from(measureEl.children).forEach(child => {
        const tag = child.tagName
        if (tag === 'direction') {
          const dyn = child.querySelector('direction-type > dynamics')
          if (dyn) {
            const dynEl = Array.from(dyn.children)[0]
            const value = dynEl?.tagName === 'other-dynamics' ? dynEl.textContent : dynEl?.tagName
            if (value) dynamics.push({ id: importUid(), partId: internalPartId, measureIndex: mi, beat: cursorBeat, value })
          }
          const words = child.querySelector('direction-type > words')
          if (words && words.textContent.trim()) {
            staffTexts.push({ id: importUid(), partId: internalPartId, measureIndex: mi, beat: cursorBeat, text: words.textContent.trim() })
          }
          const rehearsal = child.querySelector('direction-type > rehearsal')
          if (rehearsal && pi === 0) {
            rehearsalMarks.push({ id: importUid(), measureIndex: mi, text: rehearsal.textContent.trim() })
          }
          const wedge = child.querySelector('direction-type > wedge')
          if (wedge) {
            const type = wedge.getAttribute('type')
            if (type === 'crescendo' || type === 'diminuendo') {
              hairpins.push({
                id: importUid(), partId: internalPartId, startMeasure: mi, startBeat: cursorBeat,
                endMeasure: mi, endBeat: capacity, type: type === 'crescendo' ? 'cresc' : 'decresc',
              })
            } else if (type === 'stop') {
              const last = hairpins.filter(h => h.partId === internalPartId).pop()
              if (last) { last.endMeasure = mi; last.endBeat = cursorBeat }
            }
          }
        } else if (tag === 'barline') {
          const style = child.querySelector('bar-style')?.textContent
          const repeat = child.querySelector('repeat')
          let type = null
          if (repeat?.getAttribute('direction') === 'forward') type = 'repeat-start'
          else if (repeat?.getAttribute('direction') === 'backward') type = 'repeat-end'
          else if (style === 'light-light') type = 'double'
          else if (style === 'light-heavy') type = 'final'
          if (type) barlines.push({ id: importUid(), measureIndex: mi, type })
        } else if (tag === 'backup') {
          skippedVoiceNotes++
        } else if (tag === 'note') {
          const voice = child.querySelector('voice')?.textContent || '1'
          if (firstVoiceSeen === null) firstVoiceSeen = voice
          if (voice !== firstVoiceSeen) { skippedVoiceNotes++; return }
          if (child.querySelector('grace')) { sawGraceNotes = true; return }

          const isChord = !!child.querySelector('chord')
          const isRest = !!child.querySelector('rest')
          const typeEl = child.querySelector('type')
          const duration = typeEl ? (XML_TO_DUR[typeEl.textContent] || 'q') : 'q'
          if (typeEl && !XML_TO_DUR[typeEl.textContent]) sawUnsupportedDur = true
          const dots = child.querySelectorAll('dot').length

          const timeMod = child.querySelector('time-modification')
          let tuplet = null
          if (timeMod) {
            const actual = parseInt(timeMod.querySelector('actual-notes')?.textContent, 10)
            const normal = parseInt(timeMod.querySelector('normal-notes')?.textContent, 10)
            if (actual && normal) tuplet = { num: actual, den: normal }
          }

          const noteObj = { id: importUid(), isRest, pitch: null, duration, dots: dots || 0 }
          if (tuplet) noteObj.tuplet = tuplet

          if (!isRest) {
            const step = child.querySelector('pitch > step')?.textContent || 'C'
            const octave = parseInt(child.querySelector('pitch > octave')?.textContent, 10)
            const alter = parseInt(child.querySelector('pitch > alter')?.textContent || '0', 10)
            const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : ''
            noteObj.pitch = { step, octave: isNaN(octave) ? 4 : octave, accidental }

            if (Array.from(child.querySelectorAll('tie')).some(t => t.getAttribute('type') === 'start')) {
              noteObj.tieStart = true
            }
            const lyricText = child.querySelector('lyric > text')?.textContent
            if (lyricText) noteObj.lyric = lyricText

            const arts = []
            child.querySelectorAll('notations > articulations > *').forEach(a => { if (XML_TO_ARTICULATION[a.tagName]) arts.push(XML_TO_ARTICULATION[a.tagName]) })
            child.querySelectorAll('notations > fermata').forEach(() => arts.push('fermata'))
            child.querySelectorAll('notations > ornaments > *').forEach(o => { if (XML_TO_ARTICULATION[o.tagName]) arts.push(XML_TO_ARTICULATION[o.tagName]) })
            child.querySelectorAll('notations > technical > *').forEach(t => { if (XML_TO_ARTICULATION[t.tagName]) arts.push(XML_TO_ARTICULATION[t.tagName]) })
            if (arts.length) noteObj.articulations = arts
          }

          const beatLen = DURATION_BEATS[duration + (dots ? 'd' : '')] || DURATION_BEATS[duration] || 1
          if (isChord && lastRealNoteId) {
            noteObj.chordWith = lastRealNoteId
          } else {
            lastRealNoteId = noteObj.id
            cursorBeat += beatLen
          }
          notes.push(noteObj)
        }
      })

      // normalizeMeasure guarantees exact capacity fill regardless of any
      // rounding drift or incomplete measures in the source file.
      return {
        id: importUid(),
        timeSignature: { ...currentTs },
        keySignature: currentKs,
        notes: normalizeMeasure(notes, capacity),
      }
    })

    return { id: internalPartId, name, instrument: 'piano', clef, measures }
  })

  // Defensive: pad all parts to the same measure count
  const maxMeasures = Math.max(...parts.map(p => p.measures.length), 0)
  const paddedParts = parts.map(p => {
    if (p.measures.length >= maxMeasures) return p
    const last = p.measures[p.measures.length - 1]
    const ts = last?.timeSignature || { beats: 4, beatType: 4 }
    const extra = Array.from({ length: maxMeasures - p.measures.length }, () => ({
      id: importUid(), timeSignature: ts, keySignature: last?.keySignature || 0,
      notes: normalizeMeasure([], measureCapacity(ts)),
    }))
    return { ...p, measures: [...p.measures, ...extra] }
  })

  const warnings = []
  if (skippedVoiceNotes > 0) {
    warnings.push(`This file has more than one voice per staff (e.g. divisi or a counter-melody sharing a staff) — only the first voice in each measure was imported. ${skippedVoiceNotes} additional note(s) were skipped.`)
  }
  if (sawGraceNotes) warnings.push("Grace notes were found and skipped — they aren't supported yet.")
  if (sawUnsupportedDur) warnings.push('Some notes had an unusual duration type and were approximated as quarter notes.')

  const score = {
    id: importUid(),
    title, composer, tempo,
    parts: paddedParts,
    dynamics, hairpins, rehearsalMarks, staffTexts, barlines, octaveLines: [],
  }

  return { score, warnings }
}

// ── MIDI Export ────────────────────────────────────────────────────────────────
// Builds a minimal Type-0 MIDI file from scratch (no external library needed)
export function exportMIDI(score) {
  const tempo      = score.tempo || 120
  const uspb       = Math.round(60_000_000 / tempo)  // microseconds per beat
  const TPQ        = 480  // ticks per quarter note

  function varLen(n) {
    // Variable-length MIDI encoding
    const bytes = []
    bytes.push(n & 0x7F)
    n >>= 7
    while (n > 0) { bytes.unshift((n & 0x7F) | 0x80); n >>= 7 }
    return bytes
  }

  const NOTE_ON  = 0x90
  const NOTE_OFF = 0x80

  // Build events for all parts merged into one track (Type-0)
  const events = []

  // Tempo event at tick 0
  events.push({ tick: 0, data: [0xFF, 0x51, 0x03, (uspb>>16)&0xFF, (uspb>>8)&0xFF, uspb&0xFF] })

  const parts = score.parts
  const numM  = Math.max(...parts.map(p => p.measures.length), 0)

  let globalTick = 0
  for (let mi = 0; mi < numM; mi++) {
    const beats = measureCapacity(parts[0]?.measures[mi]?.timeSignature)

    for (const part of parts) {
      const m = part.measures[mi]
      if (!m) continue

      const ch = parts.indexOf(part)  // channel per part
      let beatCursor = 0

      for (const note of m.notes.filter(n => !n.chordWith)) {
        const durBeats = noteDuration(note)
        const durTicks = Math.round(durBeats * TPQ)

        if (!note.isRest && note.pitch) {
          const midi = pitchToMidi(note.pitch)
          const tick = globalTick + Math.round(beatCursor * TPQ)
          events.push({ tick, data: [NOTE_ON | ch, midi, 80] })
          events.push({ tick: tick + durTicks - 10, data: [NOTE_OFF | ch, midi, 0] })
        }
        beatCursor += durBeats
      }
    }

    globalTick += Math.round(beats * TPQ)
  }

  // End of track
  events.push({ tick: globalTick, data: [0xFF, 0x2F, 0x00] })
  events.sort((a, b) => a.tick - b.tick)

  // Convert to delta-time events
  let prevTick = 0
  const trackBytes = []
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - prevTick)
    prevTick = ev.tick
    trackBytes.push(...varLen(delta), ...ev.data)
  }

  // Build MIDI file bytes
  const header = [
    0x4D,0x54,0x68,0x64,  // MThd
    0,0,0,6,              // length = 6
    0,0,                  // format = 0 (single track)
    0,1,                  // num tracks = 1
    (TPQ>>8)&0xFF, TPQ&0xFF  // ticks per quarter
  ]

  const trackLen = trackBytes.length
  const track = [
    0x4D,0x54,0x72,0x6B,  // MTrk
    (trackLen>>24)&0xFF, (trackLen>>16)&0xFF, (trackLen>>8)&0xFF, trackLen&0xFF,
    ...trackBytes
  ]

  const bytes = new Uint8Array([...header, ...track])
  downloadBytes(bytes, `${score.title || 'score'}.mid`, 'audio/midi')
}

function pitchToMidi(pitch) {
  const base = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 }
  let semi = base[pitch.step] + (pitch.octave + 1) * 12
  if (pitch.accidental === '#') semi++
  if (pitch.accidental === 'b') semi--
  if (pitch.accidental === '##') semi+=2
  if (pitch.accidental === 'bb') semi-=2
  return Math.max(0, Math.min(127, semi))
}

// ── Print / PDF ────────────────────────────────────────────────────────────────
// printScore — prints in THIS window rather than a new popup.
//
// Why not a popup: VexFlow loads the Bravura music font via the FontFace API
// straight into document.fonts — it is never registered as a CSS @font-face
// rule in document.styleSheets, so there was never any font CSS to copy into
// a new window. Printing in the current window sidesteps that: the font is
// already loaded and already rendering correctly right here.
//
// Why explicit slicing: the whole score is ONE tall, continuous <svg>. Left
// to the browser's native print pagination, that single element is treated
// as an atomic, non-fragmentable block — if it doesn't fit in the space left
// on a page, browsers just push it whole to the next page (or, worse, clip
// it at an arbitrary pixel with no regard for where systems fall), which is
// exactly what produced the blank first page / skipped systems / cropped
// clef bug. Instead we compute each system's Y-position ourselves (using the
// small system-start measure-number label ScoreRenderer already draws at a
// known x-position), group systems into page-sized chunks ourselves, and
// render each chunk as its OWN cropped <svg> (via viewBox) in its own
// print-page block with an explicit page-break-after. Each page is then a
// small, simple, already-correctly-sized element — nothing for the browser's
// pagination to get wrong.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// A4 default page geometry (mm) — actual values used at print time come from
// score.pageSettings (see Page Settings in the Format menu); these are just
// the fallback for scores that predate that setting.
const DEFAULT_PAGE_W_MM   = 210
const DEFAULT_PAGE_H_MM   = 297
const DEFAULT_MARGIN_TOP  = 8
const DEFAULT_MARGIN_BOT  = 8
const DEFAULT_MARGIN_SIDE = 14
const HEADER_H_MM_EST = 9 // rough estimate of .fs-print-header's rendered height

// ScoreRenderer draws each system's starting measure number as text at a
// fixed x=24, y = systemTopY - 10 (see ScoreRenderer's `ctx.fillText(String(startCol+1), 24, sysY-10)`).
// We use those labels purely as position markers — they're on-page anyway.
function findSystemTops(svg) {
  const markers = Array.from(svg.querySelectorAll('text'))
    .map(t => ({
      y: parseFloat(t.getAttribute('y')),
      x: parseFloat(t.getAttribute('x')),
      text: (t.textContent || '').trim(),
    }))
    .filter(m => /^\d+$/.test(m.text) && !isNaN(m.y) && !isNaN(m.x) && Math.abs(m.x - 24) < 2)
    .sort((a, b) => a.y - b.y)
  if (markers.length < 2) return null
  return markers.map(m => m.y + 10) // undo the "-10" offset used when drawing
}

// Groups system top-positions into page-sized chunks (in the SVG's own
// coordinate units), returning [{ y, height }, ...] slices.
function paginateSystems(sysTops, totalH, usableFirstUnits, usableRestUnits) {
  const n = sysTops.length
  const bottoms = sysTops.slice(1).concat([totalH]) // bottoms[i] = bottom Y of system i
  const slices = []
  let pageStart = 0
  let usable = usableFirstUnits
  for (let i = 0; i < n; i++) {
    const heightIfIncluded = bottoms[i] - sysTops[pageStart]
    if (heightIfIncluded > usable && i > pageStart) {
      // System i doesn't fit on the current page — close the page at the
      // previous system's bottom and start a fresh page at system i.
      slices.push({ y: sysTops[pageStart], height: bottoms[i - 1] - sysTops[pageStart] })
      pageStart = i
      usable = usableRestUnits
    }
  }
  slices.push({ y: sysTops[pageStart], height: bottoms[n - 1] - sysTops[pageStart] })
  return slices
}

// Builds one cropped <svg> clone showing only [y, y+height) of the original.
function cropSvg(svg, totalW, y, height) {
  const clone = svg.cloneNode(true)
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.setAttribute('viewBox', `0 ${y} ${totalW} ${height}`)
  clone.style.width  = '100%'
  clone.style.height = 'auto'
  clone.style.display = 'block'
  return clone
}

export function printScore(score) {
  const title    = score?.title    || 'Untitled Score'
  const composer = score?.composer || ''

  const ps = score?.pageSettings || {}
  const sizeMm = PAGE_SIZES_MM[ps.size] || PAGE_SIZES_MM.A4
  const PAGE_W_MM   = sizeMm.w
  const PAGE_H_MM   = sizeMm.h
  const MARGIN_TOP  = ps.marginTop    ?? DEFAULT_MARGIN_TOP
  const MARGIN_BOT  = ps.marginBottom ?? DEFAULT_MARGIN_BOT
  const MARGIN_SIDE = ps.marginSide   ?? DEFAULT_MARGIN_SIDE
  const USABLE_W_MM = PAGE_W_MM - MARGIN_SIDE * 2
  const USABLE_H_MM = PAGE_H_MM - MARGIN_TOP - MARGIN_BOT

  const pages = document.querySelectorAll('.score-page')
  if (!pages.length) { alert('Nothing to print yet — add some notes first.'); return }

  const svgElements = []
  pages.forEach(page => {
    page.querySelectorAll('svg').forEach(svg => svgElements.push(svg))
  })
  if (!svgElements.length) { alert('No score SVG found.'); return }

  // Clean up any leftovers from a previous print (e.g. if afterprint never fired)
  document.getElementById('faithscore-print-root')?.remove()
  document.getElementById('faithscore-print-style')?.remove()

  // ── Build the print-only DOM ────────────────────────────────────────────
  const root = document.createElement('div')
  root.id = 'faithscore-print-root'

  const pageEl = document.createElement('div')
  pageEl.className = 'fs-print-page'

  const header = document.createElement('div')
  header.className = 'fs-print-header'
  header.innerHTML = `<h1>${escapeHtml(title)}</h1>${composer ? `<p>${escapeHtml(composer)}</p>` : ''}`
  pageEl.appendChild(header)

  const rows = []
  svgElements.forEach(svg => {
    const vb = svg.viewBox && svg.viewBox.baseVal
    const totalW = (vb && vb.width)  || svg.width.baseVal.value  || svg.getBoundingClientRect().width
    const totalH = (vb && vb.height) || svg.height.baseVal.value || svg.getBoundingClientRect().height

    const scaleUnitsPerMm  = totalW / USABLE_W_MM
    const usableFirstUnits = (USABLE_H_MM - HEADER_H_MM_EST) * scaleUnitsPerMm
    const usableRestUnits  = USABLE_H_MM * scaleUnitsPerMm

    const sysTops = findSystemTops(svg)
    const slices = sysTops
      ? paginateSystems(sysTops, totalH, Math.max(usableFirstUnits, 1), Math.max(usableRestUnits, 1))
      : [{ y: 0, height: totalH }] // couldn't detect systems — fall back to one uncut block

    slices.forEach(slice => {
      const clone = cropSvg(svg, totalW, slice.y, slice.height)
      const row = document.createElement('div')
      row.className = 'fs-print-row'
      row.appendChild(clone)
      rows.push(row)
    })
  })

  rows.forEach((row, i) => {
    pageEl.appendChild(row)
    if (i < rows.length - 1) {
      row.style.breakAfter = 'page'
      row.style.pageBreakAfter = 'always'
    }
    row.style.breakInside = 'avoid'
    row.style.pageBreakInside = 'avoid'
  })

  root.appendChild(pageEl)
  document.body.appendChild(root)

  // ── Print-only styling: hidden on screen, shown (and everything else
  //    hidden) during printing ──────────────────────────────────────────────
  const style = document.createElement('style')
  style.id = 'faithscore-print-style'
  style.textContent = `
    #faithscore-print-root { display: none; }
    .fs-print-header {
      text-align: center; margin-bottom: 2mm; padding-bottom: 1mm;
      border-bottom: 0.5pt solid #ccc; font-family: 'Times New Roman', serif;
    }
    .fs-print-header h1 { font-size: 15pt; font-weight: bold; margin: 0; }
    .fs-print-header p  { font-size: 9pt; color: #555; text-align: right; margin: 1mm 0 0; }
    .fs-print-row { width: 100%; }
    .fs-print-row svg { width: 100% !important; height: auto !important; display: block; }
    @media print {
      body > *:not(#faithscore-print-root) { display: none !important; }
      #faithscore-print-root { display: block !important; }
      @page { size: ${PAGE_W_MM}mm ${PAGE_H_MM}mm; margin: ${MARGIN_TOP}mm ${MARGIN_SIDE}mm ${MARGIN_BOT}mm ${MARGIN_SIDE}mm; }
    }
  `
  document.head.appendChild(style)

  // The browser's own print header/footer (date/time, page title, URL, page
  // numbers) is NOT something a web page can fully remove — it's controlled
  // by the browser's print dialog ("Headers and footers" toggle), and there
  // is no CSS/JS override for the date, URL, or page-number portions. The
  // page TITLE portion, though, comes from document.title — so we blank
  // that for the duration of the print job, which removes the "faithscore"
  // text specifically. For the timestamp/URL to disappear too, the user
  // still needs to switch off "Headers and footers" in their browser's
  // print dialog (usually under "More settings").
  const prevTitle = document.title
  document.title = ''

  const cleanup = () => {
    document.getElementById('faithscore-print-root')?.remove()
    document.getElementById('faithscore-print-style')?.remove()
    document.title = prevTitle
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)

  // Give the browser a couple of frames to lay out the cloned SVGs before
  // opening the print dialog (avoids printing a stale/empty layout).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.print()
    // Fallback in case `afterprint` doesn't fire (happens in some
    // print-to-PDF / headless flows) — clean up after a delay regardless.
    setTimeout(cleanup, 8000)
  }))
}

// ── Download helpers ──────────────────────────────────────────────────────────
function download(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadBytes(bytes, filename, mimeType) {
  const blob = new Blob([bytes], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}