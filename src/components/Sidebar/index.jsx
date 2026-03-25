// src/components/Sidebar/index.jsx
// FaithScore — MuseScore-style left sidebar: Palettes / Layout / Properties tabs

import { useState } from 'react'
import { useScoreStore, DURATION_BEATS } from '../../store/scoreStore'

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          padding: '7px 12px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
          fontSize: 12, fontWeight: 600, color: '#1f2937',
          userSelect: 'none',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <span style={{
          display: 'inline-block', width: 14, fontSize: 10, color: '#6b7280',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s', marginRight: 6,
        }}>▶</span>
        {title}
      </button>
      {open && (
        <div style={{ padding: '4px 10px 10px 10px', background: '#fafafa' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function PaletteItem({ label, symbol, onClick, active, title: tip }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={tip || label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 2,
        width: 52, height: 44, borderRadius: 5,
        border: active ? '1.5px solid #2563eb' : '1px solid #e5e7eb',
        background: active ? '#eff6ff' : hover ? '#f3f4f6' : 'white',
        cursor: 'pointer', padding: '3px 2px',
        transition: 'all 0.1s',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, color: active ? '#2563eb' : '#1f2937' }}>
        {symbol}
      </span>
      <span style={{ fontSize: 9, color: '#6b7280', lineHeight: 1, textAlign: 'center' }}>
        {label}
      </span>
    </button>
  )
}

function PaletteGrid({ children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {children}
    </div>
  )
}

function ListItem({ label, symbol, sub, onClick, active }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '5px 8px', borderRadius: 5,
        border: active ? '1.5px solid #2563eb' : '1px solid transparent',
        background: active ? '#eff6ff' : hover ? '#f3f4f6' : 'transparent',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.1s',
      }}
    >
      <span style={{ fontSize: 17, width: 22, textAlign: 'center', color: '#1f2937' }}>
        {symbol}
      </span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#1f2937' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: '#9ca3af' }}>{sub}</div>}
      </div>
    </button>
  )
}

// ── helper: get beat of selected note ────────────────────────────────────────
function getBeatOfSelectedNote(st) {
  const { selectedPartId, selectedMeasureIndex, selectedNoteId, score } = st
  if (selectedNoteId === null || selectedMeasureIndex === null) return null
  const part    = score.parts.find(p => p.id === selectedPartId)
  const measure = part?.measures[selectedMeasureIndex]
  if (!measure) return null
  let beat = 0
  for (const n of measure.notes.filter(x => !x.chordWith)) {
    if (n.id === selectedNoteId) return { beat, measure, note: n }
    beat += (DURATION_BEATS[n.duration + (n.dots ? 'd' : '')] || DURATION_BEATS[n.duration] || 1)
  }
  return null
}

