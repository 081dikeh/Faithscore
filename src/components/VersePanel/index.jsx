// src/components/VersePanel/index.jsx
//
// The "Verses" controls shared by the Staff and Solfa sidebars. Both stores
// expose the same verse actions (see utils/lyricVerses.js for the model), so
// this one panel drives either app — pass that app's zustand hook as `useStore`.
//
// Per verse the user chooses:
//   • WHERE it prints   — under the notes (syllable by syllable) or as a text
//                         block below the score
//   • UNDER WHICH VOICES — automatic, or any combination of voices
//   • THE WORDS         — click under a note, or paste the whole verse and fill

import { useState } from 'react'
import { resolveVerses } from '../../utils/lyricVerses'

const S = {
  h: { fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' },
  hint: { fontSize: 10.5, color: '#9ca3af', lineHeight: 1.45 },
  btn: (on) => ({
    flex: 1, fontSize: 10.5, padding: '5px 4px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
    border: on ? '1px solid #2563eb' : '1px solid #e5e7eb',
    background: on ? '#eff6ff' : 'white', color: on ? '#1d4ed8' : '#6b7280',
  }),
}

function VerseCard({ verse, parts, partLabel, autoIds, autoHint, st }) {
  const { setVerseProps, removeVerse, fillVerseFromText, activeLyricVerse, setActiveLyricVerse } = st
  const [open, setOpen] = useState(verse.number === activeLyricVerse)
  const [fillText, setFillText] = useState('')
  const [fillTarget, setFillTarget] = useState('shown') // 'shown' | partId
  const isBelow = verse.placement === 'below'
  const isAuto = verse.voices === 'auto'
  const shownIds = isAuto ? autoIds : verse.voices
  const active = activeLyricVerse === verse.number

  const toggleVoice = (id) => {
    const cur = isAuto ? [...autoIds] : [...verse.voices]
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    setVerseProps(verse.number, { voices: next })
  }
  const doFill = () => {
    if (!fillText.trim()) return
    const ids = fillTarget === 'shown' ? shownIds : [fillTarget]
    if (ids.length) fillVerseFromText(ids, verse.number, fillText, 0)
  }

  return (
    <div style={{ marginBottom: 8, border: active ? '1px solid #93c5fd' : '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
      <div onClick={() => { setOpen(!open); if (!isBelow) setActiveLyricVerse(verse.number) }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: active ? '#eff6ff' : '#f9fafb', cursor: 'pointer' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1e2433', minWidth: 22 }}>{verse.tag}</span>
        <span style={{ flex: 1, fontSize: 11, color: '#6b7280' }}>
          {isBelow ? 'Below the score' : isAuto ? 'Under notes · auto voices' : `Under notes · ${shownIds.length} voice${shownIds.length === 1 ? '' : 's'}`}
        </span>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '8px 8px 10px' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={verse.tag} title="Number printed at the start of each line"
              onChange={(e) => setVerseProps(verse.number, { tag: e.target.value }, false)}
              style={{ width: 44, fontSize: 11, border: '1px solid #d1d5db', borderRadius: 5, padding: '4px 6px', textAlign: 'center' }} />
            <button onClick={() => setVerseProps(verse.number, { placement: 'inline' })} style={S.btn(!isBelow)}>Under notes</button>
            <button onClick={() => setVerseProps(verse.number, { placement: 'below' })} style={S.btn(isBelow)}>Below score</button>
          </div>

          {isBelow ? (
            <>
              <input value={verse.label} placeholder="Heading (e.g. Verse 4)"
                onChange={(e) => setVerseProps(verse.number, { label: e.target.value }, false)}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 5, padding: '5px 7px', marginBottom: 6 }} />
              <textarea value={verse.text} rows={5}
                placeholder="Type the verse as ordinary text, one line per line…"
                onChange={(e) => setVerseProps(verse.number, { text: e.target.value }, false)}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, border: '1px solid #e5e7eb', borderRadius: 5, padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }} />
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Show under</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button onClick={() => setVerseProps(verse.number, { voices: 'auto' })} style={S.btn(isAuto)}>Automatic</button>
                <button onClick={() => setVerseProps(verse.number, { voices: [...autoIds] })} style={S.btn(!isAuto)}>Choose voices</button>
              </div>
              {isAuto ? (
                <div style={{ ...S.hint, marginBottom: 8 }}>{autoHint}</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  {parts.map((p) => {
                    const on = verse.voices.includes(p.id)
                    return (
                      <button key={p.id} onClick={() => toggleVoice(p.id)}
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 14, cursor: 'pointer',
                          border: on ? '1px solid #2563eb' : '1px solid #e5e7eb', background: on ? '#2563eb' : 'white', color: on ? 'white' : '#6b7280' }}>
                        {partLabel(p)}
                      </button>
                    )
                  })}
                </div>
              )}

              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Type the whole verse</div>
              <textarea value={fillText} rows={3} onChange={(e) => setFillText(e.target.value)}
                placeholder={'Glo-ry to God in the high-est\n(hyphens split syllables, _ skips a note)'}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, border: '1px solid #e5e7eb', borderRadius: 5, padding: '6px 8px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                <select value={fillTarget} onChange={(e) => setFillTarget(e.target.value)}
                  style={{ flex: 1, minWidth: 0, fontSize: 11, border: '1px solid #d1d5db', borderRadius: 5, padding: '4px 5px' }}>
                  <option value="shown">Every voice showing it</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{partLabel(p)} only</option>)}
                </select>
                <button onClick={doFill} disabled={!fillText.trim()}
                  style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, border: 'none', cursor: fillText.trim() ? 'pointer' : 'not-allowed',
                    background: fillText.trim() ? '#2563eb' : '#e5e7eb', color: fillText.trim() ? 'white' : '#9ca3af' }}>
                  Fill notes
                </button>
              </div>
              <div style={{ ...S.hint, marginTop: 5 }}>
                Puts one syllable on each note from the first bar. Running it again replaces this verse.
              </div>
            </>
          )}

          {verse.number !== 1 && (
            <button onClick={() => { if (window.confirm(`Remove ${verse.tag} and everything typed for it?`)) removeVerse(verse.number) }}
              style={{ marginTop: 10, fontSize: 11, border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', padding: 0 }}>
              Remove this verse
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function VersePanel({ useStore, partLabel, autoVoiceIds, autoHint }) {
  const score = useStore((s) => s.score)
  const setVerseProps = useStore((s) => s.setVerseProps)
  const removeVerse = useStore((s) => s.removeVerse)
  const addVerse = useStore((s) => s.addVerse)
  const fillVerseFromText = useStore((s) => s.fillVerseFromText)
  const activeLyricVerse = useStore((s) => s.activeLyricVerse)
  const setActiveLyricVerse = useStore((s) => s.setActiveLyricVerse)
  const st = { setVerseProps, removeVerse, fillVerseFromText, activeLyricVerse, setActiveLyricVerse }

  const verses = resolveVerses(score)
  const inline = verses.filter((v) => v.placement === 'inline')
  const autoIds = autoVoiceIds(score)

  return (
    <div>
      <div style={S.h}>Verses</div>
      <div style={{ ...S.hint, marginBottom: 8 }}>
        Click under a note to type its syllable for the verse chosen below, or
        type a whole verse into its card and press <b>Fill notes</b>. A verse
        can sit under any voices, or print as text below the score.
      </div>

      {inline.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Typing into verse</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {inline.map((v) => (
              <button key={v.number} onClick={() => setActiveLyricVerse(v.number)}
                style={{ minWidth: 30, fontSize: 12, fontWeight: 700, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                  border: activeLyricVerse === v.number ? '1px solid #2563eb' : '1px solid #e5e7eb',
                  background: activeLyricVerse === v.number ? '#2563eb' : 'white',
                  color: activeLyricVerse === v.number ? 'white' : '#6b7280' }}>{v.tag}</button>
            ))}
          </div>
        </div>
      )}

      {verses.map((v) => (
        <VerseCard key={v.number} verse={v} parts={score.parts} partLabel={partLabel}
          autoIds={autoIds} autoHint={autoHint} st={st} />
      ))}

      <button onClick={() => addVerse()}
        style={{ width: '100%', fontSize: 11.5, fontWeight: 600, padding: '7px 0', borderRadius: 6,
          border: '1px dashed #93c5fd', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}>
        + Add verse
      </button>
    </div>
  )
}