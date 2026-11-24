import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STAFF_LINE_THICKNESS_MM,
  STAFF_LINE_WIDTH_PX,
  STAFF_SPACE_MM,
  VEXFLOW_STAFF_SPACE_PX,
  notationScaleForPage,
} from '../utils/notationScale.js'

test('notation scale produces the target staff-space regardless of editor width', () => {
  for (const renderWidthPx of [480, 720, 980, 1100]) {
    const usableWidthMm = 182
    const scale = notationScaleForPage(renderWidthPx, usableWidthMm)
    const renderedSpacePx = VEXFLOW_STAFF_SPACE_PX * scale

    assert.ok(
      Math.abs((renderedSpacePx * usableWidthMm) / renderWidthPx - STAFF_SPACE_MM) <
        1e-10,
    )
  }
})

test('staff-line thickness stays proportional to the calibrated staff-space', () => {
  const scale = notationScaleForPage(980, 182)
  const spaceMm = (VEXFLOW_STAFF_SPACE_PX * scale * 182) / 980
  const lineWidthMm = (STAFF_LINE_WIDTH_PX * scale * 182) / 980

  assert.ok(Math.abs(spaceMm - STAFF_SPACE_MM) < 1e-10)
  assert.ok(Math.abs(lineWidthMm - STAFF_LINE_THICKNESS_MM) < 1e-10)
})