// ── PALETTES TAB ─────────────────────────────────────────────────────────────
function PalettesTab() {
  const setGlobalKeySignature  = useScoreStore(s => s.setGlobalKeySignature)
  const setGlobalTimeSignature = useScoreStore(s => s.setGlobalTimeSignature)
  const setTempo               = useScoreStore(s => s.setTempo)
  const score                  = useScoreStore(s => s.score)
  const selectedNoteId         = useScoreStore(s => s.selectedNoteId)
  const selectedPartId         = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex   = useScoreStore(s => s.selectedMeasureIndex)

  const currentKey  = score.parts[0]?.measures[0]?.keySignature ?? 0
  const currentTime = score.parts[0]?.measures[0]?.timeSignature ?? { beats: 4, beatType: 4 }

  // ── Apply articulation to selected note ──────────────────────────────────
  function applyArticulation(articulationType) {
    if (!selectedNoteId) return
    useScoreStore.getState()._applyToMeasure(
      selectedPartId, selectedMeasureIndex, notes =>
        notes.map(n => {
          if (n.id !== selectedNoteId) return n
          // Toggle: if same articulation already set, clear it
          const current = n.articulation
          return { ...n, articulation: current === articulationType ? null : articulationType }
        })
    )
  }

  // ── Get current articulation on selected note ────────────────────────────
  function getSelectedArticulation() {
    if (!selectedNoteId || selectedMeasureIndex === null) return null
    const part    = score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    return measure?.notes.find(n => n.id === selectedNoteId)?.articulation ?? null
  }

  // ── Apply barline to selected measure ────────────────────────────────────
  function applyBarline(barlineType) {
    if (selectedMeasureIndex === null) return
    useScoreStore.getState()._applyBarline(selectedMeasureIndex, barlineType)
  }

  // ── Add staff text to selected note position ──────────────────────────────
  function addStaffTextAtSelection(text) {
    const st = useScoreStore.getState()
    const result = getBeatOfSelectedNote(st)
    if (!result) {
      alert('Select a note first, then click a text type to add it at that position.')
      return
    }
    st.addStaffText(st.selectedPartId, st.selectedMeasureIndex, result.beat, text)
  }

  const currentArticulation = getSelectedArticulation()

  const KEY_SIGS = [
    { label: 'C maj', num: 0,  symbol: '○'  },
    { label: 'G maj', num: 1,  symbol: '1♯' },
    { label: 'D maj', num: 2,  symbol: '2♯' },
    { label: 'A maj', num: 3,  symbol: '3♯' },
    { label: 'E maj', num: 4,  symbol: '4♯' },
    { label: 'B maj', num: 5,  symbol: '5♯' },
    { label: 'F♯ maj',num: 6,  symbol: '6♯' },
    { label: 'F maj', num: -1, symbol: '1♭' },
    { label: 'B♭ maj',num: -2, symbol: '2♭' },
    { label: 'E♭ maj',num: -3, symbol: '3♭' },
    { label: 'A♭ maj',num: -4, symbol: '4♭' },
    { label: 'D♭ maj',num: -5, symbol: '5♭' },
    { label: 'G♭ maj',num: -6, symbol: '6♭' },
  ]

  const TIME_SIGS = [
    { label: '4/4', beats:4, beatType:4, symbol: '𝄴' },
    { label: '3/4', beats:3, beatType:4, symbol: '¾'  },
    { label: '2/4', beats:2, beatType:4, symbol: '½'  },
    { label: '2/2', beats:2, beatType:2, symbol: '𝄵' },
    { label: '6/8', beats:6, beatType:8, symbol: '⁶⁄₈'},
    { label: '9/8', beats:9, beatType:8, symbol: '⁹⁄₈'},
    { label:'12/8',beats:12, beatType:8, symbol:'¹²⁄₈'},
    { label: '5/4', beats:5, beatType:4, symbol: '⁵⁄₄'},
    { label: '7/8', beats:7, beatType:8, symbol: '⁷⁄₈'},
  ]

  const CLEFS = [
    { label: 'Treble', symbol: '𝄞', clef: 'treble' },
    { label: 'Bass',   symbol: '𝄢', clef: 'bass'   },
    { label: 'Alto',   symbol: '𝄡', clef: 'alto'   },
    { label: 'Tenor',  symbol: '𝄡', clef: 'tenor'  },
  ]

  const BARLINES = [
    { label: 'Normal',   symbol: '|',    type: 'single'    },
    { label: 'Double',   symbol: '‖',    type: 'double'    },
    { label: 'Final',    symbol: '𝄂',    type: 'end'       },
    { label: 'Repeat →', symbol: '|:',   type: 'repeat-begin' },
    { label: 'Repeat ←', symbol: ':|',   type: 'repeat-end'   },
    { label: '↔ Repeat', symbol: ':|:',  type: 'repeat-both'  },
    { label: 'Dashed',   symbol: '¦',    type: 'dashed'    },
    { label: 'Dotted',   symbol: '⋮',    type: 'dotted'    },
  ]

  const ACCIDENTALS = [
    { label: 'Sharp',     symbol: '♯', acc: '#'  },
    { label: 'Flat',      symbol: '♭', acc: 'b'  },
    { label: 'Natural',   symbol: '♮', acc: null },
    { label: 'Dbl Sharp', symbol: '𝄪', acc: '##' },
    { label: 'Dbl Flat',  symbol: '𝄫', acc: 'bb' },
  ]

  const DYNAMICS = [
    { label: 'ppp',  symbol: 'ppp',  sub: 'pianissississimo' },
    { label: 'pp',   symbol: 'pp',   sub: 'pianissimo' },
    { label: 'p',    symbol: 'p',    sub: 'piano' },
    { label: 'mp',   symbol: 'mp',   sub: 'mezzo-piano' },
    { label: 'mf',   symbol: 'mf',   sub: 'mezzo-forte' },
    { label: 'f',    symbol: 'f',    sub: 'forte' },
    { label: 'ff',   symbol: 'ff',   sub: 'fortissimo' },
    { label: 'fff',  symbol: 'fff',  sub: 'fortississimo' },
    { label: 'sfz',  symbol: 'sfz',  sub: 'sforzando' },
    { label: 'fp',   symbol: 'fp',   sub: 'forte-piano' },
  ]

  // Articulations — now functional: stored on note.articulation
  const ARTICULATIONS = [
    { label: 'Staccato',   symbol: '·',   type: 'staccato'   },
    { label: 'Staccatiss', symbol: '▲',   type: 'staccatissimo' },
    { label: 'Tenuto',     symbol: '—',   type: 'tenuto'     },
    { label: 'Accent',     symbol: '>',   type: 'accent'     },
    { label: 'Marcato',    symbol: '^',   type: 'marcato'    },
    { label: 'Fermata',    symbol: '𝄐',   type: 'fermata'    },
    { label: 'Trill',      symbol: 'tr',  type: 'trill'      },
    { label: 'Mordent',    symbol: '𝆁',   type: 'mordent'    },
    { label: 'Turn',       symbol: '𝆃',   type: 'turn'       },
    { label: 'Portato',    symbol: '—·',  type: 'portato'    },
    { label: 'Snap pizz', symbol: '⊙',   type: 'snap-pizz'  },
    { label: 'Harmonic',   symbol: '○',   type: 'harmonic'   },
  ]

  const TEMPO_MARKS = [
    { label: 'Larghissimo', sub: '≤24 bpm',  bpm: 20  },
    { label: 'Grave',       sub: '25–45',     bpm: 35  },
    { label: 'Largo',       sub: '40–60',     bpm: 50  },
    { label: 'Larghetto',   sub: '60–66',     bpm: 63  },
    { label: 'Adagio',      sub: '66–76',     bpm: 70  },
    { label: 'Andante',     sub: '76–108',    bpm: 92  },
    { label: 'Moderato',    sub: '108–120',   bpm: 114 },
    { label: 'Allegretto',  sub: '112–120',   bpm: 116 },
    { label: 'Allegro',     sub: '120–156',   bpm: 138 },
    { label: 'Vivace',      sub: '156–176',   bpm: 166 },
    { label: 'Presto',      sub: '168–200',   bpm: 184 },
    { label: 'Prestissimo', sub: '200+',      bpm: 208 },
  ]

  const REPEATS = [
    { label: 'Segno',         symbol: '𝄋'  },
    { label: 'Coda',          symbol: '𝄌'  },
    { label: 'D.S.',          symbol: '𝄋.' },
    { label: 'D.C.',          symbol: 'D.C.' },
    { label: 'Fine',          symbol: 'Fine' },
    { label: 'D.C. al Fine',  symbol: 'D.C.F' },
    { label: '1st ending',    symbol: '1.' },
    { label: '2nd ending',    symbol: '2.' },
  ]

  // Text palette — clicking adds a staff text annotation at the selected note
  const TEXT_TYPES = [
    { label: 'Tempo text',  symbol: 'T',   text: 'Tempo'       },
    { label: 'Expression',  symbol: 'Ex',  text: 'expr.'       },
    { label: 'Technique',   symbol: 'Te',  text: 'pizz.'       },
    { label: 'Rehearsal',   symbol: 'A',   text: null          }, // handled separately
    { label: 'Staff text',  symbol: 'T̲',  text: 'Text'        },
    { label: 'Chord sym.',  symbol: 'Am',  text: 'Am'          },
    { label: 'Fingering',   symbol: '1',   text: '1'           },
    { label: 'Bow: down',   symbol: '⊓',   text: '⊓'          },
    { label: 'Bow: up',     symbol: 'V',   text: 'V'           },
    { label: 'Pedal',       symbol: '𝄷',   text: '𝄷'          },
    { label: 'Ped. off',    symbol: '𝄸',   text: '𝄸'          },
    { label: 'Col legno',   symbol: 'col', text: 'col legno'   },
  ]

  function applyAccidental(acc) {
    if (!selectedNoteId) return
    const part    = score.parts.find(p => p.id === selectedPartId)
    const measure = part?.measures[selectedMeasureIndex]
    const note    = measure?.notes.find(n => n.id === selectedNoteId)
    if (!note?.pitch) return
    useScoreStore.getState()._applyToMeasure(selectedPartId, selectedMeasureIndex, notes =>
      notes.map(n => n.id === selectedNoteId
        ? { ...n, pitch: { ...n.pitch, accidental: acc } }
        : n
      )
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>

      {/* ── Clefs ─────────────────────────────────────────── */}
      <Section title="Clefs">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a part in the score header, then click a clef to change it.
        </div>
        <PaletteGrid>
          {CLEFS.map(cl => (
            <PaletteItem key={cl.clef} label={cl.label} symbol={cl.symbol}
              title={`${cl.label} clef`}
              onClick={() => {
                const st = useScoreStore.getState()
                if (!st.selectedPartId) return
                // Update the clef for the selected part
                st.setPartClef && st.setPartClef(st.selectedPartId, cl.clef)
              }} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Key Signatures ───────────────────────────────── */}
      <Section title="Key Signatures" defaultOpen>
        <PaletteGrid>
          {KEY_SIGS.map(k => (
            <PaletteItem key={k.num} label={k.label} symbol={k.symbol}
              active={currentKey === k.num}
              onClick={() => setGlobalKeySignature(k.num)}
              title={k.label} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Time Signatures ──────────────────────────────── */}
      <Section title="Time Signatures" defaultOpen>
        <PaletteGrid>
          {TIME_SIGS.map(t => (
            <PaletteItem key={t.label} label={t.label} symbol={t.symbol}
              active={currentTime.beats === t.beats && currentTime.beatType === t.beatType}
              onClick={() => setGlobalTimeSignature(t.beats, t.beatType)}
              title={`${t.label} time`} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Tempo ────────────────────────────────────────── */}
      <Section title="Tempo">
        {TEMPO_MARKS.map(t => (
          <ListItem key={t.label} label={t.label} symbol="♩" sub={t.sub}
            onClick={() => setTempo(t.bpm)} />
        ))}
      </Section>

      {/* ── Transpose ────────────────────────────────────── */}
      <Section title="Transpose" defaultOpen>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
          Select a note or measure range, then transpose:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            { label: '+½',  semi: 1,   title: 'Up half step (Ctrl+↑)' },
            { label: '−½',  semi: -1,  title: 'Down half step (Ctrl+↓)' },
            { label: '+1',  semi: 2,   title: 'Up whole step' },
            { label: '−1',  semi: -2,  title: 'Down whole step' },
            { label: '+3',  semi: 3,   title: 'Up minor third' },
            { label: '+4',  semi: 5,   title: 'Up perfect fourth' },
            { label: '+5',  semi: 7,   title: 'Up perfect fifth' },
            { label: '+8ve',semi: 12,  title: 'Up octave (Ctrl+→)' },
            { label: '−8ve',semi: -12, title: 'Down octave (Ctrl+←)' },
          ].map(t => (
            <button key={t.label} title={t.title}
              onClick={() => useScoreStore.getState().transposeSelection(t.semi)}
              onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background='white'}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #e5e7eb',
                background: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                color: t.semi > 0 ? '#166534' : '#991b1b' }}>
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Accidentals ──────────────────────────────────── */}
      <Section title="Accidentals">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a note, then click to apply:
        </div>
        <PaletteGrid>
          {ACCIDENTALS.map(a => (
            <PaletteItem key={a.label} label={a.label} symbol={a.symbol}
              onClick={() => applyAccidental(a.acc)}
              title={`Apply ${a.label} to selected note`} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Dynamics ─────────────────────────────────────── */}
      <Section title="Dynamics">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a note, then click to place dynamic marking.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {DYNAMICS.map(d => (
            <button key={d.label} title={d.sub}
              onClick={() => {
                const st = useScoreStore.getState()
                const result = getBeatOfSelectedNote(st)
                if (!result) return
                st.addDynamic(st.selectedPartId, st.selectedMeasureIndex, result.beat, d.symbol)
              }}
              style={{
                padding: '4px 8px', borderRadius: 4, border: '1px solid #e5e7eb',
                background: 'white', cursor: 'pointer', fontSize: 12,
                fontStyle: 'italic', fontFamily: 'Times New Roman, serif',
                fontWeight: 700,
              }}
              onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background='white'}
            >{d.symbol}</button>
          ))}
        </div>

        {/* Hairpins */}
        <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
          {[
            { label: 'Cresc.', type: 'cresc',   symbol: '<' },
            { label: 'Decresc.', type: 'decresc', symbol: '>' },
          ].map(h => (
            <button key={h.type} title={`Add ${h.label} hairpin`}
              onClick={() => {
                const st = useScoreStore.getState()
                const result = getBeatOfSelectedNote(st)
                if (!result) return
                const { selectedPartId, selectedMeasureIndex } = st
                const endBeat = result.beat + 2  // 2-beat hairpin by default
                st.addHairpin(selectedPartId, selectedMeasureIndex, result.beat,
                  selectedMeasureIndex, Math.min(endBeat, (result.measure.timeSignature?.beats ?? 4)), h.type)
              }}
              style={{
                flex: 1, padding: '4px', borderRadius: 4, border: '1px solid #e5e7eb',
                background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              }}
              onMouseEnter={e => e.currentTarget.style.background='#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background='white'}
            >{h.symbol} {h.label}</button>
          ))}
        </div>
      </Section>

      {/* ── Articulations — now functional ───────────────── */}
      <Section title="Articulations">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a note, then click to toggle. Stored on note, rendered above staff.
        </div>
        <PaletteGrid>
          {ARTICULATIONS.map(a => (
            <PaletteItem key={a.type} label={a.label} symbol={a.symbol}
              active={currentArticulation === a.type}
              onClick={() => applyArticulation(a.type)}
              title={`${a.label} — click to toggle`} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Text ─────────────────────────────────────────── */}
      <Section title="Text">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a note then click to add text above the staff.
        </div>
        <PaletteGrid>
          {TEXT_TYPES.map(t => (
            <PaletteItem key={t.label} label={t.label} symbol={t.symbol}
              title={`Add ${t.label}`}
              onClick={() => {
                if (t.label === 'Rehearsal') {
                  const { selectedMeasureIndex } = useScoreStore.getState()
                  if (selectedMeasureIndex === null) return
                  const letter = prompt('Rehearsal mark letter:', 'A')
                  if (letter) useScoreStore.getState().addRehearsalMark(selectedMeasureIndex, letter.trim().slice(0, 3))
                } else {
                  addStaffTextAtSelection(t.text)
                }
              }} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Rehearsal Marks ──────────────────────────────── */}
      <Section title="Rehearsal Marks">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
          Select a measure, then click a letter:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => (
            <button key={letter}
              onClick={() => {
                const { selectedMeasureIndex } = useScoreStore.getState()
                if (selectedMeasureIndex === null) return
                useScoreStore.getState().addRehearsalMark(selectedMeasureIndex, letter)
              }}
              style={{
                width: 24, height: 24, borderRadius: 4,
                border: '1px solid #e5e7eb', background: 'white',
                cursor: 'pointer', fontSize: 11, fontWeight: 700,
                color: '#374151',
              }}
              onMouseEnter={e => { e.currentTarget.style.background='#eff6ff'; e.currentTarget.style.borderColor='#93c5fd' }}
              onMouseLeave={e => { e.currentTarget.style.background='white'; e.currentTarget.style.borderColor='#e5e7eb' }}
            >{letter}</button>
          ))}
        </div>
      </Section>

      {/* ── Repeats & Jumps ──────────────────────────────── */}
      <Section title="Repeats & Jumps">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a measure, then click to add a repeat/jump marking as staff text.
        </div>
        <PaletteGrid>
          {REPEATS.map(r => (
            <PaletteItem key={r.label} label={r.label} symbol={r.symbol}
              title={r.label}
              onClick={() => {
                const st = useScoreStore.getState()
                if (st.selectedMeasureIndex === null) return
                st.addRehearsalMark(st.selectedMeasureIndex, r.label)
              }} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Barlines — now functional ─────────────────────── */}
      <Section title="Barlines">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Select a measure, then click a barline style to apply it.
        </div>
        <PaletteGrid>
          {BARLINES.map(b => (
            <PaletteItem key={b.type} label={b.label} symbol={b.symbol}
              title={`${b.label} barline`}
              onClick={() => applyBarline(b.type)} />
          ))}
        </PaletteGrid>
      </Section>

      {/* ── Brackets ─────────────────────────────────────── */}
      <Section title="Brackets">
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
          Bracket/brace styling for multi-part scores.
        </div>
        <PaletteGrid>
          <PaletteItem label="Bracket"   symbol="[" title="Square bracket" />
          <PaletteItem label="Brace"     symbol="{" title="Curly brace (piano)" />
          <PaletteItem label="Line"      symbol="|" title="Connecting line" />
          <PaletteItem label="Sq. Brace" symbol="⟦" title="Double square bracket" />
        </PaletteGrid>
      </Section>

    </div>
  )
}

// ── LAYOUT TAB ────────────────────────────────────────────────────────────────
function LayoutTab() {
  const score        = useScoreStore(s => s.score)
  const setTempo     = useScoreStore(s => s.setTempo)
  const zoom         = useScoreStore(s => s.zoom)
  const setZoom      = useScoreStore(s => s.setZoom)
  const [spacing, setSpacing] = useState(1.2)
  const [staffSize, setStaffSize] = useState(7)
  const [margins, setMargins]  = useState({ top:10, bottom:10, left:12, right:12 })

  function Row({ label, children }) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'5px 0', borderBottom:'1px solid #f3f4f6', fontSize:11 }}>
        <span style={{ color:'#6b7280', flex:1 }}>{label}</span>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>{children}</div>
      </div>
    )
  }

  function NumInput({ value, onChange, min, max, step=1, unit }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:2 }}>
        <button onClick={() => onChange(Math.max(min, value-step))}
          style={{ width:20, height:20, border:'1px solid #d1d5db', borderRadius:3,
            background:'white', cursor:'pointer', fontSize:12, display:'flex',
            alignItems:'center', justifyContent:'center' }}>−</button>
        <span style={{ width:32, textAlign:'center', fontSize:11, fontWeight:600 }}>
          {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}{unit}
        </span>
        <button onClick={() => onChange(Math.min(max, value+step))}
          style={{ width:20, height:20, border:'1px solid #d1d5db', borderRadius:3,
            background:'white', cursor:'pointer', fontSize:12, display:'flex',
            alignItems:'center', justifyContent:'center' }}>+</button>
      </div>
    )
  }

  return (
    <div style={{ overflowY:'auto', flex:1, padding:'8px 12px' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8, marginTop:4 }}>
        Page Layout
      </div>

      <Row label="Zoom">
        <NumInput value={Math.round(zoom * 100)} onChange={v => setZoom(v / 100)} min={50} max={200} step={10} unit="%" />
      </Row>
      <Row label="Staff size">
        <NumInput value={staffSize} onChange={setStaffSize} min={4} max={12} step={0.5} unit="sp" />
      </Row>
      <Row label="Note spacing">
        <NumInput value={spacing} onChange={setSpacing} min={0.8} max={2.5} step={0.1} />
      </Row>

      <div style={{ fontSize:11, fontWeight:700, color:'#374151', margin:'12px 0 6px' }}>
        Margins (mm)
      </div>
      <Row label="Top">
        <NumInput value={margins.top} onChange={v=>setMargins(m=>({...m,top:v}))} min={0} max={50} />
      </Row>
      <Row label="Bottom">
        <NumInput value={margins.bottom} onChange={v=>setMargins(m=>({...m,bottom:v}))} min={0} max={50} />
      </Row>
      <Row label="Left">
        <NumInput value={margins.left} onChange={v=>setMargins(m=>({...m,left:v}))} min={0} max={50} />
      </Row>
      <Row label="Right">
        <NumInput value={margins.right} onChange={v=>setMargins(m=>({...m,right:v}))} min={0} max={50} />
      </Row>

      <div style={{ fontSize:11, fontWeight:700, color:'#374151', margin:'12px 0 6px' }}>
        Score Settings
      </div>
      <Row label="Tempo (BPM)">
        <NumInput value={score.tempo||120} onChange={setTempo} min={20} max={300} step={5} />
      </Row>
      <Row label="Measures/line">
        <NumInput value={4} onChange={()=>{}} min={1} max={8} />
      </Row>
    </div>
  )
}

// ── PROPERTIES TAB ────────────────────────────────────────────────────────────
function PropertiesTab() {
  const selectedNoteId       = useScoreStore(s => s.selectedNoteId)
  const selectedPartId       = useScoreStore(s => s.selectedPartId)
  const selectedMeasureIndex = useScoreStore(s => s.selectedMeasureIndex)
  const score                = useScoreStore(s => s.score)
  const changeSelectedDuration = useScoreStore(s => s.changeSelectedDuration)
  const shiftPitchHalfStep   = useScoreStore(s => s.shiftPitchHalfStep)
  const shiftPitchOctave     = useScoreStore(s => s.shiftPitchOctave)

  const part    = score.parts.find(p => p.id === selectedPartId)
  const measure = part?.measures[selectedMeasureIndex]
  const note    = measure?.notes.find(n => n.id === selectedNoteId)
  const selPart = score.parts.find(p => p.id === selectedPartId)

  function PropRow({ label, children }) {
    return (
      <div style={{ display:'flex', alignItems:'center', padding:'4px 0',
        borderBottom:'1px solid #f3f4f6', fontSize:11, gap:6 }}>
        <span style={{ color:'#6b7280', width:80, flexShrink:0 }}>{label}</span>
        <div style={{ flex:1, display:'flex', alignItems:'center', gap:4 }}>{children}</div>
      </div>
    )
  }

  function Tag({ children, color='#f3f4f6', text='#374151' }) {
    return (
      <span style={{ padding:'2px 7px', borderRadius:3, background:color,
        color:text, fontSize:11, fontWeight:600 }}>
        {children}
      </span>
    )
  }

  if (!selectedNoteId && selectedMeasureIndex === null) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', color:'#9ca3af',
        fontSize:12, padding:20, textAlign:'center', gap:8 }}>
        <span style={{ fontSize:32 }}>𝄽</span>
        <span>Select a note or measure<br/>to see its properties</span>
      </div>
    )
  }

  if (selectedMeasureIndex !== null && !selectedNoteId) {
    const m = selPart?.measures[selectedMeasureIndex]
    const noteCount = m?.notes.filter(n => !n.isRest && !n.chordWith).length ?? 0
    const totalBeats = m?.timeSignature?.beats ?? 4
    const usedBeats  = m?.notes.filter(n => !n.isRest && !n.chordWith)
      .reduce((s, n) => s + (DURATION_BEATS[n.duration+(n.dots?'d':'')]||DURATION_BEATS[n.duration]||1), 0) ?? 0
    return (
      <div style={{ overflowY:'auto', flex:1, padding:'8px 12px' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8 }}>
          Measure {selectedMeasureIndex + 1}
        </div>
        <PropRow label="Part"><Tag>{selPart?.name || '—'}</Tag></PropRow>
        <PropRow label="Time sig">
          <Tag>{m?.timeSignature.beats}/{m?.timeSignature.beatType}</Tag>
        </PropRow>
        <PropRow label="Key sig">
          <Tag>{m?.keySignature ?? 0} {(m?.keySignature ?? 0) > 0 ? '♯' : (m?.keySignature ?? 0) < 0 ? '♭' : '(C)'}</Tag>
        </PropRow>
        <PropRow label="Notes"><Tag>{noteCount}</Tag></PropRow>
        <PropRow label="Rests"><Tag>{(m?.notes.filter(n => n.isRest).length ?? 0)}</Tag></PropRow>
        <PropRow label="Beats used"><Tag color='#f0fdf4' text='#166534'>{usedBeats.toFixed(2)} / {totalBeats}</Tag></PropRow>
        {m?.barline && m.barline !== 'single' && (
          <PropRow label="Barline"><Tag color='#fef3c7' text='#92400e'>{m.barline}</Tag></PropRow>
        )}
      </div>
    )
  }

  if (!note) return null

  const DURATIONS = [
    {val:'w',label:'Whole',sym:'𝅝'},
    {val:'h',label:'Half',sym:'𝅗𝅥'},
    {val:'q',label:'Quarter',sym:'♩'},
    {val:'8',label:'8th',sym:'♪'},
    {val:'16',label:'16th',sym:'𝅘𝅥𝅰'},
    {val:'32',label:'32nd',sym:'𝅘𝅥𝅱'},
  ]

  const ARTICULATION_LABELS = {
    staccato: '· Staccato', tenuto: '— Tenuto', accent: '> Accent',
    marcato: '^ Marcato', fermata: '𝄐 Fermata', trill: 'tr Trill',
    mordent: '𝆁 Mordent', turn: '𝆃 Turn', portato: '—· Portato',
    staccatissimo: '▲ Staccatissimo', harmonic: '○ Harmonic',
    'snap-pizz': '⊙ Snap pizz',
  }

  const chordNotes = measure?.notes.filter(n => n.chordWith === selectedNoteId) || []

  return (
    <div style={{ overflowY:'auto', flex:1, padding:'8px 12px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10,
        padding:'6px 8px', borderRadius:6,
        background: note.isRest ? '#eff6ff' : '#fff7ed',
        border: `1.5px solid ${note.isRest ? '#bfdbfe' : '#fed7aa'}` }}>
        <span style={{ fontSize:22 }}>{note.isRest ? '𝄽' : '♩'}</span>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color: note.isRest ? '#1d4ed8':'#c2410c' }}>
            {note.isRest
              ? `${note.duration}${note.dots?'.':''} Rest`
              : `${note.pitch?.step}${note.pitch?.accidental??''}${note.pitch?.octave}`
            }
          </div>
          <div style={{ fontSize:10, color:'#6b7280' }}>
            {selPart?.name} · Bar {(selectedMeasureIndex ?? 0) + 1}
          </div>
        </div>
      </div>

      {!note.isRest && note.pitch && (
        <>
          <PropRow label="Pitch">
            <Tag color='#fff7ed' text='#c2410c'>
              {note.pitch.step}{note.pitch.accidental ?? ''}{note.pitch.octave}
            </Tag>
            <div style={{ display:'flex', gap:2 }}>
              <button onClick={() => shiftPitchHalfStep(1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:12 }}>↑</button>
              <button onClick={() => shiftPitchHalfStep(-1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:12 }}>↓</button>
            </div>
          </PropRow>
          <PropRow label="Octave">
            <Tag>{note.pitch.octave}</Tag>
            <div style={{ display:'flex', gap:2 }}>
              <button onClick={() => shiftPitchOctave(1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:10 }}>8↑</button>
              <button onClick={() => shiftPitchOctave(-1)}
                style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:3,
                  background:'white', cursor:'pointer', fontSize:10 }}>8↓</button>
            </div>
          </PropRow>
          <PropRow label="Accidental">
            <div style={{ display:'flex', gap:3 }}>
              {[{sym:'♯',acc:'#'},{sym:'♭',acc:'b'},{sym:'♮',acc:null}].map(a => (
                <button key={a.sym}
                  onClick={() => useScoreStore.getState()._applyToMeasure(
                    selectedPartId, selectedMeasureIndex, notes =>
                      notes.map(n => n.id === selectedNoteId
                        ? {...n, pitch:{...n.pitch, accidental: a.acc}} : n)
                  )}
                  style={{ width:26, height:26, border:'1px solid #d1d5db', borderRadius:4,
                    background: (note.pitch?.accidental??null)===a.acc ? '#eff6ff':'white',
                    cursor:'pointer', fontSize:14, fontWeight:700 }}>{a.sym}</button>
              ))}
            </div>
          </PropRow>
          {chordNotes.length > 0 && (
            <PropRow label="Chord">
              <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                {chordNotes.map(cn => (
                  <Tag key={cn.id} color='#f5f3ff' text='#7c3aed'>
                    {cn.pitch?.step}{cn.pitch?.accidental??''}{cn.pitch?.octave}
                  </Tag>
                ))}
              </div>
            </PropRow>
          )}
          {note.articulation && (
            <PropRow label="Articulation">
              <Tag color='#fef9c3' text='#713f12'>
                {ARTICULATION_LABELS[note.articulation] || note.articulation}
              </Tag>
              <button
                onClick={() => useScoreStore.getState()._applyToMeasure(
                  selectedPartId, selectedMeasureIndex, notes =>
                    notes.map(n => n.id === selectedNoteId ? { ...n, articulation: null } : n)
                )}
                style={{ fontSize:10, padding:'2px 6px', borderRadius:3, border:'1px solid #d1d5db',
                  background:'white', cursor:'pointer', color:'#6b7280' }}>remove</button>
            </PropRow>
          )}
          {note.tieStart && (
            <PropRow label="Tie"><Tag color='#f0fdf4' text='#166534'>→ Tied</Tag></PropRow>
          )}
          {note.slurStart && (
            <PropRow label="Slur"><Tag color='#faf5ff' text='#7c3aed'>Slur start</Tag></PropRow>
          )}
        </>
      )}

      <PropRow label="Duration">
        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
          {DURATIONS.map(d => (
            <button key={d.val}
              onClick={() => changeSelectedDuration(d.val, note.dots||0)}
              title={d.label}
              style={{ width:26, height:26, border:'1px solid #d1d5db', borderRadius:4,
                background: note.duration===d.val ? '#eff6ff':'white',
                cursor:'pointer', fontSize:14,
                outline: note.duration===d.val ? '1.5px solid #2563eb':'none' }}>{d.sym}</button>
          ))}
        </div>
      </PropRow>
      <PropRow label="Dotted">
        <button
          onClick={() => changeSelectedDuration(note.duration, note.dots ? 0 : 1)}
          style={{ padding:'2px 10px', borderRadius:4, border:'1px solid #d1d5db',
            background: note.dots ? '#eff6ff':'white', cursor:'pointer',
            fontSize:13, fontWeight:700 }}>
          {note.dots ? '· On' : '· Off'}
        </button>
      </PropRow>
      {note.triplet && (
        <PropRow label="Triplet"><Tag color='#ccfbf1' text='#0d9488'>3-let</Tag></PropRow>
      )}
      <PropRow label="Voice">
        <div style={{ display:'flex', gap:3 }}>
          {[1,2,3,4].map(v => (
            <button key={v}
              onClick={() => useScoreStore.getState()._applyToMeasure(
                selectedPartId, selectedMeasureIndex, notes =>
                  notes.map(n => n.id === selectedNoteId ? { ...n, voice: v } : n)
              )}
              style={{ width:24, height:24, borderRadius:4,
                border:'1px solid #d1d5db',
                background: (note.voice ?? 1) === v ? '#dbeafe':'white',
                color: (note.voice ?? 1) === v ? '#1d4ed8':'#6b7280',
                cursor:'pointer', fontSize:11, fontWeight:700 }}>{v}</button>
          ))}
        </div>
      </PropRow>
    </div>
  )
}

