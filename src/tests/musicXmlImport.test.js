import test from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from '@xmldom/xmldom'
import { strToU8, zipSync } from 'fflate'

globalThis.DOMParser = DOMParser

const { importMusicXML, importMusicXMLFile } = await import('../utils/exportScore.js')

const musicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" version="4.0">
  <work><work-title>Import test</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes>
      <divisions>1</divisions>
      <key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign></clef>
    </attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure></part>
</score-partwise>`

function assertImportedNote(result) {
  assert.ok(result.score)
  assert.equal(result.score.title, 'Import test')
  assert.equal(result.score.parts.length, 1)
  assert.equal(result.score.parts[0].measures[0].notes[0].pitch.step, 'C')
}

test('imports MusicXML with a default namespace', () => {
  assertImportedNote(importMusicXML(musicXml))
})

test('preserves backup-separated voices as separate staves', () => {
  const polyphonicXml = `<?xml version="1.0" encoding="UTF-8"?>
  <score-partwise>
    <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <backup><duration>4</duration></backup>
      <forward><duration>1</duration></forward>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type></note>
    </measure></part>
  </score-partwise>`

  const result = importMusicXML(polyphonicXml)
  assert.equal(result.score.parts.length, 2)
  assert.deepEqual(
    result.score.parts[0].measures[0].notes.filter(note => !note.isRest).map(note => note.pitch.step),
    ['C', 'D', 'E', 'F'],
  )

  const secondVoice = result.score.parts[1].measures[0].notes
  assert.equal(secondVoice[0].isRest, true)
  assert.deepEqual(
    secondVoice.filter(note => !note.isRest).map(note => note.pitch.step),
    ['G', 'A'],
  )
  assert.match(result.warnings.join(' '), /imported as separate staves/)
  assert.doesNotMatch(result.warnings.join(' '), /notes were skipped/)
})

test('imports compressed MXL files using the container rootfile', async () => {
  const container = `<?xml version="1.0" encoding="UTF-8"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="scores/main.musicxml"
        media-type="application/vnd.recordare.musicxml+xml" /></rootfiles>
    </container>`
  const archive = zipSync({
    'META-INF/container.xml': strToU8(container),
    'scores/main.musicxml': strToU8(musicXml),
  })
  const file = {
    name: 'score.mxl',
    arrayBuffer: async () => archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ),
  }

  assertImportedNote(await importMusicXMLFile(file))
})

test('reports an MXL archive without a container file', async () => {
  const archive = zipSync({ 'score.musicxml': strToU8(musicXml) })
  const file = {
    name: 'score.mxl',
    arrayBuffer: async () => archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ),
  }

  await assert.rejects(importMusicXMLFile(file), /missing META-INF\/container\.xml/)
})
