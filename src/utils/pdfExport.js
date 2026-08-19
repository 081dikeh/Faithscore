// src/utils/pdfExport.js
//
// Turns an array of already-paginated, already-cropped SVG page elements
// (the same shape both exportScore.js's printScore() and exportSolfa.js's
// exportSolfaPDF() already build for the browser print dialog) into a real
// PDF Blob, entirely in the browser — no print dialog, no manual "save as
// PDF" step. This is what makes a one-click Publish button possible.
import { jsPDF } from 'jspdf'
import { BRAVURA_WOFF2_BASE64, ACADEMICO_WOFF2_BASE64 } from './musicFontData'

// Target resolution for the rasterized pages, in DPI. 300 is standard print
// quality for line-art/engraving; going higher just inflates file size for
// no visible benefit and risks tripping a server's upload size limit.
const TARGET_DPI = 300
const MM_PER_INCH = 25.4
// JPEG at high quality is dramatically smaller than PNG for this kind of
// content (mostly white page, anti-aliased black lines/text) with no
// visible quality loss at 300dpi, and is what actually keeps multi-page
// exports under a typical server upload limit.
const JPEG_QUALITY = 0.92

// A self-contained @font-face block using the exact font bytes VexFlow
// itself embeds — see musicFontData.js for why this has to be self-embedded
// rather than relying on the font already being loaded into the page.
const FONT_FACE_STYLE = `
  <style>
    @font-face {
      font-family: 'Bravura';
      src: url(data:font/woff2;base64,${BRAVURA_WOFF2_BASE64}) format('woff2');
    }
    @font-face {
      font-family: 'Academico';
      src: url(data:font/woff2;base64,${ACADEMICO_WOFF2_BASE64}) format('woff2');
    }
  </style>
`

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
  const pdf = new jsPDF({ unit: 'mm', format: [pageWmm, pageHmm], compress: true })

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

    // Scale is computed from the actual mm size this page will be drawn at,
    // not a fixed multiplier on the SVG's own (fairly arbitrary) viewBox
    // pixel size — that keeps resolution sane and file size predictable
    // regardless of how VexFlow happened to lay the page out internally.
    const targetPxWidth = (usableWmm / MM_PER_INCH) * TARGET_DPI
    const scale = targetPxWidth / totalW

    const canvas = await rasterizeSvgPage(svgElement, totalW, sliceHeight, scale)
    const imgData = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    pdf.addImage(imgData, 'JPEG', marginSide, y, usableWmm, drawHmm)
  }

  return pdf.output('blob')
}

// Rasterizes one cropped VexFlow SVG page to a canvas.
//
// Why not svg2pdf.js or html2canvas (both tried first)? Both need to know
// about VexFlow's Bravura/Academico music font to draw the note glyphs,
// clefs, and key/time signatures — which are all just <text> elements in
// that font. But that font is loaded into the page at runtime via the CSS
// Font Loading API (document.fonts.add(new FontFace(...))), not a
// stylesheet @font-face rule, so:
//   - svg2pdf.js has no way to see it at all (it only knows fonts
//     explicitly registered with jsPDF), so it drew blank space for every
//     glyph — only pure vector shapes like staff lines and stems survived.
//   - html2canvas *tries* to detect fonts, but does so by scanning
//     document.styleSheets for @font-face rules — it doesn't see
//     JS-registered FontFace objects either, so it fell back to a font with
//     no glyphs at those code points, rendering the classic "tofu box"
//     placeholder squares instead of notes/clefs.
//
// The fix that actually works: self-embed the exact same font bytes as a
// real @font-face rule *inside* the SVG being rasterized (see
// FONT_FACE_STYLE above, sourced from musicFontData.js). A plain <img>
// loading that self-contained SVG as a data URL — the browser's native SVG
// decoder, the same one used for on-screen rendering — correctly parses and
// applies @font-face rules declared within the SVG document itself, with no
// dependency on anything already loaded into the host page.
async function rasterizeSvgPage(svgElement, totalW, sliceHeight, scale) {
  const clone = svgElement.cloneNode(true)
  clone.removeAttribute('style')
  clone.setAttribute('width', String(totalW))
  clone.setAttribute('height', String(sliceHeight))
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  // Insert the font-face style as the SVG's first child so it's guaranteed
  // to be parsed before any <text> element tries to use it.
  clone.insertAdjacentHTML('afterbegin', FONT_FACE_STYLE)

  const svgString = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)

  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Failed to rasterize page — the SVG could not be decoded as an image.'))
      el.src = svgUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(totalW * scale))
    canvas.height = Math.max(1, Math.round(sliceHeight * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}