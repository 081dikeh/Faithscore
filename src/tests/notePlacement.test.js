// Run with:  node --test src/tests/
// (Node's built-in runner — no extra dependency.)
import test from 'node:test'
import assert from 'node:assert/strict'

// The store reads localStorage on load; give plain Node a stub.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const {
  pitchFromStaffPos, staffPosFromPitch, staffPosFromY, yFromStaffPos, ledgerPositions,
  stemUpForPos, pickStaff, buildBeatAnchors, beatToX, xToBeat, gridStepFor, snapBeat,
} = await import('../utils/notePlacement.js')
const { useScoreStore, planPlacement, noteDuration, EMPTY_SCORE } = await import('../store/scoreStore.js')

const name = (p) => p.step + p.octave

// ── Coordinate mapping ───────────────────────────────────────────────────────
test('treble: every line and space from top line to bottom line', () => {
  const got = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => name(pitchFromStaffPos(p, 'treble')))
  assert.deepEqual(got, ['F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4'])
})
test('bass: every line and space', () => {
  const got = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => name(pitchFromStaffPos(p, 'bass')))
  assert.deepEqual(got, ['A3', 'G3', 'F3', 'E3', 'D3', 'C3', 'B2', 'A2', 'G2'])
})
test('ledger positions: above, below, and the space beyond the last ledger line', () => {
  assert.equal(name(pitchFromStaffPos(10, 'treble')), 'C4') // middle C
  assert.deepEqual(ledgerPositions(10), [10])
  assert.deepEqual(ledgerPositions(9), [])        // space just under the staff
  assert.deepEqual(ledgerPositions(11), [10])     // space under the first ledger line
  assert.deepEqual(ledgerPositions(12), [10, 12])
  assert.deepEqual(ledgerPositions(-2), [-2])
  assert.deepEqual(ledgerPositions(-3), [-2])
  assert.deepEqual(ledgerPositions(-4), [-2, -4])
  assert.deepEqual(ledgerPositions(4), [])
})
test('alto and tenor clefs resolve differently from treble', () => {
  assert.equal(name(pitchFromStaffPos(4, 'alto')), 'C4')  // middle line
  assert.equal(name(pitchFromStaffPos(4, 'tenor')), 'A3')
  assert.notEqual(name(pitchFromStaffPos(4, 'treble')), name(pitchFromStaffPos(4, 'bass')))
})
test('staff position <-> pitch round trip', () => {
  for (const clef of ['treble', 'bass', 'alto', 'tenor'])
    for (let p = -8; p <= 16; p++)
      assert.equal(staffPosFromPitch(pitchFromStaffPos(p, clef), clef), p)
})
test('Y snaps to the nearest line or space, at any staff size', () => {
  for (const ls of [10, 14, 20]) {
    const top = 100
    for (let p = -6; p <= 14; p++) {
      const y = yFromStaffPos(p, top, ls)
      assert.equal(staffPosFromY(y, top, ls), p)
      assert.equal(staffPosFromY(y + ls * 0.2, top, ls), p)   // just off-centre still snaps
      assert.equal(staffPosFromY(y - ls * 0.2, top, ls), p)
    }
  }
  // halfway between a line (G4, pos 6) and the space above it snaps to one of the two
  assert.ok([5, 6].includes(staffPosFromY(100 + 5.5 * 5, 100, 10)))
})
test('stems: up below the middle line, down on and above it', () => {
  assert.equal(stemUpForPos(8), true)
  assert.equal(stemUpForPos(5), true)
  assert.equal(stemUpForPos(4), false)
  assert.equal(stemUpForPos(0), false)
})
test('pickStaff chooses the NEAREST of two stacked staves', () => {
  const mk = (top) => ({ x: 0, width: 200, staveTopLineY: top, staveLineSpacing: 10 })
  const treble = mk(50), bass = mk(130)           // 40px apart, ledger zones overlap
  assert.equal(pickStaff([treble, bass], 100, 60), treble)
  assert.equal(pickStaff([treble, bass], 100, 140), bass)
  // staff centres are y=70 and y=150, so the dividing line is y=110
  assert.equal(pickStaff([treble, bass], 100, 108), treble)
  assert.equal(pickStaff([treble, bass], 100, 112), bass)
})
test('pickStaff ignores the pointer outside every staff and outside the bar', () => {
  const z = { x: 100, width: 200, staveTopLineY: 50, staveLineSpacing: 10 }
  assert.equal(pickStaff([z], 50, 70), null)       // left of the bar
  assert.equal(pickStaff([z], 150, 400), null)     // far below
})

