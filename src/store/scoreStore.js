// src/store/scoreStore.js
import { create } from 'zustand'

// ── Auto-save helpers ─────────────────────────────────────────────────────────
const AUTOSAVE_KEY = 'scoreai_autosave'
function saveToStorage(score) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(score)) } catch(e) {}
}
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch(e) { return null }
}
export function hasSavedScore() { return !!localStorage.getItem(AUTOSAVE_KEY) }
export function clearSavedScore() { localStorage.removeItem(AUTOSAVE_KEY) }

export const DURATION_BEATS = {
  'w': 4, 'h': 2, 'q': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625,
  'wd': 6, 'hd': 3, 'qd': 1.5, '8d': 0.75, '16d': 0.375, '32d': 0.1875,
  // Triplet durations: multiply by 2/3 (3 notes in space of 2)
  'qt': 2/3, '8t': 1/3, '16t': 1/6, 'ht': 4/3,
}

export function noteDuration(note) {
  // ── Tuplet duration model ────────────────────────────────────────────────
  // A tuplet is defined by a ratio: num notes played in the time of den notes.
  // Example: triplet (3:2) means 3 notes fill the space of 2 of the same value.
  //   → each note duration = base_duration × (den / num)
  //   → quarter triplet: q × (2/3) = 2/3 beat each
  //   → eighth triplet:  8 × (2/3) = 1/3 beat each
  //   → quintuplet (5:4): base × (4/5)
  //
  // Legacy support: note.triplet (boolean) = shorthand for 3:2 ratio
  // Full support:   note.tuplet = { num: 3, den: 2 } for any ratio
  if (note.tuplet) {
    const base = DURATION_BEATS[note.duration] || 1
    return base * (note.tuplet.den / note.tuplet.num)
  }
  if (note.triplet) {
    // Legacy triplet flag — treat as 3:2
    return (DURATION_BEATS[note.duration] || 1) * 2 / 3
  }
  const key = note.duration + (note.dots ? 'd' : '')
  return DURATION_BEATS[key] || DURATION_BEATS[note.duration] || 1
}

// Returns best rest {duration, dots} to fill exactly `beats`
export function beatsToRest(beats) {
  if (beats >= 4)    return { duration: 'w',  dots: 0 }
  if (beats >= 3)    return { duration: 'h',  dots: 1 }
  if (beats >= 2)    return { duration: 'h',  dots: 0 }
  if (beats >= 1.5)  return { duration: 'q',  dots: 1 }
  if (beats >= 1)    return { duration: 'q',  dots: 0 }
  if (beats >= 0.75) return { duration: '8',  dots: 1 }
  if (beats >= 0.5)  return { duration: '8',  dots: 0 }
  if (beats >= 0.375)return { duration: '16', dots: 1 }
  if (beats >= 0.25) return { duration: '16', dots: 0 }
  if (beats >= 0.125) return { duration: '32', dots: 0 }
  return { duration: '64', dots: 0 }
}

