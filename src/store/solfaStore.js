// src/store/solfaStore.js
// FaithScore — Complete solfa notation store

import { create } from 'zustand'

// ── PITCH TABLES ─────────────────────────────────────────────────────────────
export const SOLFA_SEMITONES = {
  d:0, de:1, r:2, ri:3, m:4, f:5, fe:6, s:7, se:8, l:9, ta:10, t:11,
}
export const KEY_ROOTS = {
  C:60,'C#':61,Db:61,D:62,'D#':63,Eb:63,E:64,F:65,'F#':66,Gb:66,
  G:67,'G#':68,Ab:68,A:69,'A#':70,Bb:70,B:71,
}
export function solfaToMidi(syllable, octave=0, key='C') {
  const root   = KEY_ROOTS[key] ?? 60
  const offset = SOLFA_SEMITONES[syllable?.toLowerCase()] ?? 0
  return root + offset + octave * 12
}

// ── VOICE COMBINATIONS ────────────────────────────────────────────────────────
export const VOICE_COMBOS = {
  solo:       { label:'Solo',         voices:[{id:'solo', name:'Voice',   label:'V'}] },
  sa:         { label:'SA',           voices:[{id:'s', name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'}] },
  tb:         { label:'TB',           voices:[{id:'t', name:'Tenor',   label:'T'},{id:'b',name:'Bass',label:'B'}] },
  sab:        { label:'SAB',          voices:[{id:'s', name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'},{id:'b',name:'Bass',label:'B'}] },
  satb:       { label:'SATB',         voices:[{id:'s', name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}] },
  solo_satb:  { label:'Solo + SATB',  voices:[{id:'solo',name:'Solo',label:'Solo'},{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}] },
  satb_piano: { label:'SATB + Piano', voices:[{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'},{id:'piano',name:'Piano',label:'Pno'}] },
  solo_piano: { label:'Solo + Piano', voices:[{id:'solo',name:'Solo',label:'Solo'},{id:'piano',name:'Piano',label:'Pno'}] },
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function uid() { return crypto.randomUUID() }

function makeRest(beatPos, duration=1) {
  return { id:uid(), type:'rest', syllable:null, octave:0, duration, beatPos, lyric:null }
}

function makeEmptyMeasure(beats=4) {
  const notes = []
  for (let i=0; i<beats; i++) notes.push(makeRest(i, 1))
  return { id:uid(), timeSignature:{beats, beatType:4}, notes }
}

function makePart(voiceDef, numMeasures=12, beats=4) {
  return {
    id:       voiceDef.id,
    name:     voiceDef.name,
    label:    voiceDef.label,
    measures: Array.from({length:numMeasures}, ()=>makeEmptyMeasure(beats)),
  }
}

// Fill rhythmic gaps with rests
function fillGaps(notes, maxBeats) {
  const sorted = [...notes].sort((a,b)=>a.beatPos-b.beatPos)
  const result = []
  let cursor = 0
  for (const n of sorted) {
    if (n.beatPos > cursor + 0.001) result.push(makeRest(cursor, n.beatPos - cursor))
    if (n.beatPos >= maxBeats - 0.001) break
    result.push(n)
    cursor = n.beatPos + n.duration
  }
  if (cursor < maxBeats - 0.001) result.push(makeRest(cursor, maxBeats - cursor))
  return result
}

export function buildEmptySolfaScore(voiceComboKey='satb', key='C', beats=4, numMeasures=12) {
  const combo = VOICE_COMBOS[voiceComboKey] || VOICE_COMBOS.satb
  return {
    id:            uid(),
    type:          'solfa',
    title:         'Untitled',
    key,
    tempo:         80,
    timeSignature: {beats, beatType:4},
    voiceCombo:    voiceComboKey,
    parts:         combo.voices.map(v => makePart(v, numMeasures, beats)),
    sections:      [],
    _savedAt:      null,
    _cloudId:      null,
  }
}

// ── STORE ─────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set, get) => ({
  score:              buildEmptySolfaScore(),
  selectedPartId:     null,
  selectedMeasureIdx: null,
  selectedBeatPos:    null,
  selectedNoteId:     null,
  inputMode:          'select',
  selectedDuration:   1,
  selectedOctave:     0,   // -1 = lower octave, 0 = middle, 1 = upper octave
  _undoStack:         [],

  // ── Metadata ────────────────────────────────────────────────────────────────
  setTitle:   t  => set(s=>({score:{...s.score, title:t}})),
  setKey:     k  => set(s=>({score:{...s.score, key:k}})),
  setTempo:   t  => set(s=>({score:{...s.score, tempo:t}})),
  setCloudId: id => set(s=>({score:{...s.score, _cloudId:id}})),

  // ── Input state ─────────────────────────────────────────────────────────────
  setInputMode:        m => set({inputMode:m}),
  setSelectedDuration: d => set({selectedDuration:d}),
  setSelectedOctave:   o => set({selectedOctave:o}),

  loadScore: score => set({
    score,
    selectedPartId:     score.parts[0]?.id ?? null,
    selectedMeasureIdx: null,
    selectedNoteId:     null,
  }),

  // ── Selection ───────────────────────────────────────────────────────────────
  selectNote: (noteId, partId, measureIdx) => set({
    selectedNoteId:     noteId,
    selectedPartId:     partId,
    selectedMeasureIdx: measureIdx,
  }),
  selectBeat: (partId, measureIdx, beatPos) => set({
    selectedPartId:     partId,
    selectedMeasureIdx: measureIdx,
    selectedBeatPos:    beatPos,
    selectedNoteId:     null,
  }),
  clearSelection: () => set({ selectedNoteId:null, selectedBeatPos:null, selectedMeasureIdx:null }),

  // ── Undo ────────────────────────────────────────────────────────────────────
  _snapshot: () => {
    const {score, _undoStack} = get()
    set({_undoStack:[...(_undoStack.slice(-30)), JSON.parse(JSON.stringify(score))]})
  },
  undo: () => {
    const {_undoStack} = get()
    if (!_undoStack.length) return
    set({score:_undoStack[_undoStack.length-1], _undoStack:_undoStack.slice(0,-1)})
  },

  // ── Place note ───────────────────────────────────────────────────────────────
  // FIX: octave is read directly from store's selectedOctave when not passed explicitly.
  // This was the root bug — callers were passing selOctave as a component state variable
  // that wasn't always in sync. Now the store is the single source of truth.
  placeNote: (partId, measureIdx, beatPos, syllable, octave, duration) => {
    get()._snapshot()
    const state  = get()
    const durVal = duration !== undefined ? duration : state.selectedDuration
    // Always use the store's current selectedOctave as the fallback
    const octVal = (octave !== undefined && octave !== null) ? octave : state.selectedOctave

    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const maxBeats = m.timeSignature.beats
          const filtered = m.notes.filter(n => {
            const nEnd   = n.beatPos + n.duration
            const newEnd = beatPos + durVal
            return nEnd <= beatPos + 0.001 || n.beatPos >= newEnd - 0.001
          })
          const newNote = {
            id:       uid(),
            type:     syllable ? 'note' : 'rest',
            syllable: syllable || null,
            octave:   octVal,   // ← correctly stamped from store
            duration: Math.min(durVal, maxBeats - beatPos),
            beatPos,
            lyric:    null,
          }
          const merged = [...filtered, newNote].sort((a,b)=>a.beatPos-b.beatPos)
          return {...m, notes: fillGaps(merged, maxBeats)}
        })
        return {...p, measures}
      })
      return {score:{...s.score, parts}}
    })
  },

  // FIX: Change octave on an already-placed selected note (for octave button changes after entry)
  changeNoteOctave: (partId, measureIdx, noteId, newOctave) => {
    if (!noteId) return
    get()._snapshot()
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          return { ...m, notes: m.notes.map(n => n.id === noteId ? {...n, octave: newOctave} : n) }
        })
        return {...p, measures}
      })
      return {score:{...s.score, parts}}
    })
  },

  // ── Sustain ──────────────────────────────────────────────────────────────────
  placeSustain: (partId, measureIdx, beatPos, duration) => {
    get()._snapshot()
    const durVal = duration ?? get().selectedDuration
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const maxBeats = m.timeSignature.beats
          const filtered = m.notes.filter(n => {
            const nEnd = n.beatPos + n.duration, newEnd = beatPos + durVal
            return nEnd <= beatPos+0.001 || n.beatPos >= newEnd-0.001
          })
          const sustain = { id:uid(), type:'sustain', syllable:null, octave:0,
            duration:Math.min(durVal, maxBeats-beatPos), beatPos, lyric:null }
          return {...m, notes:fillGaps([...filtered,sustain].sort((a,b)=>a.beatPos-b.beatPos), maxBeats)}
        })
        return {...p, measures}
      })
      return {score:{...s.score, parts}}
    })
  },

  // ── Lyric ────────────────────────────────────────────────────────────────────
  setLyric: (partId, measureIdx, noteId, lyric) => {
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          return {...m, notes:m.notes.map(n=>n.id===noteId?{...n,lyric}:n)}
        })
        return {...p, measures}
      })
      return {score:{...s.score, parts}}
    })
  },

  // ── Add / Delete measure ─────────────────────────────────────────────────────
  addMeasure: () => {
    set(s => {
      const beats = s.score.timeSignature.beats
      const parts = s.score.parts.map(p=>({...p, measures:[...p.measures, makeEmptyMeasure(beats)]}))
      return {score:{...s.score, parts}}
    })
  },

  // Delete a specific measure by index (defaults to currently selected, then last)
  deleteMeasure: (measureIdx) => {
    const {score, selectedMeasureIdx} = get()
    const numM = score.parts[0]?.measures?.length || 0
    if (numM <= 1) return  // always keep at least 1 measure
    get()._snapshot()
    const idx = measureIdx !== undefined ? measureIdx
              : selectedMeasureIdx !== null ? selectedMeasureIdx
              : numM - 1
    const newSel = Math.max(0, Math.min(idx, numM - 2))
    set(s => {
      const parts = s.score.parts.map(p=>({
        ...p, measures:p.measures.filter((_,i)=>i!==idx)
      }))
      // Select first note of the measure that's now at newSel
      const firstNote = parts[0]?.measures[newSel]?.notes[0]
      return {
        score: {...s.score, parts},
        selectedMeasureIdx: newSel,
        selectedNoteId:     firstNote?.id ?? null,
        selectedPartId:     s.selectedPartId ?? parts[0]?.id ?? null,
      }
    })
  },

  addSection: (label, startMeasure, endMeasure) => {
    set(s=>({score:{...s.score, sections:[...s.score.sections,
      {id:uid(), label, startMeasure, endMeasure}]}}))
  },

  // ── Keyboard navigation (arrow keys) ────────────────────────────────────────
  // Moves selection: left/right = prev/next note (crossing measure lines)
  //                  up/down    = prev/next voice part (same beat position)
  navigateNote: (direction) => {
    const {score, selectedPartId, selectedMeasureIdx, selectedNoteId} = get()
    const selectNote = get().selectNote

    // Nothing selected yet — land on first note of first part
    if (!selectedPartId || selectedMeasureIdx === null) {
      const part = score.parts[0]
      const note = part?.measures[0]?.notes[0]
      if (note) selectNote(note.id, part.id, 0)
      return
    }

    const partIdx = score.parts.findIndex(p => p.id === selectedPartId)
    const part    = score.parts[partIdx]
    if (!part) return
    const measure = part.measures[selectedMeasureIdx]
    if (!measure) return

    const notes   = measure.notes
    const noteIdx = notes.findIndex(n => n.id === selectedNoteId)
    const curBeat = noteIdx >= 0 ? notes[noteIdx].beatPos : 0

    if (direction === 'right') {
      if (noteIdx >= 0 && noteIdx < notes.length - 1) {
        // Next note in same measure
        selectNote(notes[noteIdx + 1].id, selectedPartId, selectedMeasureIdx)
      } else if (selectedMeasureIdx < part.measures.length - 1) {
        // Jump to first note of next measure
        const nm = part.measures[selectedMeasureIdx + 1]
        if (nm?.notes[0]) selectNote(nm.notes[0].id, selectedPartId, selectedMeasureIdx + 1)
      }

    } else if (direction === 'left') {
      if (noteIdx > 0) {
        selectNote(notes[noteIdx - 1].id, selectedPartId, selectedMeasureIdx)
      } else if (selectedMeasureIdx > 0) {
        const pm = part.measures[selectedMeasureIdx - 1]
        const ln = pm?.notes[pm.notes.length - 1]
        if (ln) selectNote(ln.id, selectedPartId, selectedMeasureIdx - 1)
      }

    } else if (direction === 'down') {
      // Move to same beat in the next part
      if (partIdx < score.parts.length - 1) {
        const nextPart  = score.parts[partIdx + 1]
        const mNotes    = nextPart.measures[selectedMeasureIdx]?.notes || []
        const target    = mNotes.find(n => Math.abs(n.beatPos - curBeat) < 0.01) || mNotes[0]
        if (target) selectNote(target.id, nextPart.id, selectedMeasureIdx)
      }

    } else if (direction === 'up') {
      if (partIdx > 0) {
        const prevPart  = score.parts[partIdx - 1]
        const mNotes    = prevPart.measures[selectedMeasureIdx]?.notes || []
        const target    = mNotes.find(n => Math.abs(n.beatPos - curBeat) < 0.01) || mNotes[0]
        if (target) selectNote(target.id, prevPart.id, selectedMeasureIdx)
      }
    }
  },
}))