// ── Beat <-> x ───────────────────────────────────────────────────────────────
test('beat/x map follows REAL note positions, not a straight line', () => {
  // 4/4 bar: note area 100..500 but the engraver put the beat-3 note at x=380
  const a = buildBeatAnchors(100, 500, 4, [{ beatStart: 0, x: 110 }, { beatStart: 2, x: 380 }])
  assert.equal(Math.round(beatToX(a, 2)), 380)
  assert.equal(Math.round(xToBeat(a, 380) * 100) / 100, 2)
  assert.equal(Math.round(beatToX(a, 0)), 110)
  assert.ok(xToBeat(a, 245) > 0.9 && xToBeat(a, 245) < 1.1) // midway between anchors -> beat 1
})
test('beat <-> x is invertible', () => {
  const a = buildBeatAnchors(100, 500, 4, [{ beatStart: 1, x: 200 }, { beatStart: 3, x: 420 }])
  for (const b of [0, 0.5, 1, 1.75, 3, 3.5, 3.9]) assert.ok(Math.abs(xToBeat(a, beatToX(a, b)) - b) < 1e-6)
})
test('grid follows the note value, capped at one beat', () => {
  assert.equal(gridStepFor('w'), 1); assert.equal(gridStepFor('h'), 1); assert.equal(gridStepFor('q'), 1)
  assert.equal(gridStepFor('8'), 0.5); assert.equal(gridStepFor('16'), 0.25); assert.equal(gridStepFor('32'), 0.125)
})
test('snapBeat: grid, bar end clamp, and magnetism to an existing note onset', () => {
  assert.equal(snapBeat(1.4, 1, 4), 1)
  assert.equal(snapBeat(1.6, 1, 4), 2)
  assert.equal(snapBeat(3.99, 1, 4), 3.875)  // never past the bar
  assert.equal(snapBeat(1.3, 0.25, 4, [1.5]), 1.5) // existing onset 0.2 away wins
  assert.equal(snapBeat(1.3, 0.25, 4), 1.25)
})

// ── Placement ────────────────────────────────────────────────────────────────
const bar = (notes, ts = { beats: 4, beatType: 4 }) => ({ id: 'm', timeSignature: ts, keySignature: 0, notes })
const R = (d, id, dots = 0) => ({ id, isRest: true, pitch: null, duration: d, dots })
const N = (d, id, step = 'C', dots = 0) => ({ id, isRest: false, pitch: { step, octave: 5, accidental: null }, duration: d, dots })
const startsOf = (m) => { let c = 0; return m.notes.filter((n) => !n.chordWith).map((n) => { const s = c; c += noteDuration(n); return { id: n.id, rest: n.isRest, start: s, beats: noteDuration(n) } }) }
const fresh = (notes, ts) => {
  const sc = JSON.parse(JSON.stringify(EMPTY_SCORE))
  sc.parts = [{ id: 'p', name: 'P', instrument: 'piano', clef: 'treble', measures: [bar(notes, ts)] }]
  useScoreStore.getState().loadScore(sc)
  useScoreStore.setState({ _undoStack: [], _redoStack: [] })
}
const measure = () => useScoreStore.getState().score.parts[0].measures[0]
const drop = (beat, d = 'q', dots = 0, pitch = { step: 'G', octave: 4, accidental: null }) =>
  useScoreStore.getState().dropNoteAtBeat('p', 0, pitch, d, dots, beat)