// ── MAIN SIDEBAR COMPONENT ────────────────────────────────────────────────────
export default function Sidebar() {
  const [activeTab, setActiveTab] = useState('palettes')
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch]       = useState('')

  const TABS = [
    { id: 'palettes',   label: 'Palettes'   },
    { id: 'layout',     label: 'Layout'     },
    { id: 'properties', label: 'Properties' },
  ]

  if (collapsed) {
    return (
      <div style={{
        width: 28, background: '#f9fafb', borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 8, flexShrink: 0,
      }}>
        <button onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          style={{ width:22, height:22, border:'1px solid #d1d5db', borderRadius:4,
            background:'white', cursor:'pointer', fontSize:12, display:'flex',
            alignItems:'center', justifyContent:'center', color:'#6b7280' }}>
          ›
        </button>
      </div>
    )
  }

  return (
    <div style={{
      width: 220, flexShrink: 0, background: '#f9fafb',
      borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #e5e7eb',
        background: 'white', flexShrink: 0,
      }}>
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '7px 2px', fontSize: 11, fontWeight: 600,
              border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === tab.id ? '#2563eb' : '#6b7280',
              transition: 'color 0.15s',
            }}
          >{tab.label}</button>
        ))}
        <button onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          style={{ width:28, border:'none', background:'none', cursor:'pointer',
            color:'#9ca3af', fontSize:14, flexShrink:0 }}>‹</button>
      </div>

      {/* Search bar (Palettes tab only) */}
      {activeTab === 'palettes' && (
        <div style={{ padding:'6px 8px', background:'white',
          borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4,
            background:'#f3f4f6', borderRadius:6, padding:'4px 8px',
            border:'1px solid #e5e7eb' }}>
            <span style={{ color:'#9ca3af', fontSize:12 }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search palettes…"
              style={{ background:'none', border:'none', outline:'none',
                fontSize:11, color:'#374151', width:'100%' }}
            />
          </div>
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {activeTab === 'palettes'   && <PalettesTab />}
        {activeTab === 'layout'     && <LayoutTab />}
        {activeTab === 'properties' && <PropertiesTab />}
      </div>
    </div>
  )
}