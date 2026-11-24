// src/audio/useSoundStatus.js — React hook: is the instrument sound bank ready?
import { useEffect, useState } from 'react'
import { soundEngine } from './soundEngine'

export function useSoundStatus() {
  const [st, setSt] = useState({ status: soundEngine.status, info: soundEngine.statusInfo })
  useEffect(() => soundEngine.onStatus((status, info) => setSt({ status, info })), [])
  return st
}