test('a note lands EXACTLY on the clicked beat (empty bar = one whole rest)', () => {
  fresh([R('w', 'r0')])
  const res = drop(2, 'q')
  assert.equal(res.ok, true)
  const s = startsOf(measure())
  const note = s.find((e) => !e.rest)
  assert.equal(note.start, 2); assert.equal(note.beats, 1)
  assert.equal(s.reduce((a, e) => a + e.beats, 0), 4)   // bar still exactly full
})
test('placing on beat 1 and on an off-beat eighth', () => {
  fresh([R('w', 'r0')]); drop(0, 'q')
  assert.equal(startsOf(measure()).find((e) => !e.rest).start, 0)
  fresh([R('w', 'r0')]); drop(1.5, '8')
  const n = startsOf(measure()).find((e) => !e.rest)
  assert.equal(n.start, 1.5); assert.equal(n.beats, 0.5)
})
test('later rests and notes are NOT moved or deleted', () => {
  // [rest 1][note 1][rest 1][note 1] — fill the first rest
  fresh([R('q', 'a'), N('q', 'n1'), R('q', 'b'), N('q', 'n2')])
  drop(0, 'q')
  const s = startsOf(measure())
  assert.equal(s.find((e) => e.id === 'n1').start, 1)
  assert.equal(s.find((e) => e.id === 'n2').start, 3)
  assert.equal(s.find((e) => e.id === 'b').start, 2)
  assert.equal(s.reduce((a, e) => a + e.beats, 0), 4)
})
test('too long for the rest -> shortened to the biggest value that fits', () => {
  fresh([N('h', 'n1'), N('q', 'n2'), R('q', 'r')])
  const res = drop(3, 'h')
  assert.equal(res.ok, true); assert.equal(res.clipped, true)
  const n = startsOf(measure()).find((e) => e.start === 3)
  assert.equal(n.beats, 1)
})
test('inside a sounding note is refused and changes nothing', () => {
  fresh([N('h', 'n1'), R('h', 'r')])
  const before = JSON.stringify(measure())
  const res = drop(1, 'q')
  assert.equal(res.ok, false); assert.equal(res.reason, 'occupied')
  assert.equal(JSON.stringify(measure()), before)
  assert.equal(useScoreStore.getState()._undoStack.length, 0)   // no undo entry for a refusal
})
test('on an existing note\'s beat the pitch JOINS it as a chord (never replaces it)', () => {
  fresh([N('q', 'n1', 'C'), R('h', 'r1'), R('q', 'r2')])
  const res = drop(0, 'q', 0, { step: 'E', octave: 5, accidental: null })
  assert.equal(res.kind, 'chord')
  const m = measure()
  assert.equal(m.notes.filter((n) => n.chordWith === 'n1').length, 1)
  assert.ok(m.notes.some((n) => n.id === 'n1' && n.pitch.step === 'C'))
})
test('outside the bar is refused', () => {
  fresh([R('w', 'r0')])
  assert.equal(drop(4, 'q').ok, false)
  assert.equal(drop(-1, 'q').ok, false)
})
test('compound meter 6/8 stays exactly full', () => {
  fresh([R('hd', 'r0')], { beats: 6, beatType: 8 })
  const res = drop(1.5, '8')
  assert.equal(res.ok, true)
  assert.ok(Math.abs(startsOf(measure()).reduce((a, e) => a + e.beats, 0) - 3) < 1e-6)
  assert.equal(startsOf(measure()).find((e) => !e.rest).start, 1.5)
})
test('one placement = one undo step; undo/redo restore exactly', () => {
  fresh([R('w', 'r0')])
  const original = JSON.stringify(measure())
  drop(1, 'q')
  assert.equal(useScoreStore.getState()._undoStack.length, 1)
  useScoreStore.getState().undo()
  assert.equal(JSON.stringify(measure()), original)
  useScoreStore.getState().redo()
  assert.equal(startsOf(measure()).find((e) => !e.rest).start, 1)
})
test('planPlacement is read-only (the ghost can call it freely)', () => {
  const m = bar([R('w', 'r0')])
  const snap = JSON.stringify(m)
  planPlacement(m, 2, 'q', 0)
  assert.equal(JSON.stringify(m), snap)
})

