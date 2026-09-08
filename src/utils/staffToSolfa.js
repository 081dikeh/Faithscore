// src/utils/staffToSolfa.js
//
// Converts a Score (staff notation) score into a Solfa (tonic sol-fa) score.
//
// v1 scope, deliberately: pitch + basic rhythm + chords (see
// expandChordVoices below). Independently-authored ties/slurs, lyrics, and
// mid-score modulation are NOT carried over yet — those are real features,
// not afterthoughts, and trying to get everything right in one pass risks
// getting the common case (a plain SATB hymn/anthem with no exotic
// notation) subtly wrong. This gets that common case right first.
//
// ── The two apps' data models, and why this isn't just a pitch lookup ──────
//
// Pitch is the easy part — Score stores absolute pitch (step + accidental +
// octave), Solfa stores a movable-doh syllable + relative octave against a
// key. Converting between them is just arithmetic (see scorePitchToMidi /
// midiToSolfa below), and most of that math already existed in solfaStore.js
// for the mid-score-modulation bridge-syllable feature.
//
// Rhythm is the real problem. Score represents a measure as a flat list of
// notes with an absolute duration (in quarter-beat units). Solfa represents
// a measure as a list of BEATS (one per time-signature numerator), each
// beat holding events whose duration is 1–4 quarter-UNITS *of that one
// beat* — see the CORE MODEL comment at the top of solfaStore.js. A note
// that's longer than one beat (e.g. a half note in 4/4) has no single
// representation in Solfa's model at all: it has to become a 'note' event
// in the beat it starts in, followed by 'sustain' events (the dash
// continuation you'd see in a real engraved sol-fa score) filling however
// many further beats it spans. That splitting is what most of this file is
// actually doing.

import { KEY_ROOTS, SOLFA_SEMITONES, buildEmptySolfaScore, VOICE_COMBOS, VOICE_OCTAVE_OFFSET } from '../store/solfaStore'
import { noteDuration, MAJOR_SCALES } from '../store/scoreStore'

// ─── Pitch ──────────────────────────────────────────────────────────────────

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

// Score's pitch.octave is scientific-pitch-notation (matches VexFlow — "c/4"
// is middle C), but Score's own internal semitone math (shiftPitchStep etc.)
// computes absolute pitch as step+octave*12, which is 12 short of the
// standard MIDI number for the same octave. Solfa's KEY_ROOTS uses real MIDI
// numbers (C4 = 60), so converting through here needs the +1 octave
// correction to land on the same absolute pitch both apps agree is "middle
// C" — this is *not* the same formula Score uses internally for itself.
export function scorePitchToMidi(pitch) {
  if (!pitch) return null
  let pc = STEP_PC[pitch.step] ?? 0
  if (pitch.accidental === '#') pc += 1
  else if (pitch.accidental === 'b') pc -= 1
  return pc + (pitch.octave + 1) * 12
}

const SEMITONE_TO_SOLFA = Object.fromEntries(
  Object.entries(SOLFA_SEMITONES).map(([syl, s]) => [s, syl]),
)

// Like solfaStore's midiToSolfaSyllable, but also returns the relative
// octave — needed here since a converted note has to carry both.
export function midiToSolfa(midi, key = 'C') {
  const root = KEY_ROOTS[key] ?? 60
  const rel = midi - root
  const octave = Math.floor(rel / 12)
  const semis = rel - octave * 12 // 0..11, floor-based so negatives are safe
  const syllable = SEMITONE_TO_SOLFA[semis] ?? 'd'
  return { syllable, octave }
}

// Same as midiToSolfa, but applies the INVERSE of the same per-voice
// octave offset solfaToStaff.js's solfaToMidiForVoice applies (Bass
// sounds a full octave lower than its written syllable by convention —
// see VOICE_OCTAVE_OFFSET in solfaStore.js). Storing the octave one
// higher than the literal pitch here is what makes that offset a no-op
// for a Score→Solfa→Score round trip: convert down here, then back up
// when the Solfa score is later read for playback or converted back —
// without this, a Bass part would come back an extra octave too low.
export function midiToSolfaForVoice(midi, key, voiceId) {
  const offset = VOICE_OCTAVE_OFFSET[voiceId] || 0
  const result = midiToSolfa(midi, key)
  return { syllable: result.syllable, octave: result.octave - offset }
}

