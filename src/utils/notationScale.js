export const STAFF_SPACE_MM = 1.75;
export const STAFF_LINE_THICKNESS_MM = 0.19;
export const VEXFLOW_STAFF_SPACE_PX = 10;

export const STAFF_LINE_WIDTH_PX =
  (STAFF_LINE_THICKNESS_MM / STAFF_SPACE_MM) * VEXFLOW_STAFF_SPACE_PX;

export function notationScaleForPage(renderWidthPx, usableWidthMm) {
  return (
    (STAFF_SPACE_MM * renderWidthPx) /
    (VEXFLOW_STAFF_SPACE_PX * usableWidthMm)
  );
}
