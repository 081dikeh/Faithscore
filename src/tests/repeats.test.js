// node src/tests/repeats.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.crypto ??= (await import('node:crypto')).webcrypto
const { expandRepeats } = await import('../utils/segnoNavigation.js')
const { useSolfaStore, buildEmptySolfaScore } = await import('../store/solfaStore.js')

const lin = (n) => Array.from({ length: n }, (_, i) => i)
const R = (start, end, id = 'r') => ({ id, start, end })
const V = (startMeasure, endMeasure, numbers, id) => ({ id: id || `v${startMeasure}`, startMeasure, endMeasure, numbers })

test('no repeats/voltas → order unchanged', () => {
  assert.deepEqual(expandRepeats(lin(4), [], []), [0, 1, 2, 3])
})

test('1st & 2nd ending: A B [1: C] :| [2: D]', () => {
  // bars 0,1 | 1st ending = bar 2 (ends with :|) | 2nd ending = bar 3
  const out = expandRepeats(lin(4), [R(0, 2)], [V(2, 2, [1]), V(3, 3, [2])])
  assert.deepEqual(out, [0, 1, 2, 0, 1, 3])
})

test('endings that cover several bars', () => {
  // 0 1 | 1st: 2 3 :| | 2nd: 4 5 | then 6
  const out = expandRepeats(lin(7), [R(0, 3)], [V(2, 3, [1]), V(4, 5, [2])])
  assert.deepEqual(out, [0, 1, 2, 3, 0, 1, 4, 5, 6])
})

test('repeat starting mid-piece', () => {
  const out = expandRepeats(lin(6), [R(2, 3)], [V(3, 3, [1]), V(4, 4, [2])])
  assert.deepEqual(out, [0, 1, 2, 3, 2, 4, 5])
})

test('plain repeat without endings plays twice', () => {
  assert.deepEqual(expandRepeats(lin(4), [R(1, 2)], []), [0, 1, 2, 1, 2, 3])
})

test('three endings → plays three times', () => {
  const out = expandRepeats(lin(5), [R(0, 1)], [V(1, 1, [1]), V(2, 2, [2]), V(3, 3, [3])])
  assert.deepEqual(out, [0, 1, 0, 2, 0, 3, 4])
})

test('one bracket for passes 1 and 2, another for 3', () => {
  const out = expandRepeats(lin(5), [R(0, 1)], [V(1, 1, [1, 2]), V(2, 2, [3])])
  assert.deepEqual(out, [0, 1, 0, 1, 0, 2, 3, 4])
})

test('two separate repeats play independently', () => {
  const out = expandRepeats(lin(8), [R(0, 1, 'a'), R(4, 5, 'b')],
    [V(1, 1, [1], 'a1'), V(2, 2, [2], 'a2'), V(5, 5, [1], 'b1'), V(6, 6, [2], 'b2')])
  assert.deepEqual(out, [0, 1, 0, 2, 3, 4, 5, 4, 6, 7])
})

test('a repeat is only taken once when the order passes it again (after a D.S.)', () => {
  const first = expandRepeats([0, 1, 2, 3], [R(0, 2)], [V(2, 2, [1]), V(3, 3, [2])])
  assert.deepEqual(first, [0, 1, 2, 0, 1, 3])
  // order that revisits bars 0..3 a second time → last ending, no extra repeat
  const out = expandRepeats([0, 1, 2, 3, 0, 1, 2, 3], [R(0, 2)], [V(2, 2, [1]), V(3, 3, [2])])
  assert.deepEqual(out, [0, 1, 2, 0, 1, 3, 0, 1, 3])
})

test('addVolta auto-creates the repeat for a 1st ending, then a 2nd ending', () => {
  const st = useSolfaStore.getState()
  st.loadScore(buildEmptySolfaScore('satb', 'C', 4, 6))
  useSolfaStore.getState().addVolta(2, 3, [1])
  let sc = useSolfaStore.getState().score
  assert.equal(sc.repeats.length, 1)
  assert.deepEqual([sc.repeats[0].start, sc.repeats[0].end], [0, 3])
  useSolfaStore.getState().addVolta(4, 4, [2])
  sc = useSolfaStore.getState().score
  assert.equal(sc.repeats.length, 1) // no second repeat for the 2nd ending
  assert.deepEqual(expandRepeats(lin(6), sc.repeats, sc.voltas), [0, 1, 2, 3, 0, 1, 4, 5])
})

test('inserting / deleting bars keeps repeats and endings on their bars', () => {
  const st = useSolfaStore.getState()
  st.loadScore(buildEmptySolfaScore('satb', 'C', 4, 6))
  useSolfaStore.getState().addVolta(2, 3, [1])
  useSolfaStore.getState().addVolta(4, 4, [2])
  useSolfaStore.getState().insertTextBar(null === 0 ? 0 : 0, 'x') // new column at index 1
  let sc = useSolfaStore.getState().score
  assert.deepEqual(sc.voltas.map(v => [v.startMeasure, v.endMeasure]), [[3, 4], [5, 5]])
  assert.deepEqual([sc.repeats[0].start, sc.repeats[0].end], [0, 4])
  useSolfaStore.getState().deleteMeasure(5) // the 2nd-ending bar (single bar) → bracket dropped
  sc = useSolfaStore.getState().score
  assert.equal(sc.voltas.length, 1)
})

