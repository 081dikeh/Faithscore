// src/store/scoreStore.js
// FaithScore — Zustand state store

import { create } from 'zustand'

// ── Auto-save helpers ─────────────────────────────────────────────────────────
const AUTOSAVE_KEY = 'faithscore_autosave'
function saveToStorage(score) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(score)) } catch(e) {}
}
function loadFromStorage() {
  try {
    // Support migrating old 'scoreai_autosave' key
    const raw = localStorage.getItem(AUTOSAVE_KEY)
      || localStorage.getItem('scoreai_autosave')
    return raw ? JSON.parse(raw) : null
  } catch(e) { return null }
}
export function hasSavedScore() {
  return !!(localStorage.getItem(AUTOSAVE_KEY) || localStorage.getItem('scoreai_autosave'))
}
export function clearSavedScore() {
  localStorage.removeItem(AUTOSAVE_KEY)
  localStorage.removeItem('scoreai_autosave')
}

export const DURATION_BEATS = {
  'w': 4, 'h': 2, 'q': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625,
  'wd': 6, 'hd': 3, 'qd': 1.5, '8d': 0.75, '16d': 0.375, '32d': 0.1875,
  'qt': 2/3, '8t': 1/3, '16t': 1/6, 'ht': 4/3,
}

export function noteDuration(note) {
  if (note.triplet) {
    return (DURATION_BEATS[note.duration] || 1) * 2 / 3
  }
  const key = note.duration + (note.dots ? 'd' : '')
  return DURATION_BEATS[key] || DURATION_BEATS[note.duration] || 1
}

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