// Build a minimal chain of rest notes to fill `beats`
function makeRests(beats, idPrefix) {
  const rests = []
  let rem = beats, i = 0
  while (rem > 0.001) {
    const { duration, dots } = beatsToRest(rem)
    const key = duration + (dots ? 'd' : '')
    const used = DURATION_BEATS[key] || DURATION_BEATS[duration] || 1
    // Always use a unique ID — prefix is kept for debugging but a random suffix
    // ensures no duplicate React keys even when normalizing multiple measures
    const uid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`
    rests.push({ id: `${idPrefix}_r${i++}_${uid}`, isRest: true, pitch: null, duration, dots })
    rem -= used
  }
  return rests
}

// CORE: Normalize a measure so notes + rests always fill exactly maxBeats
// - Removes overflow
// - Fills gaps with rests
// - Merges adjacent rests where possible
export function normalizeMeasure(notes, maxBeats) {
  const nonChord = notes.filter(n => !n.chordWith)
  const chords   = notes.filter(n =>  n.chordWith)

  const result = []
  let cursor = 0

  for (const n of nonChord) {
    if (cursor >= maxBeats - 0.001) break

    const dur     = noteDuration(n)
    const allowed = maxBeats - cursor

    if (dur > allowed + 0.001) {
      // Note too long — truncate to fit, mark tieStart so it visually ties to next bar
      const fit    = beatsToRest(allowed)
      const fitDur = DURATION_BEATS[fit.duration + (fit.dots?'d':'')] || DURATION_BEATS[fit.duration] || 1
      if (fitDur > 0.001) {
        result.push({ ...n, duration: fit.duration, dots: fit.dots, tieStart: true })
        cursor += fitDur
      }
      break
    }

    // Keep the note/rest exactly as-is — preserves rest positions between notes
    result.push(n)
    cursor += dur
  }

  // Fill any remaining space with rests
  const remaining = maxBeats - cursor
  if (remaining > 0.001) {
    result.push(...makeRests(remaining, `fill_${cursor}`))
  }

  const finalIds    = new Set(result.map(n => n.id))
  const validChords = chords.filter(c => finalIds.has(c.chordWith))
  return [...result, ...validChords]
}

// Annotate notes with _beatStart for rendering
export function annotateBeats(notes) {
  let cursor = 0
  return notes.filter(n => !n.chordWith).map(n => {
    const annotated = { ...n, _beatStart: cursor }
    cursor += noteDuration(n)
    return annotated
  })
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function makeEmptyMeasure(timeSig, keySig) {
  const ts = timeSig || { beats: 4, beatType: 4 }
  const ks = keySig ?? 0
  const rests = makeRests(ts.beats, 'init')
  return {
    id: crypto.randomUUID(),
    timeSignature: ts,
    keySignature: ks,
    notes: rests,
  }
}

function padPartsToCount(parts, count) {
  const ref = parts[0]
  const lastM = ref?.measures[ref.measures.length - 1]
  return parts.map(p => {
    if (p.measures.length >= count) return p
    const extra = Array.from({ length: count - p.measures.length }, () =>
      makeEmptyMeasure(lastM?.timeSignature, lastM?.keySignature)
    )
    return { ...p, measures: [...p.measures, ...extra] }
  })
}

export const EMPTY_SCORE = {
  id: crypto.randomUUID(),
  title: 'Untitled Score',
  composer: '',
  tempo: 120,
  parts: [
    { id: 'part-treble', name: 'Treble', instrument: 'piano', clef: 'treble', measures: Array.from({ length: 12 }, () => makeEmptyMeasure({ beats: 4, beatType: 4 }, 0)) },
    { id: 'part-bass',   name: 'Bass',   instrument: 'piano', clef: 'bass',   measures: Array.from({ length: 12 }, () => makeEmptyMeasure({ beats: 4, beatType: 4 }, 0)) },
  ],
  // Score-level markings (not attached to parts)
  // Each: { id, type, partId, measureIndex, beat, value/text }
  dynamics:         [],   // { id, partId, measureIndex, beat, value } e.g. value:'mf'
  hairpins:         [],   // { id, partId, startMeasure, startBeat, endMeasure, endBeat, type:'cresc'|'decresc' }
  rehearsalMarks:   [],   // { id, measureIndex, text } e.g. text:'A'
  staffTexts:       [],   // { id, partId, measureIndex, beat, text }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useScoreStore = create((set, get) => ({
  score: (() => {
    const saved = loadFromStorage()
    if (!saved) return EMPTY_SCORE
    // Ensure legacy saves get the new markings arrays
    return {
      dynamics: [], hairpins: [], rehearsalMarks: [], staffTexts: [],
      ...saved,
    }
  })(),

  // ── Undo / Redo history ────────────────────────────────────────────────
  _undoStack: [],   // array of score snapshots (max 50)
  _redoStack: [],

  // ── Clipboard ─────────────────────────────────────────────────────────
  clipboard: null,  // { notes, timeSignature } of copied measure

  // ── Multi-select ──────────────────────────────────────────────────────
  selectedMeasureRange: null,  // { start, end } column indices

  // ── Zoom ──────────────────────────────────────────────────────────────
  zoom: 0.8,        // default 80%

  selectedPartId: 'part-treble',
  selectedMeasureIndex: null,
  selectedNoteId: null,   // can be a real note OR a rest note id

  inputMode: 'select',
  selectedDuration: 'q',
  selectedDots: 0,
  selectedOctave: 4,
  selectedNote: { step: 'C', accidental: null, label: 'C' },
  chordMode: false,

  // ── Playback state ──────────────────────────────────────────────────────
  isPlaying:    false,    // true while Tone.js transport is running
  playbackBeat: null,     // fractional beat position (null = stopped/not started)

  setTitle: (t) => set(s => ({ score: { ...s.score, title: t } })),
  setCloudId: (id) => set(s => ({ score: { ...s.score, _cloudId: id } })),
  setComposer:  (c) => set(s => ({ score: { ...s.score, composer: c } })),
  setSubtitle:  (t) => set(s => ({ score: { ...s.score, subtitle: t } })),
  setLyricist:  (t) => set(s => ({ score: { ...s.score, lyricist: t } })),
  setCopyright: (t) => set(s => ({ score: { ...s.score, copyright: t } })),

  setPartClef: (partId, clef) => set(s => ({
    score: { ...s.score, parts: s.score.parts.map(p =>
      p.id === partId ? { ...p, clef } : p
    )}
  })),

  setPartInstrument: (partId, instrument) => set(s => ({
    score: { ...s.score, parts: s.score.parts.map(p =>
      p.id === partId ? { ...p, instrument } : p
    )}
  })),
  setTempo: (t) => set(s => ({ score: { ...s.score, tempo: t } })),
  setInputMode: (m) => set({ inputMode: m }),
  setDuration: (d) => set({ selectedDuration: d }),
  setSelectedDots: (d) => set({ selectedDots: d }),
  setSelectedOctave: (o) => set({ selectedOctave: o }),
  setSelectedNote: (n) => set({ selectedNote: n }),
  setChordMode: (v) => set({ chordMode: v }),

  setIsPlaying:    (v)    => set({ isPlaying: v }),

  setZoom: (z) => set({ zoom: Math.max(0.5, Math.min(2.0, z)) }),
  measuresPerLine: 4,
  staffSize: 10,
  setMeasuresPerLine: (v) => set({ measuresPerLine: Math.max(1, Math.min(8, Math.round(v))) }),
  setStaffSize: (v) => set({ staffSize: Math.max(6, Math.min(20, v)) }),

  // ── Snapshot (call before any mutation that should be undoable) ────────
  _snapshot: () => {
    const { score, _undoStack } = get()
    const stack = [..._undoStack, JSON.parse(JSON.stringify(score))]
    set({ _undoStack: stack.slice(-50), _redoStack: [] })
  },

  undo: () => {
    const { _undoStack, _redoStack, score } = get()
    if (_undoStack.length === 0) return
    const prev = _undoStack[_undoStack.length - 1]
    set({
      score: prev,
      _undoStack: _undoStack.slice(0, -1),
      _redoStack: [JSON.parse(JSON.stringify(score)), ..._redoStack].slice(0, 50),
      selectedNoteId: null,
    })
    saveToStorage(prev)
  },

  redo: () => {
    const { _undoStack, _redoStack, score } = get()
    if (_redoStack.length === 0) return
    const next = _redoStack[0]
    set({
      score: next,
      _undoStack: [..._undoStack, JSON.parse(JSON.stringify(score))].slice(-50),
      _redoStack: _redoStack.slice(1),
      selectedNoteId: null,
    })
    saveToStorage(next)
  },

  // ── Copy / Paste ───────────────────────────────────────────────────────
  copyMeasure: (partId, measureIndex) => {
    const part    = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure) return
    set({ clipboard: JSON.parse(JSON.stringify(measure)) })
  },

  copyMeasureRange: (startCol, endCol) => {
    // Copy all parts for all columns in range
    const { score } = get()
    const cols = []
    for (let c = startCol; c <= endCol; c++) {
      cols.push(score.parts.map(p => JSON.parse(JSON.stringify(p.measures[c] || null))))
    }
    set({ clipboard: { type: 'range', cols, partCount: score.parts.length } })
  },

  pasteMeasure: (partId, measureIndex) => {
    const { clipboard } = get()
    if (!clipboard) return
    get()._snapshot()
    if (clipboard.type === 'range') {
      clipboard.cols.forEach((partMeasures, ci) => {
        get().score.parts.forEach((p, pi) => {
          const m = partMeasures[pi]
          if (!m) return
          const newM = { ...JSON.parse(JSON.stringify(m)), id: crypto.randomUUID() }
          get()._applyToMeasure(p.id, measureIndex + ci, () => newM.notes)
        })
      })
    } else {
      // Single measure paste — regen IDs to avoid duplicates
      const newNotes = clipboard.notes.map(n => ({ ...n, id: crypto.randomUUID(),
        chordWith: n.chordWith ? undefined : undefined }))
      get()._applyToMeasure(partId, measureIndex, () => newNotes)
    }
    saveToStorage(get().score)
  },

  // ── Multi-measure selection ────────────────────────────────────────────
  setMeasureRange: (start, end) => set({
    selectedMeasureRange: start === null ? null : { start, end: end ?? start }
  }),

  extendMeasureRange: (colIndex) => {
    const { selectedMeasureRange, selectedMeasureIndex } = get()
    const base = selectedMeasureRange?.start ?? selectedMeasureIndex ?? colIndex
    const start = Math.min(base, colIndex)
    const end   = Math.max(base, colIndex)
    set({ selectedMeasureRange: { start, end } })
  },

  // ── Transpose ──────────────────────────────────────────────────────────
  transposeSelection: (semitones) => {
    // Transpose = shift the KEY SIGNATURE by semitones, not individual note pitches.
    // The circle of fifths maps semitone shifts to key signature accidental counts:
    //   +1 semitone = +7 sharps (mod 12, wrapping through flats)
    // We use a direct semitone → key number lookup instead:
    //   key number: 0=C, 1=G(1#), 2=D(2#), ... -1=F(1b), -2=Bb(2b), etc.
    // The standard mapping of chromatic semitone offset to key sig number:
    const SEMITONE_TO_KEY = {
      0: 0,   // C
      1: 7,   // Db → use 7 flats (Cb) or treat as C# (7 sharps) — use flats: -5 = Db
      2: 2,   // D
      3: -3,  // Eb
      4: 4,   // E
      5: -1,  // F
      6: 6,   // F# / Gb (use sharps)
      7: 1,   // G
      8: -4,  // Ab
      9: 3,   // A
      10: -2, // Bb
      11: 5,  // B
    }
    // Reverse lookup: key number → semitone offset
    const KEY_TO_SEMITONE = Object.fromEntries(
      Object.entries(SEMITONE_TO_KEY).map(([s, k]) => [k, Number(s)])
    )

    get()._snapshot()
    const { score } = get()

    // Get current key from first measure of first part
    const currentKey = score.parts[0]?.measures[0]?.keySignature ?? 0
    const currentSemitone = KEY_TO_SEMITONE[currentKey] ?? 0
    const newSemitone = ((currentSemitone + semitones) % 12 + 12) % 12
    const newKey = SEMITONE_TO_KEY[newSemitone] ?? 0

    // Apply new key signature to ALL measures of ALL parts
    set(s => ({
      score: {
        ...s.score,
        parts: s.score.parts.map(p => ({
          ...p,
          measures: p.measures.map(m => ({ ...m, keySignature: newKey })),
        })),
      },
    }))
    saveToStorage(get().score)
  },

  // ── Ties ──────────────────────────────────────────────────────────────
  // A tie links a note to the next note of the same pitch.
  toggleTie: () => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, score } = get()
    if (!selectedNoteId) return
    const part    = score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    const note    = measure?.notes.find(n => n.id === selectedNoteId)
    if (!note || note.isRest) return
    get()._snapshot()

    const turningOn = !note.tieStart
    // Toggle tieStart on the selected note
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
      notes.map(n => n.id === selectedNoteId ? { ...n, tieStart: turningOn } : n)
    )

    // If turning ON: check if same-pitch note already follows in this bar
    if (turningOn && note.pitch) {
      const nonChord  = measure.notes.filter(n => !n.chordWith)
      const noteIdx   = nonChord.findIndex(n => n.id === selectedNoteId)
      const sameAfter = nonChord.slice(noteIdx + 1).find(n =>
        !n.isRest &&
        n.pitch?.step   === note.pitch.step &&
        n.pitch?.octave === note.pitch.octave
      )
      // No same-pitch note in this bar → insert continuation in next bar
      if (!sameAfter) {
        const nextIdx = selectedMeasureIndex + 1
        const nextM   = part?.measures[nextIdx]
        if (nextM) {
          const firstRest = nextM.notes.find(n => n.isRest)
          if (firstRest) {
            const restBeats = noteDuration(firstRest)
            const fitBts    = Math.min(noteDuration(note), restBeats)
            const fitDur    = beatsToRest(fitBts)
            const fitActual = DURATION_BEATS[fitDur.duration+(fitDur.dots?'d':'')] || DURATION_BEATS[fitDur.duration] || 1
            const contId    = crypto.randomUUID()
            get()._applyToMeasure(selectedPartId, nextIdx, (notes) => {
              const idx      = notes.findIndex(n => n.id === firstRest.id)
              const leftover = restBeats - fitActual
              const cont     = { id: contId, isRest: false, pitch: note.pitch,
                duration: fitDur.duration, dots: fitDur.dots }
              const leftovers = leftover > 0.001 ? makeRests(leftover, `tie_${contId}`) : []
              return [...notes.slice(0, idx), cont, ...leftovers, ...notes.slice(idx + 1)]
            }, true)
          }
        }
      }
    }
    saveToStorage(get().score)
  },

  // ── Slurs ─────────────────────────────────────────────────────────────
  // ── toggleSlurStart (S key) ─────────────────────────────────────────────────
  // MuseScore-style slur: press S on a note to begin a slur.
  // The arc immediately connects to the NEXT real note (visible right away).
  // Press S again on the same note to remove the slur.
  // Press E on any later note to explicitly set the slur end there.
  toggleSlurStart: () => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, score } = get()
    if (!selectedNoteId) return
    const part    = score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    const note    = measure?.notes.find(n => n.id === selectedNoteId)
    if (!note || note.isRest) return
    get()._snapshot()

    const turningOn = !note.slurStart

    if (turningOn) {
      // Mark slurStart on this note
      get()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
        notes.map(n => n.id === selectedNoteId
          ? { ...n, slurStart: true, slurEnd: false } : n)
      )
      // Clear any previous slurEnd marks on earlier notes in this bar
      // (so only one slur group is active at a time in this measure)
    } else {
      // Remove slurStart from this note; also clear slurEnd from any note after it
      get()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes => {
        const noteIdx = notes.findIndex(n => n.id === selectedNoteId)
        return notes.map((n, i) => {
          if (n.id === selectedNoteId) return { ...n, slurStart: false }
          if (i > noteIdx && n.slurEnd)  return { ...n, slurEnd: false }
          return n
        })
      })
    }
    saveToStorage(get().score)
  },

  // ── toggleSlurEnd (E key) ────────────────────────────────────────────────────
  // Press E on any note to explicitly mark it as the slur endpoint.
  // This overrides the default "connect to next note" behaviour.
  // Press E again to remove the slur end mark.
  toggleSlurEnd: () => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, score } = get()
    if (!selectedNoteId) return
    const note = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note || note.isRest) return
    get()._snapshot()
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
      notes.map(n => n.id === selectedNoteId
        ? { ...n, slurEnd: !n.slurEnd, slurStart: false } : n)
    )
    saveToStorage(get().score)
  },
  setPlaybackBeat: (beat) => set({ playbackBeat: beat }),

  getDefaultOctaveForPart: (partId) => {
    const part = get().score.parts.find(p => p.id === partId)
    return part?.clef === 'bass' ? 3 : 4
  },

  // ── Selection ──────────────────────────────────────────────────────────────

  selectMeasure: (partId, measureIndex) => {
    const part = get().score.parts.find(p => p.id === partId)
    set({
      selectedPartId: partId,
      selectedMeasureIndex: measureIndex,
      selectedNoteId: null,
      selectedOctave: part?.clef === 'bass' ? 3 : 4,
    })
  },

  // Select any note or rest by id
  selectNote: (noteId, partId, measureIndex) => {
    const part = get().score.parts.find(p => p.id === partId)
    const note = part?.measures[measureIndex]?.notes.find(n => n.id === noteId)
    if (!note) return
    set({
      selectedNoteId: noteId,
      selectedPartId: partId,
      selectedMeasureIndex: measureIndex,
      // Sync toolbar to match selected note
      selectedDuration: note.duration,
      selectedDots: note.dots || 0,
    })
  },

  clearNoteSelection: () => set({ selectedNoteId: null }),
  clearSelection: () => set({ selectedNoteId: null, selectedMeasureIndex: null }),

  getSelectedNote: () => {
    const { score, selectedNoteId, selectedPartId, selectedMeasureIndex } = get()
    const part = score.parts.find(p => p.id === selectedPartId)
    return part?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId) || null
  },

  // ── Global settings ────────────────────────────────────────────────────────

  setGlobalKeySignature: (keySignature) => set(s => ({
    score: { ...s.score, parts: s.score.parts.map(p => ({ ...p, measures: p.measures.map(m => ({ ...m, keySignature })) })) },
  })),

  setGlobalTimeSignature: (beatsOrObj, beatType) => {
    // Accept either setGlobalTimeSignature({beats,beatType}) or setGlobalTimeSignature(beats, beatType)
    const ts = (typeof beatsOrObj === 'object' && beatsOrObj !== null)
      ? beatsOrObj
      : { beats: beatsOrObj, beatType }
    if (!ts.beats || !ts.beatType) return
    set(s => ({
      score: {
        ...s.score,
        parts: s.score.parts.map(p => ({
          ...p,
          measures: p.measures.map((m, mIdx) => ({
            ...m,
            timeSignature: ts,
            // Use unique prefix per measure to prevent duplicate React keys
            notes: normalizeMeasure(m.notes, ts.beats).map((n, ni) =>
              n.isRest && n.id.startsWith('init_')
                ? { ...n, id: `ts_${ts.beats}_${ts.beatType}_m${mIdx}_r${ni}_${Date.now()}` }
                : n
            ),
          })),
        })),
      },
    }))
  },

  // ── Core note mutation: always normalizes after every change ───────────────

  _applyToMeasure: (partId, measureIndex, fn, skipNormalize = false) => {
    set(s => {
      const part = s.score.parts.find(p => p.id === partId)
      const measure = part?.measures[measureIndex]
      if (!measure) return s
      const newNotes = fn(measure.notes, measure.timeSignature.beats)
      const normalized = skipNormalize
        ? newNotes
        : normalizeMeasure(newNotes, measure.timeSignature.beats)
      const newScore = {
        ...s.score,
        parts: s.score.parts.map(p => p.id !== partId ? p : {
          ...p,
          measures: p.measures.map((m, i) => i !== measureIndex ? m : { ...m, notes: normalized }),
        }),
      }
      // Auto-save on every mutation
      saveToStorage(newScore)
      return { score: newScore }
    })
  },

  // ── Place a note at a selected rest position ───────────────────────────────
  // When user selects a rest then presses a note key or clicks chromatic
  fillSelectedRest: (pitch) => {
    get()._snapshot()
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, selectedDuration, selectedDots } = get()
    if (!selectedNoteId || selectedMeasureIndex === null) return

    const part = get().score.parts.find(p => p.id === selectedPartId)
    const note = part?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note?.isRest) return

    // ── Triplet rest: replace in-place preserving triplet structure ───────────
    // Triplet notes must not be resized or moved — only the pitch changes.
    if (note.triplet) {
      const filled = { ...note, isRest: false, pitch }
      get()._applyToMeasure(selectedPartId, selectedMeasureIndex,
        notes => notes.map(n => n.id === selectedNoteId ? filled : n),
        true   // skipNormalize — triplet structure is fixed
      )
      // Auto-advance to the next triplet slot in the group
      const measure  = part.measures[selectedMeasureIndex]
      const nonChord = measure.notes.filter(n => !n.chordWith)
      const curIdx   = nonChord.findIndex(n => n.id === selectedNoteId)
      const nextTriplet = nonChord.find((n, i) =>
        i > curIdx && n.triplet && n.tripletGroupId === note.tripletGroupId && n.isRest
      )
      set({ selectedNoteId: nextTriplet ? nextTriplet.id : filled.id })
      saveToStorage(get().score)
      return
    }

    const restBeats = noteDuration(note)
    const newDurKey = selectedDuration + (selectedDots ? 'd' : '')
    const newBeats  = DURATION_BEATS[newDurKey] || DURATION_BEATS[selectedDuration] || 1

    if (newBeats > restBeats + 0.001) {
      // Can't fit — try to use the rest's own duration instead
      const fit = beatsToRest(restBeats)
      // Use the whole rest slot
      const newNote = {
        ...note,
        isRest: false,
        pitch,
        duration: fit.duration,
        dots: fit.dots,
      }
      get()._replaceNote(selectedNoteId, selectedPartId, selectedMeasureIndex, newNote)
      return
    }

    // Replace the rest: new note + leftover rest
    const newNoteObj = {
      id: note.id,
      isRest: false,
      pitch,
      duration: selectedDuration,
      dots: selectedDots || 0,
    }

    const leftover = restBeats - newBeats
    // skipNormalize=true: the leftover rest must stay RIGHT AFTER the new note,
    // not be moved to the end of the bar by normalizeMeasure
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx = notes.findIndex(n => n.id === selectedNoteId)
      if (idx === -1) return notes
      const before    = notes.slice(0, idx)
      const after     = notes.slice(idx + 1)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `after_${note.id}`) : []
      return [...before, newNoteObj, ...leftovers, ...after]
    }, true) // <-- skipNormalize

    set({ selectedNoteId: newNoteObj.id })
  },

  // Replace a specific note in-place (used internally)
  _replaceNote: (noteId, partId, measureIndex, newNote) => {
    get()._applyToMeasure(partId, measureIndex, (notes) =>
      notes.map(n => n.id === noteId ? newNote : n)
    )
    set({ selectedNoteId: newNote.id })
  },

  // ── Change duration of selected note/rest ──────────────────────────────────
  // This is the key feature: resize any note or rest
  changeSelectedDuration: (newDuration, newDots) => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex } = get()
    if (!selectedNoteId || selectedMeasureIndex === null) return

    const part = get().score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    if (!measure) return

    const note = measure.notes.find(n => n.id === selectedNoteId)
    if (!note) return

    const newKey   = newDuration + (newDots ? 'd' : '')
    const newBeats = DURATION_BEATS[newKey] || DURATION_BEATS[newDuration] || 1

    // CRITICAL FIX: Only count real NOTES (non-rests) as occupied beats.
    // Rests are free space — if we counted them, a note could never grow
    // back after being shrunk (e.g. whole → quarter → whole would be blocked).
    // normalizeMeasure will automatically absorb or recreate rests around
    // the resized note to keep the measure exactly full.
    const otherRealNotes = measure.notes.filter(n =>
      !n.chordWith && !n.isRest && n.id !== selectedNoteId
    )
    const othersBeats = otherRealNotes.reduce((sum, n) => sum + noteDuration(n), 0)
    const available = measure.timeSignature.beats - othersBeats

    if (newBeats > available + 0.001) {
      // Note overflows the bar.
      // Step 1: fit what we can into this bar (with tieStart so VexFlow draws the tie)
      const fit      = beatsToRest(available)
      const fitKey   = fit.duration + (fit.dots ? 'd' : '')
      const fitBeats = DURATION_BEATS[fitKey] || DURATION_BEATS[fit.duration] || 1
      if (fitBeats < 0.001) return

      get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
        notes.map(n => n.id === selectedNoteId
          ? { ...n, duration: fit.duration, dots: fit.dots, tieStart: true }
          : n)
      )
      set({ selectedDuration: newDuration, selectedDots: newDots || 0 })

      // Step 2: insert continuation note in the next bar (the overflow beats)
      const overflowBeats = newBeats - fitBeats
      if (overflowBeats > 0.001 && note.pitch && !note.isRest) {
        const nextIdx  = selectedMeasureIndex + 1
        const nextPart = get().score.parts.find(p => p.id === selectedPartId)
        const nextM    = nextPart?.measures[nextIdx]
        if (nextM) {
          const contBeats = Math.min(overflowBeats, nextM.timeSignature.beats)
          const contDur   = beatsToRest(contBeats)
          const contId    = crypto.randomUUID()
          get()._applyToMeasure(selectedPartId, nextIdx, (notes) => {
            const firstRestIdx = notes.findIndex(n => n.isRest && !n.chordWith)
            if (firstRestIdx < 0) return notes
            const firstRest = notes[firstRestIdx]
            const restBeats = noteDuration(firstRest)
            const contNote  = {
              id: contId, isRest: false, pitch: note.pitch,
              duration: contDur.duration, dots: contDur.dots,
            }
            const leftover  = restBeats - contBeats
            const leftovers = leftover > 0.001 ? makeRests(leftover, `cont_${contId}`) : []
            return [
              ...notes.slice(0, firstRestIdx),
              contNote,
              ...leftovers,
              ...notes.slice(firstRestIdx + 1),
            ]
          }, true) // skipNormalize so continuation note stays in position
        }
      }
      return
    }

    // Normal case: note fits within bar.
    // Use skipNormalize=true and manually manage the rest(s) around the note
    // so the freed/consumed space stays RIGHT NEXT TO the changed note.
    const oldBeats = noteDuration(note)
    const delta    = newBeats - oldBeats  // positive = growing, negative = shrinking

    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx = notes.findIndex(n => n.id === selectedNoteId)
      if (idx < 0) return notes

      // Apply new duration to the note itself
      const newNote = { ...notes[idx], duration: newDuration, dots: newDots || 0, tieStart: false }
      const result  = [...notes]
      result[idx]   = newNote

      if (delta < -0.001) {
        // ── Shrinking: insert freed rest immediately after the note ──────────
        const freed = -delta
        const newRests = makeRests(freed, `shrink_${selectedNoteId}`)
        result.splice(idx + 1, 0, ...newRests)

        // Remove any duplicate rests that normalizeMeasure would have left
        // (there shouldn't be any since we're using skipNormalize, but trim
        //  if total beats now exceed maxBeats)
        let total = 0
        const trimmed = []
        for (const n of result.filter(x => !x.chordWith)) {
          const d = noteDuration(n)
          if (total + d > measure.timeSignature.beats + 0.001) {
            // Trim this rest to fit
            const rem = measure.timeSignature.beats - total
            if (rem > 0.001) trimmed.push(...makeRests(rem, `trim_${n.id}`))
            break
          }
          trimmed.push(n)
          total += d
        }
        // Re-attach chords
        const chords = result.filter(x => x.chordWith)
        const ids    = new Set(trimmed.map(n => n.id))
        return [...trimmed, ...chords.filter(c => ids.has(c.chordWith))]

      } else if (delta > 0.001) {
        // ── Growing: consume rests immediately after the note ────────────────
        let toAbsorb = delta
        let i = idx + 1
        while (toAbsorb > 0.001 && i < result.length) {
          const n = result[i]
          if (n.chordWith) { i++; continue }
          if (!n.isRest) break  // hit a real note — can't absorb
          const rd = noteDuration(n)
          if (rd <= toAbsorb + 0.001) {
            result.splice(i, 1)  // remove entire rest
            toAbsorb -= rd
          } else {
            // Partially consume this rest
            const remaining = rd - toAbsorb
            const newRests  = makeRests(remaining, `grow_${n.id}`)
            result.splice(i, 1, ...newRests)
            toAbsorb = 0
          }
        }
        return result

      } else {
        return result  // no change in duration
      }
    }, true)  // skipNormalize — we managed positions manually above

    set({ selectedDuration: newDuration, selectedDots: newDots || 0 })
  },

  // ── Standard note add (appends to end of real notes) ──────────────────────

  // ── Drop note at specific beat position (drag-and-drop from toolbar) ────────
  // beatPosition = fractional beat index within the measure (0 = start, 1 = after beat 1, etc.)
  // The note is inserted at the rest slot whose beat range contains beatPosition.
  dropNoteAtBeat: (partId, measureIndex, pitch, duration, dots, beatPosition) => {
    get()._snapshot()
        const part    = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure) return

    const maxBeats  = measure.timeSignature.beats
    const clampedBeat = Math.max(0, Math.min(beatPosition, maxBeats - 0.001))

    // Find which rest slot the drop position falls into
    // Walk through non-chord notes, tracking beat cursor, find the rest at clampedBeat
    const nonChord = measure.notes.filter(n => !n.chordWith)
    let cursor = 0
    let targetRest = null

    for (const n of nonChord) {
      const dur = noteDuration(n)
      if (n.isRest && clampedBeat >= cursor - 0.001 && clampedBeat < cursor + dur - 0.001) {
        targetRest = n
        break
      }
      cursor += dur
    }

    // If no rest found at that position (it's occupied by a note), find the next rest
    if (!targetRest) {
      targetRest = nonChord.find(n => n.isRest)
    }
    if (!targetRest) return  // measure is completely full of real notes

    const restBeats  = noteDuration(targetRest)
    const durKey     = duration + (dots ? 'd' : '')
    const newBeats   = DURATION_BEATS[durKey] || DURATION_BEATS[duration] || 1
    const actualBeats = Math.min(newBeats, restBeats)  // clamp to fit
    const fitDur     = actualBeats === newBeats
      ? { duration, dots: dots || 0 }
      : beatsToRest(restBeats)

    const newId   = crypto.randomUUID()
    const newNote = { id: newId, isRest: false, pitch, duration: fitDur.duration, dots: fitDur.dots }
    const leftover = restBeats - noteDuration(newNote)

    get()._applyToMeasure(partId, measureIndex, (notes) => {
      const idx      = notes.findIndex(n => n.id === targetRest.id)
      const before   = notes.slice(0, idx)
      const after    = notes.slice(idx + 1).filter(n => !n.isRest)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `drop_${newId}`) : []
      return [...before, newNote, ...leftovers, ...after]
    })

    set({
      selectedPartId:       partId,
      selectedMeasureIndex: measureIndex,
      selectedNoteId:       newId,
    })
  },


  // ── Add a note as a chord companion to an existing note ──────────────────
  // baseNoteId must be a real (non-rest) note. The new pitch is stacked on
  // the same beat with the same duration. Works regardless of chordMode.
  addChordNote: (partId, measureIndex, baseNoteId, pitch) => {
    get()._snapshot()
        const part    = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure || !pitch) return

    const base = measure.notes.find(n => n.id === baseNoteId && !n.isRest)
    if (!base) return

    // Don't add duplicate pitch
    const existingChords = measure.notes.filter(n => n.chordWith === baseNoteId)
    const allPitches = [base, ...existingChords]
    const alreadyExists = allPitches.some(n =>
      n.pitch?.step === pitch.step &&
      n.pitch?.octave === pitch.octave &&
      (n.pitch?.accidental ?? null) === (pitch.accidental ?? null)
    )
    if (alreadyExists) return

    const newId = crypto.randomUUID()
    set(s => ({
      selectedNoteId: baseNoteId,  // keep selection on the BASE note for continued chording
      score: {
        ...s.score,
        parts: s.score.parts.map(p => p.id !== partId ? p : {
          ...p,
          measures: p.measures.map((m, i) => i !== measureIndex ? m : {
            ...m,
            notes: [...m.notes, {
              id: newId,
              isRest: false,
              pitch,
              duration: base.duration,
              dots: base.dots,
              chordWith: baseNoteId,
            }],
          }),
        }),
      },
    }))
  },

  addNote: (partId, measureIndex, noteData) => {
    get()._snapshot()
        const state = get()
    const { chordMode, selectedNoteId } = state

    // Ensure column exists
    const totalCols = Math.max(...state.score.parts.map(p => p.measures.length))
    if (measureIndex >= totalCols) {
      set(s => ({ score: { ...s.score, parts: padPartsToCount(s.score.parts, measureIndex + 1) } }))
    }

    const part = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure) return

    // Chord mode: if chordMode is on AND a real note is selected in this measure,
    // stack the new note on top of the selected one (same beat, same duration)
    if (chordMode && selectedNoteId) {
      const base = measure.notes.find(n => n.id === selectedNoteId && !n.isRest)
      if (base) {
        get().addChordNote(partId, measureIndex, selectedNoteId, noteData.pitch)
        return
      }
    }

    // Check if the selected note is a rest — fill it instead
    const selNote = measure.notes.find(n => n.id === selectedNoteId)
    if (selNote?.isRest) {
      get().fillSelectedRest(noteData.pitch)
      return
    }

    // Find how many beats are already used by real (non-rest, non-chord) notes
    const realNotes = measure.notes.filter(n => !n.chordWith && !n.isRest)
    const usedBeats = realNotes.reduce((sum, n) => sum + noteDuration(n), 0)
    const available = measure.timeSignature.beats - usedBeats

    if (available < 0.001) {
      // Measure full — advance to next
      const nextIdx = measureIndex + 1
      const newTotal = Math.max(...get().score.parts.map(p => p.measures.length), nextIdx + 1)
      set(s => ({ score: { ...s.score, parts: padPartsToCount(s.score.parts, newTotal) } }))

      const newPart = get().score.parts.find(p => p.id === partId)
      const nextMeasure = newPart?.measures[nextIdx]
      if (!nextMeasure) return

      const newId = crypto.randomUUID()
      get()._applyToMeasure(partId, nextIdx, (notes) => {
        const rests = notes.filter(n => n.isRest)
        const firstRest = rests[0]
        if (!firstRest) return notes
        const restBeats = noteDuration(firstRest)
        const nb = noteDuration(noteData)
        const newNote = { id: newId, ...noteData, dots: nb <= restBeats ? (noteData.dots || 0) : 0 }
        const leftover = restBeats - noteDuration(newNote)
        const idx = notes.findIndex(n => n.id === firstRest.id)
        const leftovers = leftover > 0.001 ? makeRests(leftover, `adv_${newId}`) : []
        // Only remove the specific rest slot we replaced, keep everything else
        return [...notes.slice(0, idx), newNote, ...leftovers, ...notes.slice(idx + 1)]
      })
      set({ selectedMeasureIndex: nextIdx, selectedNoteId: newId })
      return
    }

    // Insert into current measure — replaces the first rest slot
    const newId = crypto.randomUUID()
    get()._applyToMeasure(partId, measureIndex, (notes) => {
      const firstRest = notes.find(n => n.isRest)
      if (!firstRest) return notes

      const restBeats = noteDuration(firstRest)
      const durKey = noteData.duration + (noteData.dots ? 'd' : '')
      let nb = DURATION_BEATS[durKey] || DURATION_BEATS[noteData.duration] || 1
      if (nb > restBeats + 0.001) nb = restBeats  // clamp

      const fit = nb === restBeats ? noteData : { ...noteData, ...beatsToRest(restBeats) }
      const newNote = { id: newId, ...fit, isRest: false, pitch: noteData.pitch }
      const leftover = restBeats - noteDuration(newNote)
      const idx = notes.findIndex(n => n.id === firstRest.id)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `fill2_${newId}`) : []
      // Only replace this specific rest slot; keep other notes/rests in place
      return [...notes.slice(0, idx), newNote, ...leftovers, ...notes.slice(idx + 1)]
    })
    set({ selectedNoteId: newId })
  },

  // ── Update note properties ─────────────────────────────────────────────────
  updateNote: (partId, measureIndex, noteId, changes) => {
    // If duration is changing, use changeSelectedDuration for safety
    if (changes.duration !== undefined || changes.dots !== undefined) {
      const note = get().score.parts.find(p => p.id === partId)?.measures[measureIndex]?.notes.find(n => n.id === noteId)
      if (note) {
        const newDur  = changes.duration !== undefined ? changes.duration : note.duration
        const newDots = changes.dots !== undefined ? changes.dots : (note.dots || 0)
        // Temporarily select this note, change duration, then restore selection
        const prev = { partId: get().selectedPartId, idx: get().selectedMeasureIndex, noteId: get().selectedNoteId }
        set({ selectedNoteId: noteId, selectedPartId: partId, selectedMeasureIndex: measureIndex })
        get().changeSelectedDuration(newDur, newDots)
        // Apply remaining non-duration changes
        const otherChanges = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'duration' && k !== 'dots'))
        if (Object.keys(otherChanges).length > 0) {
          get()._applyToMeasure(partId, measureIndex, (notes) =>
            notes.map(n => n.id === noteId ? { ...n, ...otherChanges } : n)
          )
        }
        return
      }
    }
    get()._applyToMeasure(partId, measureIndex, (notes) =>
      notes.map(n => n.id === noteId ? { ...n, ...changes } : n)
    )
  },

  // ── Delete note → becomes a rest ──────────────────────────────────────────
  deleteNote: (partId, measureIndex, noteId) => {
    get()._snapshot()
        get()._applyToMeasure(partId, measureIndex, (notes) => {
      const note = notes.find(n => n.id === noteId)
      if (!note || note.isRest) return notes
      // Replace with rest of same duration
      const rest = { ...beatsToRest(noteDuration(note)), id: noteId, isRest: true, pitch: null }
      return notes.map(n => n.id === noteId ? rest : n).filter(n => n.chordWith !== noteId)
    })
    set({ selectedNoteId: null })
  },

  // ── Delete last real note in measure ──────────────────────────────────────
  deleteLastNote: (partId, measureIndex) => {
    get()._applyToMeasure(partId, measureIndex, (notes) => {
      const realNotes = notes.filter(n => !n.isRest && !n.chordWith)
      if (realNotes.length === 0) return notes
      const last = realNotes[realNotes.length - 1]
      const rest = { ...beatsToRest(noteDuration(last)), id: last.id, isRest: true, pitch: null }
      return notes.map(n => n.id === last.id ? rest : n).filter(n => n.chordWith !== last.id)
    })
    set({ selectedNoteId: null })
  },

  // ── Measure operations ─────────────────────────────────────────────────────

  clearMeasureColumn: (colIndex) => set(s => ({
    selectedNoteId: null,
    score: {
      ...s.score,
      parts: s.score.parts.map(p => ({
        ...p,
        measures: p.measures.map((m, i) => i !== colIndex ? m : {
          ...m,
          notes: normalizeMeasure([], m.timeSignature.beats),
        }),
      })),
    },
  })),

  deleteMeasureColumn: (colIndex) => {
    if (get().score.parts[0]?.measures.length <= 1) return
    set(s => ({
      selectedNoteId: null,
      selectedMeasureIndex: Math.max(0, colIndex - 1),
      score: {
        ...s.score,
        parts: s.score.parts.map(p => ({
          ...p,
          measures: p.measures.filter((_, i) => i !== colIndex),
        })),
      },
    }))
  },

  addMeasure: () => {
    const state = get()
    const count = Math.max(...state.score.parts.map(p => p.measures.length))
    set(s => ({
      selectedMeasureIndex: count,
      selectedNoteId: null,
      score: { ...s.score, parts: padPartsToCount(s.score.parts, count + 1) },
    }))
  },

  addPart: (clef = 'treble', name) => {
    const state = get()
    const count = Math.max(...state.score.parts.map(p => p.measures.length), 1)
    const lastM = state.score.parts[0]?.measures[count - 1]
    const measures = Array.from({ length: count }, () =>
      makeEmptyMeasure(lastM?.timeSignature, lastM?.keySignature)
    )
    set(s => ({
      score: {
        ...s.score,
        parts: [...s.score.parts, {
          id: crypto.randomUUID(),
          name: name || (clef === 'bass' ? 'Bass' : 'Treble'),
          instrument: 'piano', clef, measures,
        }],
      },
    }))
  },

  removePart: (partId) => set(s => ({
    selectedPartId: s.selectedPartId === partId
      ? s.score.parts.find(p => p.id !== partId)?.id : s.selectedPartId,
    score: { ...s.score, parts: s.score.parts.filter(p => p.id !== partId) },
  })),

  // ── Navigation ─────────────────────────────────────────────────────────────
  navigateNote: (dir) => {
    const { score, selectedNoteId, selectedPartId, selectedMeasureIndex } = get()
    const part     = score.parts.find(p => p.id === selectedPartId)
    const measures = part?.measures
    if (!measures || selectedMeasureIndex === null) return

    const curNotes = measures[selectedMeasureIndex]?.notes.filter(n => !n.chordWith) || []
    const idx      = curNotes.findIndex(n => n.id === selectedNoteId)
    if (idx === -1) return

    const nextInBar = curNotes[idx + dir]
    if (nextInBar) {
      // Normal case: move within this bar
      set({
        selectedNoteId:       nextInBar.id,
        selectedMeasureIndex,
        selectedDuration:     nextInBar.duration,
        selectedDots:         nextInBar.dots || 0,
      })
      return
    }

    // Reached end/start of bar — cross into adjacent bar
    if (dir > 0 && selectedMeasureIndex < measures.length - 1) {
      const nextM     = measures[selectedMeasureIndex + 1]
      const nextNotes = nextM?.notes.filter(n => !n.chordWith) || []
      const first     = nextNotes[0]
      if (first) {
        set({
          selectedNoteId:       first.id,
          selectedMeasureIndex: selectedMeasureIndex + 1,
          selectedDuration:     first.duration,
          selectedDots:         first.dots || 0,
        })
      }
    } else if (dir < 0 && selectedMeasureIndex > 0) {
      const prevM     = measures[selectedMeasureIndex - 1]
      const prevNotes = prevM?.notes.filter(n => !n.chordWith) || []
      const last      = prevNotes[prevNotes.length - 1]
      if (last) {
        set({
          selectedNoteId:       last.id,
          selectedMeasureIndex: selectedMeasureIndex - 1,
          selectedDuration:     last.duration,
          selectedDots:         last.dots || 0,
        })
      }
    }
  },

  // ── Pitch operations ───────────────────────────────────────────────────────
  shiftPitchHalfStep: (dir) => {
    const CHROMATIC = [
      {s:'C',a:null},{s:'C',a:'#'},{s:'D',a:null},{s:'D',a:'#'},{s:'E',a:null},
      {s:'F',a:null},{s:'F',a:'#'},{s:'G',a:null},{s:'G',a:'#'},{s:'A',a:null},
      {s:'B',a:'b'},{s:'B',a:null},
    ]
    const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}
    const { score, selectedNoteId, selectedPartId, selectedMeasureIndex } = get()
    const note = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note?.pitch) return
    const { step, accidental, octave } = note.pitch
    let semi = base[step] + octave * 12
    if (accidental === '#') semi++
    if (accidental === 'b') semi--
    semi += dir
    const oct2 = Math.floor(semi / 12)
    const idx = ((semi % 12) + 12) % 12
    const np = { step: CHROMATIC[idx].s, accidental: CHROMATIC[idx].a, octave: oct2 }
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
      notes.map(n => n.id === selectedNoteId ? { ...n, pitch: np } : n)
    )
  },

  // Plain ↑↓ = chromatic half-step (same logic as shiftPitchHalfStep)
  shiftPitchStep: (dir) => {
    get().shiftPitchHalfStep(dir)
  },

  // Shift+↑↓ = octave jump
  shiftPitchOctave: (dir) => {
    const { score, selectedNoteId, selectedPartId, selectedMeasureIndex } = get()
    const note = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note?.pitch) return
    const np = { ...note.pitch, octave: note.pitch.octave + dir }
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
      notes.map(n => n.id === selectedNoteId ? { ...n, pitch: np } : n)
    )
  },

  loadScore: (score) => set({ score }),

  // ── Move a part up or down in the list ──────────────────────────────────
  movePartUp: (partId) => {
    set(s => {
      const parts = [...s.score.parts]
      const idx   = parts.findIndex(p => p.id === partId)
      if (idx <= 0) return s
      ;[parts[idx-1], parts[idx]] = [parts[idx], parts[idx-1]]
      return { score: { ...s.score, parts } }
    })
  },

  movePartDown: (partId) => {
    set(s => {
      const parts = [...s.score.parts]
      const idx   = parts.findIndex(p => p.id === partId)
      if (idx < 0 || idx >= parts.length - 1) return s
      ;[parts[idx], parts[idx+1]] = [parts[idx+1], parts[idx]]
      return { score: { ...s.score, parts } }
    })
  },

  // ── Insert a triplet group ────────────────────────────────────────────────
  // Inserts 3 notes of duration `baseDuration` as a triplet (each = 2/3 of base)
  // into the selected measure at the current cursor position.
  // e.g. baseDuration='q' → 3 quarter-note triplets filling 2 beats
  insertTriplet: (baseDuration) => {
    const { selectedPartId, selectedMeasureIndex } = get()
    if (selectedMeasureIndex === null) return
    get()._snapshot()

    const part    = get().score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    if (!measure) return

    // Each triplet note = 2/3 of the base duration
    const key = baseDuration + 't'
    const tripletBeats = DURATION_BEATS[key] || (DURATION_BEATS[baseDuration] * 2/3)
    const totalBeats   = tripletBeats * 3  // = 2 × base

    // Find a rest slot big enough to fit the triplet group
    const nonChord = measure.notes.filter(n => !n.chordWith)
    let targetRest = null
    for (const n of nonChord) {
      if (n.isRest && noteDuration(n) >= totalBeats - 0.001) {
        targetRest = n; break
      }
    }
    if (!targetRest) return  // no space

    const restBeats  = noteDuration(targetRest)
    const leftover   = restBeats - totalBeats
    const groupId    = crypto.randomUUID()  // shared ID links the 3 notes as a triplet

    const tripletNotes = [0,1,2].map(i => ({
      id: crypto.randomUUID(),
      isRest: true,
      pitch: null,
      duration: baseDuration,
      dots: 0,
      // Both legacy flag and new structured tuplet data
      triplet: true,
      tuplet: { num: 3, den: 2, groupId },   // 3 notes in space of 2
      tripletGroupId: groupId,
      tripletIndex: i,
      tripletOf: 3,
    }))

    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx      = notes.findIndex(n => n.id === targetRest.id)
      const before   = notes.slice(0, idx)
      const after    = notes.slice(idx + 1).filter(n => !n.isRest)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `trip_after`) : []
      return [...before, ...tripletNotes, ...leftovers, ...after]
    })

    // Select the first triplet note
    set({ selectedNoteId: tripletNotes[0].id })
    saveToStorage(get().score)
  },

  // ── General tuplet insertion ──────────────────────────────────────────────
  // insertTuplet(baseDuration, num, den)
  // Example: insertTuplet('q', 3, 2) = triplet
  //          insertTuplet('8', 5, 4) = quintuplet of 8th notes
  //          insertTuplet('q', 7, 4) = septuplet
  insertTuplet: (baseDuration, num, den) => {
    const { selectedPartId, selectedMeasureIndex } = get()
    if (selectedMeasureIndex === null) return
    get()._snapshot()
    const part    = get().score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    if (!measure) return

    // Each tuplet note fills: base_duration × (den/num) beats
    const baseDurBeats  = DURATION_BEATS[baseDuration] || 1
    const noteBeats     = baseDurBeats * (den / num)
    const totalBeats    = noteBeats * num   // = baseDurBeats × den

    const nonChord = measure.notes.filter(n => !n.chordWith)
    let targetRest = null
    for (const n of nonChord) {
      if (n.isRest && noteDuration(n) >= totalBeats - 0.001) { targetRest = n; break }
    }
    if (!targetRest) return

    const restBeats = noteDuration(targetRest)
    const leftover  = restBeats - totalBeats
    const groupId   = crypto.randomUUID()

    const tupletNotes = Array.from({ length: num }, (_, i) => ({
      id: crypto.randomUUID(),
      isRest: true, pitch: null,
      duration: baseDuration, dots: 0,
      triplet: num === 3 && den === 2,  // legacy compat
      tuplet: { num, den, groupId },
      tripletGroupId: groupId,
      tripletIndex: i,
      tripletOf: num,
    }))

    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx      = notes.findIndex(n => n.id === targetRest.id)
      const before   = notes.slice(0, idx)
      const after    = notes.slice(idx + 1).filter(n => !n.isRest)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `tuplet_after`) : []
      return [...before, ...tupletNotes, ...leftovers, ...after]
    })

    set({ selectedNoteId: tupletNotes[0].id })
    saveToStorage(get().score)
  },

  // ── Dynamics ────────────────────────────────────────────────────────────
  addDynamic: (partId, measureIndex, beat, value) => {
    get()._snapshot()
    const id = crypto.randomUUID()
    set(s => ({ score: { ...s.score,
      dynamics: [...(s.score.dynamics||[]).filter(
        d => !(d.partId===partId && d.measureIndex===measureIndex && Math.abs(d.beat-beat)<0.1)
      ), { id, partId, measureIndex, beat, value }]
    }}))
    saveToStorage(get().score)
  },
  removeDynamic: (id) => {
    set(s => ({ score: { ...s.score, dynamics: (s.score.dynamics||[]).filter(d => d.id !== id) }}))
    saveToStorage(get().score)
  },

  // ── Hairpins ────────────────────────────────────────────────────────────
  addHairpin: (partId, startMeasure, startBeat, endMeasure, endBeat, type) => {
    get()._snapshot()
    const id = crypto.randomUUID()
    set(s => ({ score: { ...s.score,
      hairpins: [...(s.score.hairpins||[]), { id, partId, startMeasure, startBeat, endMeasure, endBeat, type }]
    }}))
    saveToStorage(get().score)
  },
  removeHairpin: (id) => {
    set(s => ({ score: { ...s.score, hairpins: (s.score.hairpins||[]).filter(h => h.id !== id) }}))
    saveToStorage(get().score)
  },

  // ── Rehearsal marks ──────────────────────────────────────────────────────
  addRehearsalMark: (measureIndex, text) => {
    get()._snapshot()
    const id = crypto.randomUUID()
    set(s => ({ score: { ...s.score,
      rehearsalMarks: [...(s.score.rehearsalMarks||[]).filter(r => r.measureIndex !== measureIndex),
        { id, measureIndex, text }]
    }}))
    saveToStorage(get().score)
  },
  removeRehearsalMark: (id) => {
    set(s => ({ score: { ...s.score, rehearsalMarks: (s.score.rehearsalMarks||[]).filter(r => r.id !== id) }}))
    saveToStorage(get().score)
  },

  // ── Staff text ────────────────────────────────────────────────────────────
  addStaffText: (partId, measureIndex, beat, text) => {
    get()._snapshot()
    const id = crypto.randomUUID()
    set(s => ({ score: { ...s.score,
      staffTexts: [...(s.score.staffTexts||[]), { id, partId, measureIndex, beat, text }]
    }}))
    saveToStorage(get().score)
  },
}))