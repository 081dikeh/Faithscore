// src/store/solfaStore.js
// FaithScore — Solfa notation data model, parser, and store
// Based on movable-Do system as used in choral/tonic-sol-fa tradition

import { create } from 'zustand'

// ── SOLFA PITCH MAP ────────────────────────────────────────────────────────────
// Maps solfa syllable → semitone offset from tonic (Do = 0)
export const SOLFA_SEMITONES = {
  d: 0, de: 1,
  r: 2, ri: 3,
  m: 4,
  f: 5, fe: 6,
  s: 7, se: 8,
  l: 9, ta: 10,
  t: 11,
}

// Chromatic key → MIDI root note (octave 4)
export const KEY_ROOTS = {
  C: 60, 'C#': 61, Db: 61, D: 62, 'D#': 63, Eb: 63,
  E: 64, F: 65, 'F#': 66, Gb: 66, G: 67, 'G#': 68,
  Ab: 68, A: 69, 'A#': 70, Bb: 70, B: 71,
}

// Convert a solfa note to absolute MIDI pitch
export function solfaToMidi(syllable, octave = 0, key = 'C') {
  const root = KEY_ROOTS[key] ?? 60
  const offset = SOLFA_SEMITONES[syllable.toLowerCase()] ?? 0
  return root + offset + (octave * 12)
}

// ── DURATION MODEL ─────────────────────────────────────────────────────────────
// In solfa notation, rhythm is expressed by separators not note shapes:
//   :  = 1 beat (a full beat position)
//   .  = ½ beat (subdivides one beat into 2)
//   ,  = ¼ beat (subdivides one beat into 4)
//   -  = sustain / hold (extends the previous note into this beat position)
//   (space) = empty / rest for that beat position
//
// Duration values (in beats):
export const DURATION_VALUES = {
  beat:    1,      // : position — whole beat
  half:    0.5,    // . position — half beat
  quarter: 0.25,   // , position — quarter beat
}

// ── DATA STRUCTURES ────────────────────────────────────────────────────────────
// A single solfa note/event:
// {
//   id: uuid,
//   type: 'note' | 'rest' | 'sustain' | 'barline' | 'breath',
//   syllable: 'd' | 'r' | 'm' | 'f' | 's' | 'l' | 't' | null,
//   octave: number,         // 0 = middle, 1 = upper, -1 = lower
//   duration: number,       // in beats (1, 0.5, 0.25)
//   beatPosition: number,   // position within measure (0-based)
//   lyric: string | null,
//   underline: boolean,     // true = lower octave notation (underline)
//   overline: boolean,      // true = upper octave notation (overline)
//   tuplet: { num, den, groupId } | null,
// }

// A measure in solfa:
// {
//   id: uuid,
//   notes: SolfaNote[],
//   timeSignature: { beats: 4, beatType: 4 },
// }

// A part/voice in solfa:
// {
//   id: uuid,
//   name: 'Soprano' | 'Alto' | 'Tenor' | 'Bass' | string,
//   voiceLabel: 'S' | 'A' | 'T' | 'B' | string,
//   measures: SolfaMeasure[],
// }

// ── PARSER ─────────────────────────────────────────────────────────────────────
// Parses a solfa text string into structured SolfaNote arrays.
// Handles: d r m f s l t, octave marks (1 = upper, , = lower),
//          beat separators (:), half-beat (.), quarter-beat (,),
//          sustain (-), rest (space/empty), barlines (|)

const SYLLABLES = new Set(['d','de','r','ri','m','f','fe','s','se','l','ta','t'])

