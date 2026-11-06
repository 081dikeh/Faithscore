import { useEffect, useMemo, useState } from 'react'

const buttonStyle = {
  fontSize: 10.5, fontWeight: 600, padding: '5px 7px', borderRadius: 5,
  border: '1px solid #e5e7eb', background: 'white', color: '#374151', cursor: 'pointer',
}
const selectStyle = {
  minWidth: 0, flex: 1, fontSize: 10.5, padding: '4px 5px',
  border: '1px solid #d1d5db', borderRadius: 5, background: 'white',
}

function parseEndingNumbers(value) {
  return [...new Set(value.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    .sort((a, b) => a - b)
}

function EndingNumbers({ volta, onChange }) {
  const [value, setValue] = useState((volta.numbers || []).join(', '))

  useEffect(() => {
    setValue((volta.numbers || []).join(', '))
  }, [volta.numbers])

  return (
    <input
      aria-label="Ending passes"
      title="Pass numbers, separated by commas"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const numbers = parseEndingNumbers(value)
        if (numbers.length) {
          setValue(numbers.join(', '))
          onChange(numbers)
        } else {
          setValue((volta.numbers || []).join(', '))
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      style={{ width: 66, boxSizing: 'border-box', fontSize: 10.5, padding: '4px 5px', border: '1px solid #d1d5db', borderRadius: 5 }}
    />
  )
}

export default function RepeatsPanel({ measures = [], repeats = [], voltas = [], range, actions }) {
  const columns = useMemo(() => measures.map((measure, index) => {
    const barNumber = measures.slice(0, index + 1).filter((item) => item?.kind !== 'text').length
    return {
      index,
      label: measure?.kind === 'text' ? `Instruction column ${index + 1}` : `Bar ${barNumber}`,
    }
  }), [measures])
  const selectedStart = range?.[0] ?? columns[0]?.index ?? 0
  const selectedEnd = range?.[1] ?? columns[columns.length - 1]?.index ?? selectedStart
  const [repeatStart, setRepeatStart] = useState(selectedStart)
  const [repeatEnd, setRepeatEnd] = useState(selectedEnd)
  const [voltaStart, setVoltaStart] = useState(selectedStart)
  const [voltaEnd, setVoltaEnd] = useState(selectedEnd)
  const [voltaNumbers, setVoltaNumbers] = useState('1')

  useEffect(() => {
    setRepeatStart(selectedStart)
    setRepeatEnd(selectedEnd)
    setVoltaStart(selectedStart)
    setVoltaEnd(selectedEnd)
  }, [selectedStart, selectedEnd])

  const measureLabel = (index) => columns.find((column) => column.index === index)?.label ?? `Column ${index + 1}`
  const measureSelect = (value, onChange, label) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(Number(event.target.value))} style={selectStyle}>
      {columns.map((column) => <option key={column.index} value={column.index}>{column.label}</option>)}
    </select>
  )
  const repeatActions = actions || {}
  const canAdd = columns.length > 0

  return (
    <section style={{ padding: '10px 10px 12px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#1e2433', marginBottom: 8 }}>Repeats & endings</div>

      <div style={{ fontSize: 10.5, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Repeat range</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {measureSelect(repeatStart, setRepeatStart, 'Repeat start')}
        <span aria-hidden="true" style={{ fontSize: 10, color: '#9ca3af' }}>to</span>
        {measureSelect(repeatEnd, setRepeatEnd, 'Repeat end')}
      </div>
      <button
        disabled={!canAdd}
        onClick={() => repeatActions.addRepeat?.(Math.min(repeatStart, repeatEnd), Math.max(repeatStart, repeatEnd))}
        style={{ ...buttonStyle, width: '100%', marginBottom: 8, opacity: canAdd ? 1 : 0.55, cursor: canAdd ? 'pointer' : 'not-allowed' }}
      >
        Add repeat
      </button>

      {repeats.map((repeat) => (
        <div key={repeat.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
          {measureSelect(repeat.start, (start) => repeatActions.updateRepeat?.(repeat.id, {
            start: Math.min(start, repeat.end), end: Math.max(start, repeat.end),
          }), 'Repeat start')}
          {measureSelect(repeat.end, (end) => repeatActions.updateRepeat?.(repeat.id, {
            start: Math.min(repeat.start, end), end: Math.max(repeat.start, end),
          }), 'Repeat end')}
          <button aria-label={`Remove repeat ${measureLabel(repeat.start)} to ${measureLabel(repeat.end)}`}
            onClick={() => repeatActions.removeRepeat?.(repeat.id)}
            style={{ ...buttonStyle, color: '#dc2626', padding: '3px 6px' }}>Remove</button>
        </div>
      ))}

      <div style={{ fontSize: 10.5, fontWeight: 600, color: '#374151', margin: '9px 0 4px' }}>Numbered ending</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {measureSelect(voltaStart, setVoltaStart, 'Ending start')}
        <span aria-hidden="true" style={{ fontSize: 10, color: '#9ca3af' }}>to</span>
        {measureSelect(voltaEnd, setVoltaEnd, 'Ending end')}
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
        <input aria-label="New ending passes" title="Pass numbers, separated by commas"
          value={voltaNumbers} onChange={(event) => setVoltaNumbers(event.target.value)}
          style={{ ...selectStyle, flex: '0 0 70px' }} />
        <button disabled={!canAdd}
          onClick={() => {
            const numbers = parseEndingNumbers(voltaNumbers)
            if (numbers.length) repeatActions.addVolta?.(Math.min(voltaStart, voltaEnd), Math.max(voltaStart, voltaEnd), numbers)
          }}
          style={{ ...buttonStyle, flex: 1, opacity: canAdd ? 1 : 0.55, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
          Add ending
        </button>
      </div>

      {voltas.map((volta) => (
        <div key={volta.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          <span style={{ fontSize: 10.5, color: '#4b5563' }}>Ending</span>
          <EndingNumbers volta={volta} onChange={(numbers) => repeatActions.updateVolta?.(volta.id, { numbers })} />
          {measureSelect(volta.startMeasure, (startMeasure) => repeatActions.updateVolta?.(volta.id, {
            startMeasure: Math.min(startMeasure, volta.endMeasure), endMeasure: Math.max(startMeasure, volta.endMeasure),
          }), 'Ending start')}
          {measureSelect(volta.endMeasure, (endMeasure) => repeatActions.updateVolta?.(volta.id, {
            startMeasure: Math.min(volta.startMeasure, endMeasure), endMeasure: Math.max(volta.startMeasure, endMeasure),
          }), 'Ending end')}
          <button aria-label={`Remove ending ${measureLabel(volta.startMeasure)} to ${measureLabel(volta.endMeasure)}`}
            onClick={() => repeatActions.removeVolta?.(volta.id)}
            style={{ ...buttonStyle, color: '#dc2626', padding: '3px 6px' }}>Remove</button>
        </div>
      ))}
    </section>
  )
}
