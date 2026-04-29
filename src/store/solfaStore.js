// src/store/solfaStore.js
// FaithScore — Complete solfa notation store
// Fully independent from scoreStore (staff notation)

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
  solo:         { label:'Solo',          voices:[{id:'solo',  name:'Voice',   label:'V'}] },
  sa:           { label:'SA',            voices:[{id:'s',     name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'}] },
  tb:           { label:'TB',            voices:[{id:'t',     name:'Tenor',   label:'T'},{id:'b',name:'Bass',label:'B'}] },
  sab:          { label:'SAB',           voices:[{id:'s',     name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'},{id:'b',name:'Bass',label:'B'}] },
  satb:         { label:'SATB',          voices:[{id:'s',     name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}] },
  solo_satb:    { label:'Solo + SATB',   voices:[{id:'solo',  name:'Solo',    label:'Solo'},{id:'s',name:'Soprano',label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'}] },
  satb_piano:   { label:'SATB + Piano',  voices:[{id:'s',     name:'Soprano', label:'S'},{id:'a',name:'Alto',label:'A'},{id:'t',name:'Tenor',label:'T'},{id:'b',name:'Bass',label:'B'},{id:'piano',name:'Piano',label:'Pno'}] },
  solo_piano:   { label:'Solo + Piano',  voices:[{id:'solo',  name:'Solo',    label:'Solo'},{id:'piano',name:'Piano',label:'Pno'}] },
}

// ── NOTE / MEASURE MODEL ─────────────────────────────────────────────────────
// SolfaNote: one rhythmic event in a measure
// {
//   id:          string (uuid)
//   type:        'note' | 'rest' | 'sustain'
//   syllable:    'd'|'r'|'m'|'f'|'s'|'l'|'t'|'de'|'ri'|'fe'|'se'|'ta' | null
//   octave:      -1 (lower) | 0 (middle) | 1 (upper)
//   duration:    beats (1=beat, 0.5=half, 0.25=quarter, 2=double)
//   beatPos:     fractional beat position within measure (0-based)
//   lyric:       string | null
// }
//
// SolfaMeasure: { id, timeSignature:{beats,beatType}, notes:SolfaNote[] }
// SolfaPart:    { id, name, label, measures:SolfaMeasure[] }
// SolfaScore:   { id, type:'solfa', title, key, tempo, timeSignature,
//                  voiceCombo, parts, sections, _savedAt, _cloudId }

function uid() { return crypto.randomUUID() }

function makeRest(beatPos, duration=1) {
  return { id:uid(), type:'rest', syllable:null, octave:0, duration, beatPos, lyric:null }
}

function makeEmptyMeasure(beats=4) {
  // One rest per beat, filling the measure
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

export function buildEmptySolfaScore(voiceComboKey='satb', key='C', beats=4, numMeasures=12) {
  const combo  = VOICE_COMBOS[voiceComboKey] || VOICE_COMBOS.satb
  const ts     = {beats, beatType:4}
  return {
    id:            uid(),
    type:          'solfa',
    title:         'Untitled',
    key,
    tempo:         80,
    timeSignature: ts,
    voiceCombo:    voiceComboKey,
    parts:         combo.voices.map(v => makePart(v, numMeasures, beats)),
    sections:      [],   // [{id, label:'CHORUS', startMeasure, endMeasure}]
    _savedAt:      null,
    _cloudId:      null,
  }
}

// ── STORE ─────────────────────────────────────────────────────────────────────
export const useSolfaStore = create((set, get) => ({
  score:             buildEmptySolfaScore(),
  selectedPartId:    null,
  selectedMeasureIdx:null,
  selectedBeatPos:   null,   // fractional beat position of cursor
  selectedNoteId:    null,
  inputMode:         'select',   // 'select' | 'note'
  selectedDuration:  1,
  selectedOctave:    0,
  _undoStack:        [],

  // ── Metadata ────────────────────────────────────────────────────────────────
  setTitle:   t  => set(s=>({score:{...s.score, title:t}})),
  setKey:     k  => set(s=>({score:{...s.score, key:k}})),
  setTempo:   t  => set(s=>({score:{...s.score, tempo:t}})),
  setCloudId: id => set(s=>({score:{...s.score, _cloudId:id}})),

  // ── Input state ─────────────────────────────────────────────────────────────
  setInputMode:       m  => set({inputMode:m}),
  setSelectedDuration:d  => set({selectedDuration:d}),
  setSelectedOctave:  o  => set({selectedOctave:o}),

  loadScore: score => set({score, selectedPartId:score.parts[0]?.id ?? null, selectedMeasureIdx:null, selectedNoteId:null}),

  // ── Selection ───────────────────────────────────────────────────────────────
  selectNote: (noteId, partId, measureIdx) => set({
    selectedNoteId:noteId, selectedPartId:partId, selectedMeasureIdx:measureIdx,
  }),
  selectBeat: (partId, measureIdx, beatPos) => set({
    selectedPartId:partId, selectedMeasureIdx:measureIdx,
    selectedBeatPos:beatPos, selectedNoteId:null,
  }),
  clearSelection: () => set({selectedNoteId:null, selectedBeatPos:null, selectedMeasureIdx:null}),

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

  // ── Core note mutation ───────────────────────────────────────────────────────
  // Places/replaces a note at the given beat position in a measure.
  // Existing notes that overlap are removed/trimmed.
  placeNote: (partId, measureIdx, beatPos, syllable, octave, duration) => {
    get()._snapshot()
    const durVal = duration ?? get().selectedDuration
    const octVal = octave  ?? get().selectedOctave
    set(s => {
      const parts = s.score.parts.map(p => {
        if (p.id !== partId) return p
        const measures = p.measures.map((m, mi) => {
          if (mi !== measureIdx) return m
          const maxBeats = m.timeSignature.beats

          // Remove all notes that overlap [beatPos, beatPos+durVal)
          const filtered = m.notes.filter(n => {
            const nEnd = n.beatPos + n.duration
            const newEnd = beatPos + durVal
            // keep if completely before or completely after
            return nEnd <= beatPos + 0.001 || n.beatPos >= newEnd - 0.001
          })

          // Build the new note
          const newNote = {
            id: uid(),
            type: syllable ? 'note' : 'rest',
            syllable: syllable || null,
            octave:   octVal,
            duration: Math.min(durVal, maxBeats - beatPos),
            beatPos,
            lyric: null,
          }

          // Fill any remaining gaps with rests
          const merged = [...filtered, newNote].sort((a,b)=>a.beatPos-b.beatPos)
          const filled = fillGaps(merged, maxBeats)
          return {...m, notes:filled}
        })
        return {...p, measures}
      })
      return {score:{...s.score, parts}}
    })
  },

  // Place sustain (–) at beat position
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
            const nEnd = n.beatPos + n.duration
            const newEnd = beatPos + durVal
            return nEnd <= beatPos+0.001 || n.beatPos >= newEnd-0.001
          })
          const sustain = {id:uid(), type:'sustain', syllable:null, octave:0,
            duration:Math.min(durVal, maxBeats-beatPos), beatPos, lyric:null}
          const merged = [...filtered, sustain].sort((a,b)=>a.beatPos-b.beatPos)
          return {...m, notes:fillGaps(merged, maxBeats)}
        })
        return {...p, measures}
      })
      return {score:{...s.score, parts}}
    })
  },

  // Set lyric on a note
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

  addMeasure: () => {
    set(s => {
      const beats = s.score.timeSignature.beats
      const parts = s.score.parts.map(p=>({...p, measures:[...p.measures, makeEmptyMeasure(beats)]}))
      return {score:{...s.score, parts}}
    })
  },

  addSection: (label, startMeasure, endMeasure) => {
    set(s=>({score:{...s.score, sections:[...s.score.sections,
      {id:uid(), label, startMeasure, endMeasure}]}}))
  },
}))

// Fill any rhythmic gaps in a measure with rests
function fillGaps(notes, maxBeats) {
  const sorted = [...notes].sort((a,b)=>a.beatPos-b.beatPos)
  const result = []
  let cursor = 0
  for (const n of sorted) {
    if (n.beatPos > cursor + 0.001) {
      // gap before this note
      result.push(makeRest(cursor, n.beatPos - cursor))
    }
    if (n.beatPos >= maxBeats - 0.001) break
    result.push(n)
    cursor = n.beatPos + n.duration
  }
  if (cursor < maxBeats - 0.001) {
    result.push(makeRest(cursor, maxBeats - cursor))
  }
  return result
}