export function parseSolfaText(text, timeSig = { beats: 4, beatType: 4 }) {
  const measures = []
  let currentMeasure = { id: crypto.randomUUID(), notes: [], timeSignature: timeSig }
  let beatPos = 0

  // Tokenize: split on measure boundaries first
  const rawMeasures = text.split('|').map(s => s.trim()).filter(Boolean)

  for (const rawM of rawMeasures) {
    currentMeasure = { id: crypto.randomUUID(), notes: [], timeSignature: timeSig }
    beatPos = 0

    // Split on beat separator ':' to get beat groups
    const beatGroups = rawM.split(':')

    for (const group of beatGroups) {
      const trimmed = group.trim()
      if (!trimmed) {
        // Empty group = rest for 1 beat
        currentMeasure.notes.push({
          id: crypto.randomUUID(),
          type: 'rest',
          syllable: null,
          octave: 0,
          duration: 1,
          beatPosition: beatPos,
          lyric: null,
        })
        beatPos += 1
        continue
      }

      // Parse tokens within the beat group
      // A beat group can contain:
      //   single note: d, r, m, f, s, l, t  (= 1 full beat)
      //   sustained:   -                     (= hold previous note)
      //   half-beat:   d.m  or  d.d          (dot separates halves)
      //   quarter-beat: d,r,m,f  (commas separate quarters)

      // Check for sustain
      if (trimmed === '-') {
        currentMeasure.notes.push({
          id: crypto.randomUUID(),
          type: 'sustain',
          syllable: null,
          octave: 0,
          duration: 1,
          beatPosition: beatPos,
          lyric: null,
        })
        beatPos += 1
        continue
      }

      // Check for half-beat subdivision (dot)
      if (trimmed.includes('.')) {
        const halves = trimmed.split('.')
        const halfDur = 0.5
        let subPos = beatPos
        for (const half of halves) {
          const note = parseSingleNote(half.trim(), subPos, halfDur)
          if (note) currentMeasure.notes.push(note)
          subPos += halfDur
        }
        beatPos += 1
        continue
      }

      // Check for quarter-beat subdivision (comma between notes)
      // e.g. "d,r,m,f" = 4 quarter notes in one beat
      if (trimmed.includes(',') && trimmed.replace(/[drmfsltr1,]/g, '').length === 0) {
        const quarters = trimmed.split(',').filter(Boolean)
        const quarterDur = 1 / quarters.length
        let subPos = beatPos
        for (const q of quarters) {
          const note = parseSingleNote(q.trim(), subPos, quarterDur)
          if (note) currentMeasure.notes.push(note)
          subPos += quarterDur
        }
        beatPos += 1
        continue
      }

      // Single note for this full beat
      const note = parseSingleNote(trimmed, beatPos, 1)
      if (note) currentMeasure.notes.push(note)
      beatPos += 1
    }

    measures.push(currentMeasure)
  }

  return measures
}

function parseSingleNote(token, beatPos, duration) {
  if (!token || token === '') return {
    id: crypto.randomUUID(), type: 'rest', syllable: null,
    octave: 0, duration, beatPosition: beatPos, lyric: null,
  }
  if (token === '-') return {
    id: crypto.randomUUID(), type: 'sustain', syllable: null,
    octave: 0, duration, beatPosition: beatPos, lyric: null,
  }

  // Extract octave modifier
  // Upper octave: d1 or D (uppercase in some traditions, or trailing 1)
  // Lower octave: d, with trailing comma OR subscript convention
  let syllable = token.toLowerCase()
  let octave = 0

  // Trailing '1' means upper octave
  if (syllable.endsWith('1')) { syllable = syllable.slice(0, -1); octave = 1 }
  // Leading comma means lower octave (some notations)
  if (syllable.startsWith("'")) { syllable = syllable.slice(1); octave = 1 }
  // Trailing comma at end of token (not separator)
  // Uppercase = upper octave in some systems
  if (token === token.toUpperCase() && token.length === 1) octave = 1

  if (!SYLLABLES.has(syllable)) return null

  return {
    id: crypto.randomUUID(),
    type: 'note',
    syllable,
    octave,
    duration,
    beatPosition: beatPos,
    lyric: null,
    underline: octave === -1,
    overline: octave === 1,
  }
}

// ── LAYOUT MODES ───────────────────────────────────────────────────────────────
// From analysis of the samples, three layouts exist:
// 1. 'linear'  — single voice, measures in rows (Exultet style)
// 2. 'satb'    — multiple voices stacked per system (Thank You God style)
// 3. 'grid'    — table of measures with section labels (Lead us Home style)

// ── EMPTY SOLFA SCORE ──────────────────────────────────────────────────────────
function makeEmptySolfaMeasure(beats = 4) {
  const notes = []
  for (let i = 0; i < beats; i++) {
    notes.push({
      id: crypto.randomUUID(), type: 'rest', syllable: null,
      octave: 0, duration: 1, beatPosition: i, lyric: null,
    })
  }
  return { id: crypto.randomUUID(), notes, timeSignature: { beats, beatType: 4 } }
}

