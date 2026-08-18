// src/utils/pdfExport.js
//
// Turns an array of already-paginated, already-cropped SVG page elements
// (the same shape both exportScore.js's printScore() and exportSolfa.js's
// exportSolfaPDF() already build for the browser print dialog) into a real
// PDF Blob, entirely in the browser — no print dialog, no manual "save as
// PDF" step. This is what makes a one-click Publish button possible.
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

// pages: [{ svgElement, totalW, sliceHeight }]
//   svgElement  — a cloned <svg> with viewBox already set to the cropped region
//   totalW      — the SVG's full viewBox width (same units for every page)
//   sliceHeight — this page's viewBox height, in those same units
export async function buildPdfFromSvgPages({
  pages,
  pageWmm, pageHmm, marginTop, marginSide,
  title, subtitle,
  headerHeightMm = 0,
}) {
  if (!pages.length) throw new Error('Nothing to export yet — add some notes first.')

  const usableWmm = pageWmm - marginSide * 2
  const pdf = new jsPDF({ unit: 'mm', format: [pageWmm, pageHmm] })

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage([pageWmm, pageHmm])

    let y = marginTop
    if (i === 0 && (title || subtitle)) {
      pdf.setFont('times', 'bold')
      pdf.setFontSize(15)
      if (title) pdf.text(title, pageWmm / 2, y + 5, { align: 'center' })
      if (subtitle) {
        pdf.setFont('times', 'normal')
        pdf.setFontSize(9)
        pdf.text(subtitle, pageWmm - marginSide, y + 5, { align: 'right' })
      }
      y += headerHeightMm
    }

    const { svgElement, totalW, sliceHeight } = pages[i]
    const drawHmm = usableWmm * (sliceHeight / totalW)

    await svg2pdf(svgElement, pdf, { x: marginSide, y, width: usableWmm, height: drawHmm })
  }

  return pdf.output('blob')
}