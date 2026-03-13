// src/store/scoreStore.js
import { create } from 'zustand'

export const DURATION_BEATS = {
  'w': 4, 'h': 2, 'q': 1, '8': 0.5, '16': 0.25, '32': 0.125,
  'wd': 6, 'hd': 3, 'qd': 1.5, '8d': 0.75, '16d': 0.375,
}

export function noteDuration(note) {
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
  return { duration: '32', dots: 0 }
}

// Build a minimal chain of rest notes to fill `beats`
function makeRests(beats, idPrefix) {
  const rests = []
  let rem = beats, i = 0
  while (rem > 0.001) {
    const { duration, dots } = beatsToRest(rem)
    const key = duration + (dots ? 'd' : '')
    const used = DURATION_BEATS[key] || DURATION_BEATS[duration] || 1
    rests.push({ id: `${idPrefix}_r${i++}`, isRest: true, pitch: null, duration, dots })
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
    if (cursor >= maxBeats - 0.001) break  // measure full

    const dur = noteDuration(n)
    const allowed = maxBeats - cursor

    if (dur > allowed + 0.001) {
      // Note too long — split into the max that fits + rest
      // Find the best fitting duration
      const fit = beatsToRest(allowed)  // reuse logic
      const fitDur = DURATION_BEATS[fit.duration + (fit.dots ? 'd' : '')] || DURATION_BEATS[fit.duration] || 1
      if (fitDur > 0.001) {
        result.push({ ...n, duration: fit.duration, dots: fit.dots })
        cursor += fitDur
      }
      break
    }

    result.push(n)
    cursor += dur
  }

  // Fill remaining with rests
  const remaining = maxBeats - cursor
  if (remaining > 0.001) {
    result.push(...makeRests(remaining, `fill_${cursor}`))
  }

  // Re-attach chord notes
  const finalIds = new Set(result.map(n => n.id))
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
    { id: 'part-treble', name: 'Treble', instrument: 'piano', clef: 'treble', measures: [makeEmptyMeasure({ beats: 4, beatType: 4 }, 0)] },
    { id: 'part-bass',   name: 'Bass',   instrument: 'piano', clef: 'bass',   measures: [makeEmptyMeasure({ beats: 4, beatType: 4 }, 0)] },
  ],
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useScoreStore = create((set, get) => ({
  score: EMPTY_SCORE,

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
  setComposer: (c) => set(s => ({ score: { ...s.score, composer: c } })),
  setTempo: (t) => set(s => ({ score: { ...s.score, tempo: t } })),
  setInputMode: (m) => set({ inputMode: m }),
  setDuration: (d) => set({ selectedDuration: d }),
  setSelectedDots: (d) => set({ selectedDots: d }),
  setSelectedOctave: (o) => set({ selectedOctave: o }),
  setSelectedNote: (n) => set({ selectedNote: n }),
  setChordMode: (v) => set({ chordMode: v }),

  setIsPlaying:    (v)    => set({ isPlaying: v }),
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

  setGlobalTimeSignature: (timeSignature) => set(s => ({
    score: {
      ...s.score,
      parts: s.score.parts.map(p => ({
        ...p,
        measures: p.measures.map(m => ({
          ...m,
          timeSignature,
          notes: normalizeMeasure(m.notes, timeSignature.beats),
        })),
      })),
    },
  })),

  // ── Core note mutation: always normalizes after every change ───────────────

  _applyToMeasure: (partId, measureIndex, fn) => {
    set(s => {
      const part = s.score.parts.find(p => p.id === partId)
      const measure = part?.measures[measureIndex]
      if (!measure) return s
      const newNotes = fn(measure.notes, measure.timeSignature.beats)
      const normalized = normalizeMeasure(newNotes, measure.timeSignature.beats)
      return {
        score: {
          ...s.score,
          parts: s.score.parts.map(p => p.id !== partId ? p : {
            ...p,
            measures: p.measures.map((m, i) => i !== measureIndex ? m : { ...m, notes: normalized }),
          }),
        },
      }
    })
  },

  // ── Place a note at a selected rest position ───────────────────────────────
  // When user selects a rest then presses a note key or clicks chromatic
  fillSelectedRest: (pitch) => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, selectedDuration, selectedDots } = get()
    if (!selectedNoteId || selectedMeasureIndex === null) return

    const part = get().score.parts.find(p => p.id === selectedPartId)
    const note = part?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note?.isRest) return

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
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx = notes.findIndex(n => n.id === selectedNoteId)
      if (idx === -1) return notes
      const before = notes.slice(0, idx)
      const after  = notes.slice(idx + 1)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `after_${note.id}`) : []
      return [...before, newNoteObj, ...leftovers, ...after.filter(n => !n.isRest)]
    })

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
      // Still too long even after consuming all surrounding rests — clamp
      const fit = beatsToRest(available)
      const fitKey = fit.duration + (fit.dots ? 'd' : '')
      const fitBeats = DURATION_BEATS[fitKey] || DURATION_BEATS[fit.duration] || 1
      if (fitBeats < 0.001) return
      get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
        notes.map(n => n.id === selectedNoteId ? { ...n, duration: fit.duration, dots: fit.dots } : n)
      )
      set({ selectedDuration: fit.duration, selectedDots: fit.dots })
      return
    }

    // Apply new duration — normalizeMeasure will consume adjacent rests if
    // growing, or create new rests if shrinking. Either way the bar stays full.
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
      notes.map(n => n.id === selectedNoteId ? { ...n, duration: newDuration, dots: newDots || 0 } : n)
    )
    set({ selectedDuration: newDuration, selectedDots: newDots || 0 })
  },

  // ── Standard note add (appends to end of real notes) ──────────────────────

  // ── Drop note at specific beat position (drag-and-drop from toolbar) ────────
  // beatPosition = fractional beat index within the measure (0 = start, 1 = after beat 1, etc.)
  // The note is inserted at the rest slot whose beat range contains beatPosition.
  dropNoteAtBeat: (partId, measureIndex, pitch, duration, dots, beatPosition) => {
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

  addNote: (partId, measureIndex, noteData) => {
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

    // Chord mode
    if (chordMode && selectedNoteId) {
      const base = measure.notes.find(n => n.id === selectedNoteId)
      if (base && !base.isRest) {
        const newId = crypto.randomUUID()
        set(s => ({
          selectedNoteId: newId,
          score: {
            ...s.score,
            parts: s.score.parts.map(p => p.id !== partId ? p : {
              ...p,
              measures: p.measures.map((m, i) => i !== measureIndex ? m : {
                ...m,
                notes: [...m.notes, { id: newId, ...noteData, chordWith: selectedNoteId }],
              }),
            }),
          },
        }))
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
        return [...notes.slice(0, idx), newNote, ...leftovers, ...notes.slice(idx + 1).filter(n => !n.isRest)]
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
      return [...notes.slice(0, idx), newNote, ...leftovers, ...notes.slice(idx + 1).filter(n => !n.isRest)]
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
    const notes = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.filter(n => !n.chordWith) || []
    const idx = notes.findIndex(n => n.id === selectedNoteId)
    if (idx === -1) return
    const next = notes[idx + dir]
    if (next) set({ selectedNoteId: next.id, selectedDuration: next.duration, selectedDots: next.dots || 0 })
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

  shiftPitchStep: (dir) => {
    const STEPS = ['C','D','E','F','G','A','B']
    const { score, selectedNoteId, selectedPartId, selectedMeasureIndex } = get()
    const note = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note?.pitch) return
    let idx = STEPS.indexOf(note.pitch.step), oct = note.pitch.octave
    idx += dir
    if (idx >= STEPS.length) { idx -= STEPS.length; oct++ }
    if (idx < 0)              { idx += STEPS.length; oct-- }
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
      notes.map(n => n.id === selectedNoteId ? { ...n, pitch: { step: STEPS[idx], octave: oct, accidental: null } } : n)
    )
  },

  loadScore: (score) => set({ score }),
}))