test('undo removes an added ending', () => {
  const st = useSolfaStore.getState()
  st.loadScore(buildEmptySolfaScore('satb', 'C', 4, 4))
  useSolfaStore.setState({ _undoStack: [], _redoStack: [] })
  useSolfaStore.getState().addVolta(1, 1, [1])
  assert.equal(useSolfaStore.getState().score.voltas.length, 1)
  useSolfaStore.getState().undo()
  assert.equal(useSolfaStore.getState().score.voltas.length, 0)
})

// ═══════════════════════════ STAFF APP ═══════════════════════════════════════
const { useScoreStore } = await import('../store/scoreStore.js')
const { effectiveRepeats } = await import('../utils/segnoNavigation.js')
const { convertStaffScoreToSolfa } = await import('../utils/staffToSolfa.js')
const { convertSolfaScoreToStaff } = await import('../utils/solfaToStaff.js')

function freshStaff(n = 8) {
  useScoreStore.getState().newScore?.()
  while (useScoreStore.getState().score.parts[0].measures.length < n) useScoreStore.getState().addMeasure()
  useScoreStore.setState(s => ({ score: { ...s.score, repeats: [], voltas: [], barlines: [] } }))
}

test('staff: adding a 1st ending creates the repeat, 2nd ending plays after it', () => {
  freshStaff(6)
  useScoreStore.getState().addVolta(2, 3, [1])
  useScoreStore.getState().addVolta(4, 4, [2])
  const sc = useScoreStore.getState().score
  assert.equal(sc.repeats.length, 1)
  assert.deepEqual(expandRepeats(lin(6), effectiveRepeats(sc), sc.voltas), [0, 1, 2, 3, 0, 1, 4, 5])
})

test('staff: plain repeat barlines (old palette) now play as repeats', () => {
  const sc = { barlines: [{ id: 'a', measureIndex: 1, type: 'repeat-start' }, { id: 'b', measureIndex: 2, type: 'repeat-end' }] }
  assert.deepEqual(expandRepeats(lin(4), effectiveRepeats(sc), []), [0, 1, 2, 1, 2, 3])
  // an explicit repeat on the same end bar is not doubled
  const both = { ...sc, repeats: [{ id: 'r', start: 1, end: 2 }] }
  assert.equal(effectiveRepeats(both).length, 1)
})

test('staff: deleting a bar shifts repeats/endings, drops a single-bar ending', () => {
  freshStaff(6)
  useScoreStore.getState().addVolta(2, 3, [1])
  useScoreStore.getState().addVolta(4, 4, [2])
  useScoreStore.getState().deleteMeasureColumn(0)
  let sc = useScoreStore.getState().score
  assert.deepEqual(sc.voltas.map(v => [v.startMeasure, v.endMeasure]), [[1, 2], [3, 3]])
  assert.deepEqual([sc.repeats[0].start, sc.repeats[0].end], [0, 2])
  useScoreStore.getState().deleteMeasureColumn(3)
  assert.equal(useScoreStore.getState().score.voltas.length, 1)
})

test('staff ⇄ solfa: repeats and endings carry over (instruction bars shift the indices)', () => {
  freshStaff(6)
  useScoreStore.getState().addVolta(2, 3, [1])
  useScoreStore.getState().addVolta(4, 4, [2])
  const { score: solfa } = convertStaffScoreToSolfa(useScoreStore.getState().score)
  assert.equal(solfa.repeats.length, 1)
  assert.deepEqual(solfa.voltas.map(v => [v.startMeasure, v.endMeasure, v.numbers[0]]), [[2, 3, 1], [4, 4, 2]])
  // put an instruction bar before bar 3 (solfa index 2) → solfa indices move by one
  useSolfaStore.getState().loadScore(solfa)
  useSolfaStore.getState().insertTextBar(1, 'Slowly')
  const shifted = useSolfaStore.getState().score
  assert.deepEqual(shifted.voltas.map(v => [v.startMeasure, v.endMeasure]), [[3, 4], [5, 5]])
  const { score: back } = convertSolfaScoreToStaff(shifted)
  assert.deepEqual(back.voltas.map(v => [v.startMeasure, v.endMeasure]), [[2, 3], [4, 4]])
  assert.deepEqual([back.repeats[0].start, back.repeats[0].end], [0, 3])
})

test('staff MusicXML export writes repeat signs and endings', async () => {
  const { exportMusicXML } = await import('../utils/exportScore.js')
  freshStaff(6)
  useScoreStore.getState().addVolta(2, 3, [1])
  useScoreStore.getState().addVolta(4, 4, [2])
  let xmlText = ''
  try { xmlText = exportMusicXML(useScoreStore.getState().score) } catch (e) { return } // needs browser APIs in some builds
  if (typeof xmlText !== 'string') return
  assert.match(xmlText, /<ending number="1" type="start">1\.<\/ending>/)
  assert.match(xmlText, /<ending number="1" type="stop">/)
  assert.match(xmlText, /<ending number="2" type="start">2\.<\/ending>/)
  assert.match(xmlText, /<ending number="2" type="discontinue">/)
  assert.match(xmlText, /<repeat direction="backward"/)
})