// Score's key signature is a circle-of-fifths integer (0=C, 1=G, -1=F, …).
// Solfa's key is a letter name. Reuses the exact tonic spelling Score
// itself would show for that key signature, falling back to a plain
// enharmonic match by pitch class for the rare extreme keys (6–7
// sharps/flats) that fall outside Solfa's practical KEY_ROOTS set.
const PC_TO_KEY_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function keySignatureToSolfaKey(keySignature) {
  const tonic = MAJOR_SCALES[String(keySignature || 0)]?.[0]
  if (tonic && KEY_ROOTS[tonic] != null) return tonic
  if (tonic) {
    const pc = STEP_PC[tonic[0]] + (tonic[1] === '#' ? 1 : tonic[1] === 'b' ? -1 : 0)
    return PC_TO_KEY_NAME[((pc % 12) + 12) % 12]
  }
  return 'C'
}

// ─── Rhythm re-quantization ─────────────────────────────────────────────────
//
// Converts one measure's flat Score note list into Solfa's beats[] array.
// `warnings` is a shared array the caller collects messages into.

const QUARTER_UNITS_PER_BEAT = 4

function makeSolfaEvent(type, syllable, octave, durationQU) {
  return { id: crypto.randomUUID(), type, syllable, octave, lyric: null, duration: durationQU }
}

export function convertMeasureToSolfaBeats(notes, timeSignature, key, voiceId, warnings) {
  const ts = timeSignature || { beats: 4, beatType: 4 }
  const beatCount = ts.beats
  // How many Score quarter-beats does ONE Solfa beat span? Solfa always
  // treats the time signature's numerator as the beat count (6/8 → 6
  // beats, each an eighth-note pulse) — see the module comment.
  const qbPerSolfaBeat = 4 / ts.beatType
  // How many Score quarter-beats does one Solfa quarter-UNIT span?
  const qbPerQuarterUnit = qbPerSolfaBeat / QUARTER_UNITS_PER_BEAT

  // Flatten to absolute-quarter-unit spans. By the time this runs, any
  // chord has already been resolved into a separate voice one level up
  // (see expandChordVoices) — this function only ever sees ONE pitch per
  // moment, exactly like the pre-chord-support version did.
  let cursorQB = 0
  const spans = []
  for (const n of notes.filter(x => !x.chordWith)) {
    const durQB = noteDuration(n)
    const startQU = cursorQB / qbPerQuarterUnit
    const endQU = (cursorQB + durQB) / qbPerQuarterUnit
    spans.push({
      startQU: Math.round(startQU),
      endQU: Math.round(endQU),
      isRest: !!n.isRest,
      pitch: n.pitch,
    })
    if (Math.abs(startQU - Math.round(startQU)) > 0.05 || Math.abs(endQU - Math.round(endQU)) > 0.05) {
      warnings.push(`A note didn't line up with sol-fa's beat grid and was rounded to the nearest quarter-unit.`)
    }
    cursorQB += durQB
  }

  const totalQU = beatCount * QUARTER_UNITS_PER_BEAT
  const beats = Array.from({ length: beatCount }, () => ({ id: crypto.randomUUID(), events: [] }))

  for (const span of spans) {
    let syllable = null, octave = 0
    if (!span.isRest && span.pitch) {
      const midi = scorePitchToMidi(span.pitch)
      const solfa = midiToSolfaForVoice(midi, key, voiceId)
      syllable = solfa.syllable
      octave = solfa.octave
    }

    let remaining = Math.min(span.endQU, totalQU) - span.startQU
    let posQU = span.startQU
    let firstPiece = true
    while (remaining > 0 && posQU < totalQU) {
      const beatIdx = Math.floor(posQU / QUARTER_UNITS_PER_BEAT)
      const offsetInBeat = posQU - beatIdx * QUARTER_UNITS_PER_BEAT
      const spaceLeftInBeat = QUARTER_UNITS_PER_BEAT - offsetInBeat
      const pieceDur = Math.min(remaining, spaceLeftInBeat)

      if (pieceDur > 0) {
        const type = span.isRest ? 'rest' : (firstPiece ? 'note' : 'sustain')
        beats[beatIdx].events.push(
          makeSolfaEvent(type, type === 'note' ? syllable : null, octave, pieceDur),
        )
      }

      posQU += pieceDur
      remaining -= pieceDur
      firstPiece = false
    }
  }

  // Any beat that ended up with no events at all (shouldn't normally
  // happen if the source measure was itself fully filled with notes/rests,
  // but guards against a source measure that was under-filled) gets an
  // explicit whole-beat rest, matching solfaStore's own convention.
  for (const beat of beats) {
    if (beat.events.length === 0) {
      beat.events.push(makeSolfaEvent('rest', null, 0, QUARTER_UNITS_PER_BEAT))
    }
  }

  return beats
}

