// src/utils/solfaToStaff.js
//
// Converts a Solfa (tonic sol-fa) score into a Score (staff notation) score
// — the reverse of staffToSolfa.js, completing the round trip.
//
// Same v1 scope as the forward direction, for the same reasons (see the
// module comment in staffToSolfa.js): pitch + rhythm only. Ties ARE
// produced here, but only the ones structurally required to represent a
// note held across a beat boundary (merging 'note'+'sustain' chains back
// into a single sustained pitch) — not independently-authored slur/tie
// markings, lyrics, chords, or mid-score modulation. Those are still
// phase 2/3, same as before.
//
// ── Why this direction is actually easier ───────────────────────────────
//
// The pitch math re-uses solfaStore's own solfaToMidi() and scoreStore's
// own spellPitch() directly — both already existed for the mid-score
// modulation bridge-syllable feature, so there's no new pitch math to
// write at all here, just the plumbing between them.
//
// The rhythm side is the mirror image of the split staffToSolfa.js did:
// instead of breaking one long note into a note+sustain chain across
// beats, this MERGES a note+sustain chain back into one span, converts
// that span's length into Score's quarter-beat units, and decomposes it
// into Score's discrete duration+dots note values — tying multiple Score
// notes together (via tieStart) if no single note value covers the whole
// span exactly. That decomposition isn't new either: it reuses
// scoreStore's own beatsToRest(), the same greedy largest-fits-first
// algorithm normalizeMeasure() already uses when a note needs to be split
// across a measure boundary.

import { solfaToMidiForVoice, migrateMeasure } from '../store/solfaStore'
import { spellPitch, MAJOR_SCALES, beatsToRest, DURATION_BEATS, EMPTY_SCORE } from '../store/scoreStore'

// ─── Pitch ──────────────────────────────────────────────────────────────────

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function pitchClassOf(name) {
  let pc = STEP_PC[name[0]] ?? 0
  if (name[1] === '#') pc += 1
  else if (name[1] === 'b') pc -= 1
  return ((pc % 12) + 12) % 12
}

// Reverse of staffToSolfa's keySignatureToSolfaKey — Solfa's letter-name
// key back to Score's circle-of-fifths integer, via the same MAJOR_SCALES
// table both directions already share.
export function solfaKeyToKeySignature(key) {
  for (const [num, scale] of Object.entries(MAJOR_SCALES)) {
    if (scale[0] === key) return Number(num)
  }
  const pc = pitchClassOf(key)
  for (const [num, scale] of Object.entries(MAJOR_SCALES)) {
    if (pitchClassOf(scale[0]) === pc) return Number(num)
  }
  return 0
}

// Solfa's syllable+octave+key -> Score's step+accidental+octave.
// midi here is a real MIDI number (solfaToMidi's own convention, e.g.
// C4=60) — Score's own octave field uses standard scientific pitch
// notation too (matches VexFlow), so the conversion is the ordinary MIDI
// formula, NOT the +12-off formula Score uses for its own internal
// shiftPitchStep/HalfStep math (see staffToSolfa.js's comment on
// scorePitchToMidi for why those two are deliberately different).
//
// voiceId, if given, applies the same implicit per-voice octave offset
// playback uses (solfaStore's VOICE_OCTAVE_OFFSET) — Bass sounds a full
// octave lower than its written syllable by convention, so a converted
// Staff score needs that applied too, or it would show/sound a different
// pitch than the Solfa score it came from.
export function solfaToScorePitch(syllable, octave, key, voiceId) {
  const midi = solfaToMidiForVoice(syllable, octave, key, voiceId)
  const pc = ((midi % 12) + 12) % 12
  const scoreOctave = Math.floor(midi / 12) - 1
  const keySig = solfaKeyToKeySignature(key)
  const spelled = spellPitch(pc, keySig)
  return { step: spelled.step, accidental: spelled.accidental, octave: scoreOctave }
}

// ─── Rhythm: merge beats/events back into a flat, tied Score note list ─────

const QUARTER_UNITS_PER_BEAT = 4

// Decomposes a quarter-beat duration into 1+ Score notes of the given
// pitch (or a rest, if pitch is null), tying them together with tieStart
// when no single Score duration value covers the whole span — the same
// greedy algorithm and the same tie-on-truncation convention
// normalizeMeasure() already uses, just applied here to build a span
// instead of to truncate one.
function notesFromSpan(qb, pitch, warnings) {
  const notes = []
  let rem = qb
  let guard = 0
  while (rem > 0.001 && guard++ < 20) {
    const { duration, dots } = beatsToRest(rem)
    const used = DURATION_BEATS[duration + (dots ? 'd' : '')] || DURATION_BEATS[duration] || 1
    notes.push({
      id: crypto.randomUUID(),
      isRest: !pitch,
      pitch: pitch || null,
      duration, dots,
      tieStart: !pitch ? undefined : (rem - used > 0.001 || undefined),
    })
    rem -= used
  }
  if (guard >= 20) warnings.push('An unusually long note had to be capped while converting — check the result.')
  return notes
}

