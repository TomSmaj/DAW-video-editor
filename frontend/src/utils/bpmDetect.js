import { guess } from 'web-audio-beat-detector'
import { loadMusicBuffer } from './musicBuffer'
import reportError from './reportError'

// filename -> { bpm, offset } for this session, so switching back to a song
// doesn't re-run the analysis
const results = new Map()

// Resolves to { bpm, offset }: offset is the time in seconds of the first beat
// in the file (always less than one beat period).
export async function detectBpm(filename) {
  if (results.has(filename)) return results.get(filename)

  const started = performance.now()
  try {
    const buffer = await loadMusicBuffer(filename)
    const { bpm, offset } = await guess(buffer)
    const result = { bpm, offset }
    results.set(filename, result)
    reportError('bpm detected', {
      file: filename, bpm, offsetSec: +offset.toFixed(3),
      songSec: +buffer.duration.toFixed(1), ms: Math.round(performance.now() - started),
    }, 'info')
    return result
  } catch (err) {
    reportError('bpm detection failed', { file: filename, error: err.message }, 'warn')
    throw err
  }
}