// ─── Part mapping ───────────────────────────────────────────────────────────
//
// Score parts are freeform (any name/instrument/clef). Solfa parts come
// from a fixed VOICE_COMBOS set. Matches by name where possible (Soprano →
// s, Alto → a, Tenor → t, Bass → b, Piano → piano), falling back to
// positional matching against the closest-sized voice combo.

const NAME_TO_VOICE_ID = {
  soprano: 's', alto: 'a', tenor: 't', bass: 'b', piano: 'piano', solo: 'solo', voice: 'solo',
}

function pickVoiceCombo(scoreParts) {
  const matched = scoreParts.map(p => NAME_TO_VOICE_ID[(p.name || '').trim().toLowerCase()] || null)
  const matchedSet = new Set(matched.filter(Boolean))
  // Prefer an exact voice-combo match by matched ID set — but only if that
  // combo actually has room for every part, INCLUDING any chord-split
  // voices that don't carry a recognizable name (like "Soprano (chord
  // voice 2)"). Without the length check, a SATB score with even one
  // divisi chord would still match the plain 4-voice 'satb' combo by name
  // alone and silently drop the extra voice, when a bigger combo
  // (satb_piano, 5 voices) could actually have held it.
  for (const [comboKey, combo] of Object.entries(VOICE_COMBOS)) {
    const comboIds = new Set(combo.voices.map(v => v.id))
    if (comboIds.size === matchedSet.size && comboIds.size >= scoreParts.length
        && [...comboIds].every(id => matchedSet.has(id))) {
      return comboKey
    }
  }
  // Fall back by part count. 5 is the largest combo that exists
  // (satb_piano / solo_satb) — anything beyond that has to fall back to
  // the biggest available and lose the excess; convertStaffScoreToSolfa
  // warns the user explicitly when that happens rather than silently
  // dropping parts (this can now happen more easily than before chord
  // splitting existed — a 4-part score with even one chord needs a 5th
  // voice, and a 4-part score with a 2-note chord needs a 6th).
  const n = scoreParts.length
  if (n <= 1) return 'solo'
  if (n === 2) return 'sa'
  if (n === 3) return 'sab'
  if (n === 4) return 'satb'
  return 'satb_piano'
}

// A chord companion (see addChordNote in scoreStore.js) always mirrors its
// primary note's duration/dots exactly and only ever exists for the exact
// span of that one primary note — it has no independent rhythm. That
// invariant is what makes this tractable: splitting a chorded part into N
// separate "voice slots" (one per simultaneous pitch) just means walking
// each primary note in order and, for slot k>0, substituting either the
// k-th companion's pitch (same duration as the primary) or a plain rest of
// that same duration where no companion exists at that moment — every
// slot ends up with EXACTLY the same rhythmic shape as the original part,
// just different pitches (or silence) in some of them.
//
// Slot assignment is by AUTHORING ORDER, not sorted pitch: slot 0 is
// always the note actually entered (the "primary"), slot 1 is the first
// companion added via chord mode, slot 2 the second, and so on. This is a
// deliberate, documented simplification — real SATB voice-leading would
// sort by pitch instead, but that needs tracking voice identity
// consistently across an entire phrase (a note that's the middle pitch in
// one chord and the top pitch in the next shouldn't visually swap which
// sol-fa voice it belongs to), which is real design work beyond what a
// direct companion-order mapping needs for a first pass at this.
//
// Returns [scorePart] unchanged (as a single-element array) if the part
// has no chords anywhere — this is a no-op for the overwhelmingly common
// case of a plain, chordless SATB/solo score.
function expandChordVoices(scorePart, warnings) {
  const maxCompanions = Math.max(
    0,
    ...scorePart.measures.map(m => {
      const counts = {}
      for (const n of m.notes) {
        if (n.chordWith) counts[n.chordWith] = (counts[n.chordWith] || 0) + 1
      }
      return Math.max(0, ...Object.values(counts))
    }),
  )
  if (maxCompanions === 0) return [scorePart]

  warnings.push(
    `"${scorePart.name || 'A part'}" has chords — split into ${maxCompanions + 1} ` +
    `separate sol-fa voices so every chord tone is preserved and editable ` +
    `(sol-fa can't show a chord within a single line the way staff notation can).`
  )

  const slots = []
  for (let slot = 0; slot <= maxCompanions; slot++) {
    const measures = scorePart.measures.map(m => {
      const primaries = m.notes.filter(n => !n.chordWith)
      const notes = primaries.map(primary => {
        if (slot === 0) return primary
        const companions = m.notes.filter(n => n.chordWith === primary.id)
        const companion = companions[slot - 1]
        if (companion) return { ...companion, chordWith: undefined }
        // No chord tone in this slot for this particular note — hold the
        // same rhythmic position as a rest, so this voice's timing still
        // lines up with slot 0 and every other slot.
        return { id: crypto.randomUUID(), isRest: true, duration: primary.duration, dots: primary.dots }
      })
      return { ...m, notes }
    })
    slots.push({
      ...scorePart,
      id: slot === 0 ? scorePart.id : `${scorePart.id}__chord${slot}`,
      name: slot === 0 ? scorePart.name : `${scorePart.name} (chord voice ${slot + 1})`,
      measures,
    })
  }
  return slots
}