export const EMPTY_SOLFA_SCORE = {
  id: crypto.randomUUID(),
  title: 'Untitled',
  key: 'C',          // tonic — "Doh is C"
  tempo: 80,
  timeSignature: { beats: 4, beatType: 4 },
  layout: 'satb',    // 'linear' | 'satb' | 'grid'
  parts: [
    { id: 'soprano', name: 'Soprano', voiceLabel: 'S',
      measures: Array.from({ length: 12 }, () => makeEmptySolfaMeasure(4)) },
    { id: 'alto',    name: 'Alto',    voiceLabel: 'A',
      measures: Array.from({ length: 12 }, () => makeEmptySolfaMeasure(4)) },
    { id: 'tenor',   name: 'Tenor',   voiceLabel: 'T',
      measures: Array.from({ length: 12 }, () => makeEmptySolfaMeasure(4)) },
    { id: 'bass',    name: 'Bass',    voiceLabel: 'B',
      measures: Array.from({ length: 12 }, () => makeEmptySolfaMeasure(4)) },
  ],
  sections: [],  // [{ id, label: 'CHORUS', startMeasure, endMeasure }]
  dynamics: [],
  lyrics: {},    // { partId: { measureIndex: { beatPos: 'syllable' } } }
}

// ── STORE ──────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set, get) => ({
  score: EMPTY_SOLFA_SCORE,

  selectedPartId:     'soprano',
  selectedMeasureIdx: null,
  selectedNoteId:     null,
  inputMode:          'select',   // 'select' | 'note'

  // ── Score metadata ──────────────────────────────────────────────────────────
  setTitle:          (t) => set(s => ({ score: { ...s.score, title: t } })),
  setKey:            (k) => set(s => ({ score: { ...s.score, key: k } })),
  setTempo:          (t) => set(s => ({ score: { ...s.score, tempo: t } })),
  setLayout:         (l) => set(s => ({ score: { ...s.score, layout: l } })),
  setTimeSignature:  (ts) => set(s => ({ score: { ...s.score, timeSignature: ts } })),

  // ── Note input ──────────────────────────────────────────────────────────────
  setInputMode:    (m) => set({ inputMode: m }),
  selectMeasure:   (partId, idx) => set({ selectedPartId: partId, selectedMeasureIdx: idx, selectedNoteId: null }),
  selectNote:      (id) => set({ selectedNoteId: id }),
  clearSelection:  () => set({ selectedNoteId: null, selectedMeasureIdx: null }),

  // Place a solfa note at a specific beat position
  placeNote: (partId, measureIdx, beatPos, syllable, octave = 0, duration = 1) => {
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          // Replace note(s) at this beat position
          const newNote = {
            id: crypto.randomUUID(),
            type: 'note', syllable, octave, duration,
            beatPosition: beatPos, lyric: null,
            underline: octave === -1, overline: octave === 1,
          }
          // Remove old notes at this position
          const filtered = m.notes.filter(n =>
            n.beatPosition < beatPos || n.beatPosition >= beatPos + duration
          )
          const merged = [...filtered, newNote].sort((a, b) => a.beatPosition - b.beatPosition)
          return { ...m, notes: merged }
        })
        return { ...p, measures }
      })
      return { score: { ...s.score, parts } }
    })
  },

  // Clear a beat position → rest
  clearNote: (partId, measureIdx, beatPos) => {
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const notes = m.notes.map(n =>
            n.beatPosition === beatPos
              ? { ...n, type: 'rest', syllable: null, octave: 0 }
              : n
          )
          return { ...m, notes }
        })
        return { ...p, measures }
      })
      return { score: { ...s.score, parts } }
    })
  },

  // Add a lyric to a specific note
  setLyric: (partId, measureIdx, beatPos, lyric) => {
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const notes = m.notes.map(n =>
            n.beatPosition === beatPos ? { ...n, lyric } : n
          )
          return { ...m, notes }
        })
        return { ...p, measures }
      })
      return { score: { ...s.score, parts } }
    })
  },

  addMeasure: () => {
    set(s => {
      const ts = s.score.timeSignature
      const parts = s.score.parts.map(p => ({
        ...p,
        measures: [...p.measures, makeEmptySolfaMeasure(ts.beats)],
      }))
      return { score: { ...s.score, parts } }
    })
  },

  loadScore: (score) => set({ score }),
}))