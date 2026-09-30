// Decoded audio for the selected song, shared by the waveform and the BPM
// detector so the file is only fetched and decoded once. Only the most recent
// song is kept: a decoded 5-minute stereo track is ~100 MB of float samples.
let cached = null // { filename, promise }

export function loadMusicBuffer(filename) {
  if (cached && cached.filename === filename) return cached.promise

  const promise = (async () => {
    const res = await fetch(`/music/${encodeURIComponent(filename)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${filename}`)
    const data = await res.arrayBuffer()
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    try {
      return await ac.decodeAudioData(data)
    } finally {
      ac.close().catch(() => {})
    }
  })()

  cached = { filename, promise }
  // A failed load shouldn't stick; the next caller retries
  promise.catch(() => { if (cached?.promise === promise) cached = null })
  return promise
}