// ─── Top-level entry point ─────────────────────────────────────────────────
//
// Returns { score: <solfa score>, warnings: string[] }.
export function convertStaffScoreToSolfa(staffScore) {
  const warnings = []
  const expandedParts = staffScore.parts.flatMap(p => expandChordVoices(p, warnings))
  const comboKey = pickVoiceCombo(expandedParts)
  const combo = VOICE_COMBOS[comboKey]

  if (expandedParts.length > combo.voices.length) {
    warnings.push(
      `This score needs ${expandedParts.length} simultaneous sol-fa voices (after splitting ` +
      `out chords), but the largest supported combo only has ${combo.voices.length}. ` +
      `${expandedParts.length - combo.voices.length} voice(s) could not be included.`
    )
  }

  const firstMeasure = staffScore.parts[0]?.measures?.[0]
  const startKeySig = firstMeasure?.keySignature ?? 0
  const startKey = keySignatureToSolfaKey(startKeySig)
  const startTs = firstMeasure?.timeSignature || { beats: 4, beatType: 4 }

  const solfaScore = buildEmptySolfaScore(comboKey, startKey, startTs.beats, 0)
  solfaScore.title = staffScore.title || 'Untitled'
  solfaScore.composer = staffScore.composer || ''
  solfaScore.tempo = staffScore.tempo || 80
  solfaScore.timeSignature = startTs

  // Assign each Solfa voice slot the best-matching Score part (by name where
  // possible), so "Soprano" in Score reliably becomes "S" in Solfa rather
  // than depending on part order lining up.
  const usedScoreParts = new Set()
  const partForVoice = combo.voices.map(voice => {
    let match = expandedParts.find(p =>
      !usedScoreParts.has(p) && NAME_TO_VOICE_ID[(p.name || '').trim().toLowerCase()] === voice.id,
    )
    if (!match) {
      match = expandedParts.find(p => !usedScoreParts.has(p))
    }
    if (match) usedScoreParts.add(match)
    return match
  })

  solfaScore.parts = combo.voices.map((voice, i) => {
    const scorePart = partForVoice[i]
    if (!scorePart) {
      warnings.push(`No matching Score part found for "${voice.name}" — left empty.`)
      return { id: voice.id, name: voice.name, label: voice.label, measures: [] }
    }

    const measures = scorePart.measures.map(measure => {
      const ts = measure.timeSignature || startTs
      const keySig = measure.keySignature ?? startKeySig
      const key = keySignatureToSolfaKey(keySig)
      // v1 doesn't carry mid-score key changes into keyChanges yet — every
      // measure is converted using ITS OWN key signature independently, so
      // the pitches come out correct even though the modulation itself
      // isn't recorded as a keyChanges entry. See module comment.
      if (keySig !== startKeySig) {
        warnings.push(`This part changes key partway through — pitches are converted correctly, but the key change itself isn't marked in the sol-fa score yet.`)
      }
      const beats = convertMeasureToSolfaBeats(measure.notes, ts, key, voice.id, warnings)
      return { id: crypto.randomUUID(), timeSignature: ts, beats }
    })

    return { id: voice.id, name: voice.name, label: voice.label, measures }
  })

  return { score: solfaScore, warnings: [...new Set(warnings)] }
}