// Converts one Solfa measure's beats[] into a flat Score notes[] list.
export function convertSolfaBeatsToNotes(beats, timeSignature, key, voiceId, warnings) {
  const ts = timeSignature || { beats: 4, beatType: 4 }
  const qbPerSolfaBeat = 4 / ts.beatType
  const qbPerQuarterUnit = qbPerSolfaBeat / QUARTER_UNITS_PER_BEAT

  const notes = []
  // "open" tracks the pitched note or rest currently being extended by
  // sustain/consecutive-rest events, in quarter-UNITS, until the next
  // event that isn't a continuation of it closes it out.
  let open = null // { pitch: {..}|null, qu: number }

  const flush = () => {
    if (!open) return
    const qb = open.qu * qbPerQuarterUnit
    notes.push(...notesFromSpan(qb, open.pitch, warnings))
    open = null
  }

  for (let bi = 0; bi < beats.length; bi++) {
    const events = beats[bi]?.events || []

    // ── Triplet special case ────────────────────────────────────────────
    // A beat filled by exactly 3 events of duration 4/3 (a 'note' followed
    // by two 'sustain's, or occasionally a triplet on a rest) is exactly
    // how the app's own triplet feature encodes a triplet — see
    // exportSolfa.js / solfaStore's insertTriplet(). Handling it as its
    // own case here (rather than letting the generic merge logic treat
    // those fractional durations as one long tied span) keeps a triplet a
    // real Score triplet instead of an approximated chain of tied notes.
    if (events.length === 3 && events.every(e => Math.abs(e.duration - 4 / 3) < 0.01)) {
      flush()
      // Base duration = the Score note value for HALF of this beat's
      // quarter-beat span — 3 of that value at a 3:2 ratio fills the beat
      // exactly (the standard "3 in the time of 2" triplet definition).
      const half = beatsToRest(qbPerSolfaBeat / 2)
      let lastPitch = null
      events.forEach(ev => {
        let pitch = null
        if (ev.type === 'note' && ev.syllable) {
          pitch = solfaToScorePitch(ev.syllable, ev.octave || 0, key, voiceId)
          lastPitch = pitch
        } else if (ev.type === 'sustain') {
          // Continues whatever pitch the preceding 'note' in this triplet
          // was — this is the "one note held across the whole triplet,
          // just notated as a triplet region" case, distinct from (and
          // just as valid as) three separate triplet pitches.
          pitch = lastPitch
        }
        notes.push({
          id: crypto.randomUUID(),
          isRest: !pitch,
          pitch,
          duration: half.duration, dots: half.dots,
          tuplet: { num: 3, den: 2 },
        })
      })
      continue
    }

    for (const ev of events) {
      if (ev.type === 'note' && ev.syllable) {
        flush()
        open = { pitch: solfaToScorePitch(ev.syllable, ev.octave || 0, key, voiceId), qu: ev.duration }
      } else if (ev.type === 'sustain') {
        if (open && open.pitch) {
          open.qu += ev.duration
        } else {
          // A sustain with nothing open to continue (malformed/edge data)
          // — best effort: treat as a rest rather than dropping it, so
          // total measure duration still comes out right.
          warnings.push('A held note was missing what it continues from — filled with a rest instead.')
          flush()
          open = { pitch: null, qu: ev.duration }
        }
      } else { // 'rest', or anything unrecognized
        if (open && !open.pitch) {
          open.qu += ev.duration
        } else {
          flush()
          open = { pitch: null, qu: ev.duration }
        }
      }
    }
  }
  flush()

  return notes
}

// ─── Part mapping ───────────────────────────────────────────────────────────

const VOICE_ID_TO_NAME = { s: 'Soprano', a: 'Alto', t: 'Tenor', b: 'Bass', piano: 'Piano', solo: 'Voice' }

// ─── Top-level entry point ─────────────────────────────────────────────────
//
// Returns { score: <staff score>, warnings: string[] }.
export function convertSolfaScoreToStaff(solfaScore) {
  const warnings = []
  const startKey = solfaScore.key || 'C'
  const startKeySig = solfaKeyToKeySignature(startKey)
  const startTs = solfaScore.timeSignature || { beats: 4, beatType: 4 }

  const staffScore = {
    id: crypto.randomUUID(),
    title: solfaScore.title || 'Untitled',
    composer: solfaScore.composer || '',
    tempo: solfaScore.tempo || 120,
    dynamics: [], hairpins: [], rehearsalMarks: [], staffTexts: [], barlines: [], octaveLines: [],
    pageSettings: { ...EMPTY_SCORE.pageSettings },
    parts: [],
  }

  // v1 doesn't carry Solfa's note-level keyChanges into Score's per-measure
  // key signatures yet — every measure converts using the score's OWN
  // starting key, same limitation (in reverse) as staffToSolfa.js.
  if (solfaScore.keyChanges?.length) {
    warnings.push('This piece changes key partway through — pitches are converted using the starting key only for now; the modulation itself isn\'t carried over yet.')
  }

  staffScore.parts = (solfaScore.parts || []).map(voicePart => {
    const name = VOICE_ID_TO_NAME[voicePart.id] || voicePart.name || voicePart.label || 'Voice'
    const clef = voicePart.id === 'b' ? 'bass' : 'treble'

    const measures = (voicePart.measures || []).map(measure => {
      const migrated = migrateMeasure(measure)
      const ts = migrated.timeSignature || startTs
      const notes = convertSolfaBeatsToNotes(migrated.beats, ts, startKey, voicePart.id, warnings)
      return { id: crypto.randomUUID(), timeSignature: ts, keySignature: startKeySig, notes }
    })

    return { id: crypto.randomUUID(), name, instrument: 'piano', clef, measures }
  })

  return { score: staffScore, warnings: [...new Set(warnings)] }
}