function makeRests(beats, idPrefix) {
  const rests = []
  let rem = beats, i = 0
  while (rem > 0.001) {
    const { duration, dots } = beatsToRest(rem)
    const key = duration + (dots ? 'd' : '')
    const used = DURATION_BEATS[key] || DURATION_BEATS[duration] || 1
    const uid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`
    rests.push({ id: `${idPrefix}_r${i++}_${uid}`, isRest: true, pitch: null, duration, dots })
    rem -= used
  }
  return rests
}

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
      const fit    = beatsToRest(allowed)
      const fitDur = DURATION_BEATS[fit.duration + (fit.dots?'d':'')] || DURATION_BEATS[fit.duration] || 1
      if (fitDur > 0.001) {
        result.push({ ...n, duration: fit.duration, dots: fit.dots, tieStart: true })
        cursor += fitDur
      }
      break
    }
    result.push(n)
    cursor += dur
  }
  const remaining = maxBeats - cursor
  if (remaining > 0.001) {
    result.push(...makeRests(remaining, `fill_${cursor}`))
  }
  const finalIds    = new Set(result.map(n => n.id))
  const validChords = chords.filter(c => finalIds.has(c.chordWith))
  return [...result, ...validChords]
}

export function annotateBeats(notes) {
  let cursor = 0
  return notes.filter(n => !n.chordWith).map(n => {
    const annotated = { ...n, _beatStart: cursor }
    cursor += noteDuration(n)
    return annotated
  })
}

function makeEmptyMeasure(timeSig, keySig) {
  const ts = timeSig || { beats: 4, beatType: 4 }
  const ks = keySig ?? 0
  const rests = makeRests(ts.beats, 'init')
  return {
    id: crypto.randomUUID(),
    timeSignature: ts,
    keySignature: ks,
    notes: rests,
    barline: 'single',   // NEW: barline type for the right barline of this measure
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

// ── Available instruments ─────────────────────────────────────────────────────
export const INSTRUMENTS = [
  { id: 'piano',       label: 'Piano',        defaultClef: 'treble' },
  { id: 'piano-bass',  label: 'Piano (Bass)',  defaultClef: 'bass'   },
  { id: 'violin',      label: 'Violin',        defaultClef: 'treble' },
  { id: 'viola',       label: 'Viola',         defaultClef: 'alto'   },
  { id: 'cello',       label: 'Cello',         defaultClef: 'bass'   },
  { id: 'contrabass',  label: 'Contrabass',    defaultClef: 'bass'   },
  { id: 'flute',       label: 'Flute',         defaultClef: 'treble' },
  { id: 'oboe',        label: 'Oboe',          defaultClef: 'treble' },
  { id: 'clarinet',    label: 'Clarinet',      defaultClef: 'treble' },
  { id: 'bassoon',     label: 'Bassoon',       defaultClef: 'bass'   },
  { id: 'horn',        label: 'French Horn',   defaultClef: 'treble' },
  { id: 'trumpet',     label: 'Trumpet',       defaultClef: 'treble' },
  { id: 'trombone',    label: 'Trombone',      defaultClef: 'bass'   },
  { id: 'tuba',        label: 'Tuba',          defaultClef: 'bass'   },
  { id: 'guitar',      label: 'Guitar',        defaultClef: 'treble' },
  { id: 'bass-guitar', label: 'Bass Guitar',   defaultClef: 'bass'   },
  { id: 'soprano',     label: 'Soprano Voice', defaultClef: 'treble' },
  { id: 'alto',        label: 'Alto Voice',    defaultClef: 'treble' },
  { id: 'tenor',       label: 'Tenor Voice',   defaultClef: 'treble' },
  { id: 'bass-voice',  label: 'Bass Voice',    defaultClef: 'bass'   },
  { id: 'organ',       label: 'Organ',         defaultClef: 'treble' },
  { id: 'harp',        label: 'Harp',          defaultClef: 'treble' },
]

export const EMPTY_SCORE = {
  id: crypto.randomUUID(),
  title: 'Untitled Score',
  composer: '',
  tempo: 120,
  parts: [
    { id: 'part-treble', name: 'Treble', instrument: 'piano',      clef: 'treble', measures: [makeEmptyMeasure({ beats: 4, beatType: 4 }, 0)] },
    { id: 'part-bass',   name: 'Bass',   instrument: 'piano-bass', clef: 'bass',   measures: [makeEmptyMeasure({ beats: 4, beatType: 4 }, 0)] },
  ],
  dynamics:       [],
  hairpins:       [],
  rehearsalMarks: [],
  staffTexts:     [],
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useScoreStore = create((set, get) => ({
  score: (() => {
    const saved = loadFromStorage()
    if (!saved) return EMPTY_SCORE
    return {
      dynamics: [], hairpins: [], rehearsalMarks: [], staffTexts: [],
      ...saved,
    }
  })(),

  _undoStack: [],
  _redoStack: [],
  clipboard: null,
  selectedMeasureRange: null,
  zoom: 1.0,

  selectedPartId: 'part-treble',
  selectedMeasureIndex: null,
  selectedNoteId: null,

  inputMode: 'select',
  selectedDuration: 'q',
  selectedDots: 0,
  selectedOctave: 4,
  selectedNote: { step: 'C', accidental: null, label: 'C' },
  chordMode: false,

  isPlaying:    false,
  playbackBeat: null,

  setTitle:    (t) => set(s => ({ score: { ...s.score, title: t } })),
  setComposer: (c) => set(s => ({ score: { ...s.score, composer: c } })),
  setTempo:    (t) => set(s => ({ score: { ...s.score, tempo: t } })),
  setInputMode:      (m) => set({ inputMode: m }),
  setDuration:       (d) => set({ selectedDuration: d }),
  setSelectedDots:   (d) => set({ selectedDots: d }),
  setSelectedOctave: (o) => set({ selectedOctave: o }),
  setSelectedNote:   (n) => set({ selectedNote: n }),
  setChordMode:      (v) => set({ chordMode: v }),
  setIsPlaying:      (v) => set({ isPlaying: v }),
  setZoom: (z) => set({ zoom: Math.max(0.5, Math.min(2.0, z)) }),

  // ── Snapshot ───────────────────────────────────────────────────────────────
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

  // ── Copy / Paste ───────────────────────────────────────────────────────────
  copyMeasure: (partId, measureIndex) => {
    const part    = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure) return
    set({ clipboard: JSON.parse(JSON.stringify(measure)) })
  },

  copyMeasureRange: (startCol, endCol) => {
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
      const newNotes = clipboard.notes.map(n => ({ ...n, id: crypto.randomUUID() }))
      get()._applyToMeasure(partId, measureIndex, () => newNotes)
    }
    saveToStorage(get().score)
  },

  setMeasureRange: (start, end) => set({
    selectedMeasureRange: start === null ? null : { start, end: end ?? start }
  }),

  extendMeasureRange: (colIndex) => {
    const { selectedMeasureRange, selectedMeasureIndex } = get()
    const base  = selectedMeasureRange?.start ?? selectedMeasureIndex ?? colIndex
    const start = Math.min(base, colIndex)
    const end   = Math.max(base, colIndex)
    set({ selectedMeasureRange: { start, end } })
  },

  // ── Transpose ──────────────────────────────────────────────────────────────
  transposeSelection: (semitones) => {
    const CHROMATIC = [
      {s:'C',a:null},{s:'C',a:'#'},{s:'D',a:null},{s:'D',a:'#'},{s:'E',a:null},
      {s:'F',a:null},{s:'F',a:'#'},{s:'G',a:null},{s:'G',a:'#'},{s:'A',a:null},
      {s:'B',a:'b'},{s:'B',a:null},
    ]
    const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}
    function transposeNote(note) {
      if (note.isRest || !note.pitch) return note
      const { step, accidental, octave } = note.pitch
      let semi = base[step] + octave * 12
      if (accidental === '#') semi++
      if (accidental === '##') semi+=2
      if (accidental === 'b') semi--
      if (accidental === 'bb') semi-=2
      semi += semitones
      const oct2 = Math.floor(semi / 12)
      const idx  = ((semi % 12) + 12) % 12
      return { ...note, pitch: { step: CHROMATIC[idx].s, accidental: CHROMATIC[idx].a, octave: oct2 } }
    }
    get()._snapshot()
    const { score, selectedMeasureRange, selectedMeasureIndex } = get()
    const start = selectedMeasureRange?.start ?? selectedMeasureIndex ?? 0
    const end   = selectedMeasureRange?.end   ?? selectedMeasureIndex ?? (score.parts[0]?.measures.length - 1)
    set(s => ({
      score: {
        ...s.score,
        parts: s.score.parts.map(p => ({
          ...p,
          measures: p.measures.map((m, i) =>
            i >= start && i <= end
              ? { ...m, notes: m.notes.map(transposeNote) }
              : m
          ),
        })),
      },
    }))
    saveToStorage(get().score)
  },

  // ── Ties ──────────────────────────────────────────────────────────────────
  toggleTie: () => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, score } = get()
    if (!selectedNoteId) return
    const note = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note || note.isRest) return
    get()._snapshot()
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
      notes.map(n => n.id === selectedNoteId ? { ...n, tieStart: !n.tieStart } : n)
    )
    saveToStorage(get().score)
  },

  // ── Slurs ─────────────────────────────────────────────────────────────────
  toggleSlurStart: () => {
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, score } = get()
    if (!selectedNoteId) return
    const note = score.parts.find(p => p.id === selectedPartId)
      ?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note || note.isRest) return
    get()._snapshot()
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
      notes.map(n => n.id === selectedNoteId ? { ...n, slurStart: !n.slurStart } : n)
    )
    saveToStorage(get().score)
  },

  setPlaybackBeat: (beat) => set({ playbackBeat: beat }),

  getDefaultOctaveForPart: (partId) => {
    const part = get().score.parts.find(p => p.id === partId)
    return part?.clef === 'bass' ? 3 : 4
  },

  // ── Selection ─────────────────────────────────────────────────────────────
  selectMeasure: (partId, measureIndex) => {
    const part = get().score.parts.find(p => p.id === partId)
    set({
      selectedPartId: partId,
      selectedMeasureIndex: measureIndex,
      selectedNoteId: null,
      selectedOctave: part?.clef === 'bass' ? 3 : 4,
    })
  },

  selectNote: (noteId, partId, measureIndex) => {
    const part = get().score.parts.find(p => p.id === partId)
    const note = part?.measures[measureIndex]?.notes.find(n => n.id === noteId)
    if (!note) return
    set({
      selectedNoteId: noteId,
      selectedPartId: partId,
      selectedMeasureIndex: measureIndex,
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

  // ── NEW: Change clef for a specific part ──────────────────────────────────
  setPartClef: (partId, clef) => {
    get()._snapshot()
    set(s => ({
      score: {
        ...s.score,
        parts: s.score.parts.map(p =>
          p.id !== partId ? p : { ...p, clef }
        ),
      },
    }))
    saveToStorage(get().score)
  },

  // ── NEW: Change instrument for a specific part ────────────────────────────
  setPartInstrument: (partId, instrumentId) => {
    get()._snapshot()
    const instr = INSTRUMENTS.find(i => i.id === instrumentId)
    set(s => ({
      score: {
        ...s.score,
        parts: s.score.parts.map(p =>
          p.id !== partId ? p : {
            ...p,
            instrument: instrumentId,
            name: instr?.label || p.name,
            clef: instr?.defaultClef || p.clef,
          }
        ),
      },
    }))
    saveToStorage(get().score)
  },

  // ── NEW: Apply a barline type to a measure ────────────────────────────────
  _applyBarline: (measureIndex, barlineType) => {
    if (measureIndex === null) return
    get()._snapshot()
    set(s => ({
      score: {
        ...s.score,
        parts: s.score.parts.map(p => ({
          ...p,
          measures: p.measures.map((m, i) =>
            i === measureIndex ? { ...m, barline: barlineType } : m
          ),
        })),
      },
    }))
    saveToStorage(get().score)
  },

  // ── Core note mutation ─────────────────────────────────────────────────────
  _applyToMeasure: (partId, measureIndex, fn) => {
    set(s => {
      const part = s.score.parts.find(p => p.id === partId)
      const measure = part?.measures[measureIndex]
      if (!measure) return s
      const newNotes = fn(measure.notes, measure.timeSignature.beats)
      const normalized = normalizeMeasure(newNotes, measure.timeSignature.beats)
      const newScore = {
        ...s.score,
        parts: s.score.parts.map(p => p.id !== partId ? p : {
          ...p,
          measures: p.measures.map((m, i) => i !== measureIndex ? m : { ...m, notes: normalized }),
        }),
      }
      saveToStorage(newScore)
      return { score: newScore }
    })
  },

  fillSelectedRest: (pitch) => {
    get()._snapshot()
    const { selectedNoteId, selectedPartId, selectedMeasureIndex, selectedDuration, selectedDots } = get()
    if (!selectedNoteId || selectedMeasureIndex === null) return
    const part = get().score.parts.find(p => p.id === selectedPartId)
    const note = part?.measures[selectedMeasureIndex]?.notes.find(n => n.id === selectedNoteId)
    if (!note?.isRest) return
    const restBeats = noteDuration(note)
    const newDurKey = selectedDuration + (selectedDots ? 'd' : '')
    const newBeats  = DURATION_BEATS[newDurKey] || DURATION_BEATS[selectedDuration] || 1
    if (newBeats > restBeats + 0.001) {
      const fit = beatsToRest(restBeats)
      const newNote = { ...note, isRest: false, pitch, duration: fit.duration, dots: fit.dots }
      get()._replaceNote(selectedNoteId, selectedPartId, selectedMeasureIndex, newNote)
      return
    }
    const newNoteObj = { id: note.id, isRest: false, pitch, duration: selectedDuration, dots: selectedDots || 0 }
    const leftover = restBeats - newBeats
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx = notes.findIndex(n => n.id === selectedNoteId)
      if (idx === -1) return notes
      const before = notes.slice(0, idx)
      const after  = notes.slice(idx + 1)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `after_${note.id}`) : []
      return [...before, newNoteObj, ...leftovers, ...after]
    })
    set({ selectedNoteId: newNoteObj.id })
  },

  _replaceNote: (noteId, partId, measureIndex, newNote) => {
    get()._applyToMeasure(partId, measureIndex, (notes) =>
      notes.map(n => n.id === noteId ? newNote : n)
    )
    set({ selectedNoteId: newNote.id })
  },

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
    const otherRealNotes = measure.notes.filter(n => !n.chordWith && !n.isRest && n.id !== selectedNoteId)
    const othersBeats = otherRealNotes.reduce((sum, n) => sum + noteDuration(n), 0)
    const available = measure.timeSignature.beats - othersBeats
    if (newBeats > available + 0.001) {
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
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) =>
      notes.map(n => n.id === selectedNoteId ? { ...n, duration: newDuration, dots: newDots || 0 } : n)
    )
    set({ selectedDuration: newDuration, selectedDots: newDots || 0 })
    const overflowBeats = newBeats - available
    if (overflowBeats > 0.001 && note.pitch && !note.isRest) {
      const nextIdx  = selectedMeasureIndex + 1
      const nextPart = get().score.parts.find(p => p.id === selectedPartId)
      const nextM    = nextPart?.measures[nextIdx]
      if (nextM) {
        const contDur = beatsToRest(Math.min(overflowBeats, nextM.timeSignature.beats))
        const contId  = crypto.randomUUID()
        get()._applyToMeasure(selectedPartId, nextIdx, (notes) => {
          const firstRest = notes.find(n => n.isRest)
          if (!firstRest) return notes
          const restBeats  = noteDuration(firstRest)
          const leftover   = restBeats - (DURATION_BEATS[contDur.duration+(contDur.dots?'d':'')] || DURATION_BEATS[contDur.duration] || 1)
          const contNote   = { id: contId, isRest: false, pitch: note.pitch,
            duration: contDur.duration, dots: contDur.dots, tieStart: false }
          const idx        = notes.findIndex(n => n.id === firstRest.id)
          const leftovers  = leftover > 0.001 ? makeRests(leftover, `cont_${contId}`) : []
          return [...notes.slice(0, idx), contNote, ...leftovers, ...notes.slice(idx+1)]
        })
      }
    }
  },

  dropNoteAtBeat: (partId, measureIndex, pitch, duration, dots, beatPosition) => {
    get()._snapshot()
    const part    = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure) return
    const maxBeats    = measure.timeSignature.beats
    const clampedBeat = Math.max(0, Math.min(beatPosition, maxBeats - 0.001))
    const nonChord    = measure.notes.filter(n => !n.chordWith)
    let cursor = 0, targetRest = null
    for (const n of nonChord) {
      const dur = noteDuration(n)
      if (n.isRest && clampedBeat >= cursor - 0.001 && clampedBeat < cursor + dur - 0.001) {
        targetRest = n; break
      }
      cursor += dur
    }
    if (!targetRest) targetRest = nonChord.find(n => n.isRest)
    if (!targetRest) return
    const restBeats   = noteDuration(targetRest)
    const durKey      = duration + (dots ? 'd' : '')
    const newBeats    = DURATION_BEATS[durKey] || DURATION_BEATS[duration] || 1
    const actualBeats = Math.min(newBeats, restBeats)
    const fitDur      = actualBeats === newBeats ? { duration, dots: dots || 0 } : beatsToRest(restBeats)
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
    set({ selectedPartId: partId, selectedMeasureIndex: measureIndex, selectedNoteId: newId })
  },

  addChordNote: (partId, measureIndex, baseNoteId, pitch) => {
    get()._snapshot()
    const part    = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure || !pitch) return
    const base = measure.notes.find(n => n.id === baseNoteId && !n.isRest)
    if (!base) return
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
      selectedNoteId: baseNoteId,
      score: {
        ...s.score,
        parts: s.score.parts.map(p => p.id !== partId ? p : {
          ...p,
          measures: p.measures.map((m, i) => i !== measureIndex ? m : {
            ...m,
            notes: [...m.notes, {
              id: newId, isRest: false, pitch,
              duration: base.duration, dots: base.dots,
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
    const totalCols = Math.max(...state.score.parts.map(p => p.measures.length))
    if (measureIndex >= totalCols) {
      set(s => ({ score: { ...s.score, parts: padPartsToCount(s.score.parts, measureIndex + 1) } }))
    }
    const part = get().score.parts.find(p => p.id === partId)
    const measure = part?.measures[measureIndex]
    if (!measure) return
    if (chordMode && selectedNoteId) {
      const base = measure.notes.find(n => n.id === selectedNoteId && !n.isRest)
      if (base) { get().addChordNote(partId, measureIndex, selectedNoteId, noteData.pitch); return }
    }
    const selNote = measure.notes.find(n => n.id === selectedNoteId)
    if (selNote?.isRest) { get().fillSelectedRest(noteData.pitch); return }
    const realNotes = measure.notes.filter(n => !n.chordWith && !n.isRest)
    const usedBeats = realNotes.reduce((sum, n) => sum + noteDuration(n), 0)
    const available = measure.timeSignature.beats - usedBeats
    if (available < 0.001) {
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
        return [...notes.slice(0, idx), newNote, ...leftovers, ...notes.slice(idx + 1)]
      })
      set({ selectedMeasureIndex: nextIdx, selectedNoteId: newId })
      return
    }
    const newId = crypto.randomUUID()
    get()._applyToMeasure(partId, measureIndex, (notes) => {
      const firstRest = notes.find(n => n.isRest)
      if (!firstRest) return notes
      const restBeats = noteDuration(firstRest)
      const durKey = noteData.duration + (noteData.dots ? 'd' : '')
      let nb = DURATION_BEATS[durKey] || DURATION_BEATS[noteData.duration] || 1
      if (nb > restBeats + 0.001) nb = restBeats
      const fit = nb === restBeats ? noteData : { ...noteData, ...beatsToRest(restBeats) }
      const newNote = { id: newId, ...fit, isRest: false, pitch: noteData.pitch }
      const leftover = restBeats - noteDuration(newNote)
      const idx = notes.findIndex(n => n.id === firstRest.id)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `fill2_${newId}`) : []
      return [...notes.slice(0, idx), newNote, ...leftovers, ...notes.slice(idx + 1)]
    })
    set({ selectedNoteId: newId })
  },

  updateNote: (partId, measureIndex, noteId, changes) => {
    if (changes.duration !== undefined || changes.dots !== undefined) {
      const note = get().score.parts.find(p => p.id === partId)?.measures[measureIndex]?.notes.find(n => n.id === noteId)
      if (note) {
        const newDur  = changes.duration !== undefined ? changes.duration : note.duration
        const newDots = changes.dots !== undefined ? changes.dots : (note.dots || 0)
        set({ selectedNoteId: noteId, selectedPartId: partId, selectedMeasureIndex: measureIndex })
        get().changeSelectedDuration(newDur, newDots)
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

  deleteNote: (partId, measureIndex, noteId) => {
    get()._snapshot()
    get()._applyToMeasure(partId, measureIndex, (notes) => {
      const note = notes.find(n => n.id === noteId)
      if (!note || note.isRest) return notes
      const rest = { ...beatsToRest(noteDuration(note)), id: noteId, isRest: true, pitch: null }
      return notes.map(n => n.id === noteId ? rest : n).filter(n => n.chordWith !== noteId)
    })
    set({ selectedNoteId: null })
  },

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

  clearMeasureColumn: (colIndex) => set(s => ({
    selectedNoteId: null,
    score: {
      ...s.score,
      parts: s.score.parts.map(p => ({
        ...p,
        measures: p.measures.map((m, i) => i !== colIndex ? m : {
          ...m, notes: normalizeMeasure([], m.timeSignature.beats),
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

  addPart: (clef = 'treble', name, instrumentId) => {
    const state = get()
    const count = Math.max(...state.score.parts.map(p => p.measures.length), 1)
    const lastM = state.score.parts[0]?.measures[count - 1]
    const instr = INSTRUMENTS.find(i => i.id === instrumentId)
    const effectiveClef = instr?.defaultClef || clef
    const measures = Array.from({ length: count }, () =>
      makeEmptyMeasure(lastM?.timeSignature, lastM?.keySignature)
    )
    set(s => ({
      score: {
        ...s.score,
        parts: [...s.score.parts, {
          id: crypto.randomUUID(),
          name: name || instr?.label || (effectiveClef === 'bass' ? 'Bass' : 'Treble'),
          instrument: instrumentId || (effectiveClef === 'bass' ? 'piano-bass' : 'piano'),
          clef: effectiveClef,
          measures,
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

  shiftPitchStep: (dir) => { get().shiftPitchHalfStep(dir) },

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

  moveNote: (noteId, fromPartId, fromMeasureIndex, toPartId, toMeasureIndex) => {
    const { score } = get()
    const fromPart = score.parts.find(p => p.id === fromPartId)
    const note     = fromPart?.measures[fromMeasureIndex]?.notes.find(n => n.id === noteId)
    if (!note || note.isRest) return
    get()._snapshot()
    get().deleteNote(fromPartId, fromMeasureIndex, noteId)
    get().addNote(toPartId, toMeasureIndex, {
      pitch: note.pitch, duration: note.duration, dots: note.dots || 0
    })
  },

  loadScore: (score) => set({ score }),

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

  insertTriplet: (baseDuration) => {
    const { selectedPartId, selectedMeasureIndex } = get()
    if (selectedMeasureIndex === null) return
    get()._snapshot()
    const part    = get().score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    if (!measure) return
    const key = baseDuration + 't'
    const tripletBeats = DURATION_BEATS[key] || (DURATION_BEATS[baseDuration] * 2/3)
    const totalBeats   = tripletBeats * 3
    const nonChord = measure.notes.filter(n => !n.chordWith)
    let targetRest = null
    for (const n of nonChord) {
      if (n.isRest && noteDuration(n) >= totalBeats - 0.001) { targetRest = n; break }
    }
    if (!targetRest) return
    const restBeats  = noteDuration(targetRest)
    const leftover   = restBeats - totalBeats
    const groupId    = crypto.randomUUID()
    const tripletNotes = [0,1,2].map(i => ({
      id: crypto.randomUUID(), isRest: true, pitch: null,
      duration: baseDuration, dots: 0,
      triplet: true, tripletGroupId: groupId, tripletIndex: i, tripletOf: 3,
    }))
    get()._applyToMeasure(selectedPartId, selectedMeasureIndex, (notes) => {
      const idx      = notes.findIndex(n => n.id === targetRest.id)
      const before   = notes.slice(0, idx)
      const after    = notes.slice(idx + 1).filter(n => !n.isRest)
      const leftovers = leftover > 0.001 ? makeRests(leftover, `trip_after`) : []
      return [...before, ...tripletNotes, ...leftovers, ...after]
    })
    set({ selectedNoteId: tripletNotes[0].id })
    saveToStorage(get().score)
  },

  // ── Dynamics ──────────────────────────────────────────────────────────────
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

  // ── Hairpins ──────────────────────────────────────────────────────────────
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

  // ── Rehearsal marks ───────────────────────────────────────────────────────
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
  removeStaffText: (id) => {
    set(s => ({ score: { ...s.score, staffTexts: (s.score.staffTexts||[]).filter(t => t.id !== id) }}))
    saveToStorage(get().score)
  },
}))