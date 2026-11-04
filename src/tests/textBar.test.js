// node src/tests/textBar.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.crypto ??= (await import('node:crypto')).webcrypto
const { useSolfaStore, buildEmptySolfaScore, migrateMeasure, isTextBar } = await import('../store/solfaStore.js')

const fresh = (n = 4) => {
  const sc = buildEmptySolfaScore('satb', 'C', 4, n)
  sc.navigationMarkers = [{ id: 'a', type: 'segno', atMeasure: 2, label: 's' }]
  sc.instrumentalMeasures = [3]
  sc.marks = [{ id: 'k', partId: sc.parts[0].id, measureIdx: 3, beatIdx: 0, value: 'f', kind: 'text' }]
  useSolfaStore.getState().loadScore(sc)
  useSolfaStore.setState({ _undoStack: [], _redoStack: [] })
}
const parts = () => useSolfaStore.getState().score.parts
const sc = () => useSolfaStore.getState().score

test('inserting a text bar adds ONE bar-shaped column to every voice', () => {
  fresh(4)
  const idx = useSolfaStore.getState().insertTextBar(1, 'Repeat 3 times')
  assert.equal(idx, 2)
  for (const p of parts()) {
    assert.equal(p.measures.length, 5)
    assert.equal(isTextBar(p.measures[2]), true)
    assert.equal(p.measures[2].text, 'Repeat 3 times')
    assert.deepEqual(p.measures[2].beats, [])
  }
  assert.equal(useSolfaStore.getState().selectedMeasureIdx, 2)
})
test('a text bar is never turned into beats by migration', () => {
  fresh(2)
  useSolfaStore.getState().insertTextBar(0, 'x')
  const m = migrateMeasure(parts()[0].measures[1])
  assert.equal(m.kind, 'text'); assert.equal(m.beats.length, 0)
})
test('inserting shifts every index-based reference after it', () => {
  fresh(4)
  useSolfaStore.getState().insertTextBar(1)          // new bar at index 2
  assert.equal(sc().navigationMarkers[0].atMeasure, 3)   // was 2
  assert.deepEqual(sc().instrumentalMeasures, [4])       // was 3
  assert.equal(sc().marks[0].measureIdx, 4)              // was 3
})
test('inserting AFTER the last bar leaves earlier references alone', () => {
  fresh(4)
  useSolfaStore.getState().insertTextBar(3)
  assert.equal(sc().navigationMarkers[0].atMeasure, 2)
  assert.deepEqual(sc().instrumentalMeasures, [3])
})
test('append when no bar is selected', () => {
  fresh(3)
  const idx = useSolfaStore.getState().insertTextBar(null, 'End')
  assert.equal(idx, 3); assert.equal(parts()[0].measures.length, 4)
})
test('editing text changes all voices together; typing is not an undo step, committing is', () => {
  fresh(3)
  useSolfaStore.getState().insertTextBar(0, 'a')
  useSolfaStore.setState({ _undoStack: [] })
  useSolfaStore.getState().setTextBar(1, { text: 'ab' }, false)
  useSolfaStore.getState().setTextBar(1, { text: 'abc' }, false)
  assert.equal(useSolfaStore.getState()._undoStack.length, 0)
  for (const p of parts()) assert.equal(p.measures[1].text, 'abc')
  useSolfaStore.getState().setTextBar(1, { wide: true })
  assert.equal(useSolfaStore.getState()._undoStack.length, 1)
  for (const p of parts()) assert.equal(p.measures[1].wide, true)
})
test('deleting a bar moves later references back and drops ones that pointed at it', () => {
  fresh(5)
  useSolfaStore.getState().deleteMeasure(0)
  assert.equal(sc().navigationMarkers[0].atMeasure, 1)
  fresh(5)
  useSolfaStore.getState().deleteMeasure(2)              // the segno was ON bar 2
  assert.equal(sc().navigationMarkers.length, 0)
})
test('undo removes the inserted bar and restores the indices', () => {
  fresh(4)
  useSolfaStore.getState().insertTextBar(1, 'x')
  useSolfaStore.getState().undo()
  assert.equal(parts()[0].measures.length, 4)
  assert.equal(sc().navigationMarkers[0].atMeasure, 2)
})
test('a text bar takes the meter of the bar before it, and a meter change flows through it', () => {
  fresh(4)
  useSolfaStore.getState().insertTextBar(1)
  assert.deepEqual(parts()[0].measures[2].timeSignature, parts()[0].measures[1].timeSignature)
  useSolfaStore.getState().changeTimeSigAt(1, 3, 4)
  assert.equal(parts()[0].measures[2].timeSignature.beats, 3)
  assert.equal(parts()[0].measures[2].beats.length, 0)   // still no beats
})
// ── navigation steps over instruction bars ─────────────────────────────────
test('navigateEvent skips text bars both ways', () => {
  const st = useSolfaStore.getState()
  st.loadScore(buildEmptySolfaScore('satb', 'C', 4, 3))
  st.insertTextBar(0, 'note') // bars: real, text, real, real
  const id = useSolfaStore.getState().score.parts[0].id
  useSolfaStore.getState().selectEvent(id, 0, 3, 0)
  useSolfaStore.getState().navigateEvent('right')
  assert.equal(useSolfaStore.getState().selectedMeasureIdx, 2)
  useSolfaStore.getState().navigateEvent('left')
  assert.equal(useSolfaStore.getState().selectedMeasureIdx, 0)
})