// ── Editing an existing note ────────────────────────────────────────────────
test('dragging a pitch changes ONLY the pitch (id, duration, position kept)', () => {
  fresh([R('q', 'a'), N('q', 'n1', 'B'), R('h', 'b')])
  const ok = useScoreStore.getState().setNotePitch('p', 0, 'n1', { step: 'D', octave: 6, accidental: null })
  assert.equal(ok, true)
  const n = measure().notes.find((x) => x.id === 'n1')
  assert.equal(name(n.pitch), 'D6'); assert.equal(n.duration, 'q')
  assert.equal(startsOf(measure()).find((e) => e.id === 'n1').start, 1)
  assert.equal(useScoreStore.getState()._undoStack.length, 1)
})
test('setting the same pitch is a no-op with no undo entry', () => {
  fresh([N('w', 'n1', 'B')])
  const ok = useScoreStore.getState().setNotePitch('p', 0, 'n1', { step: 'B', octave: 5, accidental: null })
  assert.equal(ok, false)
  assert.equal(useScoreStore.getState()._undoStack.length, 0)
})

// ── Moving a note to another bar (Alt-drag) ─────────────────────────────────
const freshTwoBars = (a, b) => {
  const sc = JSON.parse(JSON.stringify(EMPTY_SCORE))
  sc.parts = [{ id: 'p', name: 'P', instrument: 'piano', clef: 'treble', measures: [bar(a), { ...bar(b), id: 'm2' }] }]
  useScoreStore.getState().loadScore(sc)
  useScoreStore.setState({ _undoStack: [], _redoStack: [] })
}
const bars = () => useScoreStore.getState().score.parts[0].measures
test('moveNote: lands in the first rest that fits, leaves a rest behind, both bars stay full', () => {
  freshTwoBars([N('q', 'n1', 'G'), R('hd', 'r1')], [R('w', 'r2')])
  const res = useScoreStore.getState().moveNote('n1', 'p', 0, 'p', 1)
  assert.equal(res.ok, true)
  const [m1, m2] = bars()
  assert.ok(m1.notes.every((n) => n.isRest))
  assert.equal(startsOf(m1).reduce((a, e) => a + e.beats, 0), 4)
  assert.equal(startsOf(m2).reduce((a, e) => a + e.beats, 0), 4)
  const moved = startsOf(m2).find((e) => !e.rest)
  assert.equal(moved.start, 0); assert.equal(moved.beats, 1)
  assert.equal(useScoreStore.getState()._undoStack.length, 1)
  useScoreStore.getState().undo()
  assert.ok(bars()[0].notes.some((n) => n.id === 'n1'))
  assert.ok(bars()[1].notes.every((n) => n.isRest))
})
test('moveNote: a full target bar is refused and nothing changes', () => {
  freshTwoBars([N('q', 'n1', 'G'), R('hd', 'r1')], [N('w', 'x')])
  const before = JSON.stringify(bars())
  const res = useScoreStore.getState().moveNote('n1', 'p', 0, 'p', 1)
  assert.equal(res.ok, false); assert.equal(res.reason, 'no-room')
  assert.equal(JSON.stringify(bars()), before)
  assert.equal(useScoreStore.getState()._undoStack.length, 0)
})
test('moveNote: chord tones travel with the note', () => {
  freshTwoBars([N('q', 'n1', 'C'), { ...N('q', 'c1', 'E'), chordWith: 'n1' }, R('hd', 'r1')], [R('w', 'r2')])
  useScoreStore.getState().moveNote('n1', 'p', 0, 'p', 1)
  const m2 = bars()[1]
  const base = m2.notes.find((n) => !n.isRest && !n.chordWith)
  assert.equal(m2.notes.filter((n) => n.chordWith === base.id).length, 1)
  assert.equal(bars()[0].notes.filter((n) => n.chordWith).length, 0)
})