import { useRef, useCallback, useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import './Timeline.css'

const TRACK_HEIGHT = 64
const RULER_HEIGHT = 28
const NUM_TRACKS = 5
const MIN_BEATS = 64    // never shorter than this
const BUFFER_BEATS = 32 // empty space kept after the last clip

export default function Timeline() {
  const {
    timelineClips, libraryClips,
    addTimelineClip, updateTimelineClip, removeTimelineClip,
    selectClip, selectedClipIds, setSelectedClipIds,
    timelineBeats, setTimelineBeats,
    bpm, beatDivision, snapToGrid, pixelsPerBeat,
    getGridUnitBeats, snapBeat,
    currentTime, isPlaying, setIsPlaying, setCurrentTime,
    selectedMusicFile,
    musicOffsetBeats, setMusicOffsetBeats,
  } = useStore()

  const scrollRef = useRef(null)
  const animRef = useRef(null)
  const playStartWall = useRef(0)
  const playStartTime = useRef(0)
  const audioRef = useRef(null)

  // Grow the timeline to fit all clips, rounded up to the next bar (4 beats)
  const lastClipEnd = timelineClips.reduce(
    (max, c) => Math.max(max, c.startBeat + c.durationBeats), 0
  )
  const autoBeats = Math.ceil(Math.max(MIN_BEATS, lastClipEnd + BUFFER_BEATS) / 4) * 4

  // Shortest the timeline may be dragged: never past the last clip, never below a bar
  const minBeats = Math.max(4, lastClipEnd)
  // A user-set length wins over the automatic one, but clips are never hidden
  const totalBeats = timelineBeats === null
    ? autoBeats
    : Math.max(minBeats, timelineBeats)

  const timelineWidth = totalBeats * pixelsPerBeat
  const gridUnit = getGridUnitBeats()

  // ── Ruler & grid ──────────────────────────────────────────────────────────
  const rulerBeats = []
  for (let b = 0; b <= totalBeats; b++) rulerBeats.push(b)

  const gridCells = []
  for (let b = 0; b < totalBeats; b += gridUnit) gridCells.push(b)

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const clientToTimeline = (clientX, clientY) => {
    const rect = scrollRef.current.getBoundingClientRect()
    const x = clientX - rect.left + scrollRef.current.scrollLeft
    const y = clientY - rect.top - RULER_HEIGHT
    return {
      beat: x / pixelsPerBeat,
      track: Math.max(0, Math.min(NUM_TRACKS - 1, Math.floor(y / TRACK_HEIGHT))),
    }
  }

  // Pixel coords inside the tracks area, independent of scroll position
  const clientToTracks = (clientX, clientY) => {
    const rect = scrollRef.current.getBoundingClientRect()
    return {
      x: clientX - rect.left + scrollRef.current.scrollLeft,
      y: clientY - rect.top + scrollRef.current.scrollTop - RULER_HEIGHT,
    }
  }

  // ── Timeline length handle ────────────────────────────────────────────────
  const [resizingEnd, setResizingEnd] = useState(false)

  const handleEndMouseDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setResizingEnd(true)

    const startX = e.clientX
    const origBeats = totalBeats

    const onMove = (ev) => {
      const s = useStore.getState()
      const gu = s.getGridUnitBeats()
      const raw = origBeats + (ev.clientX - startX) / pixelsPerBeat
      const snapped = s.snapToGrid ? Math.round(raw / gu) * gu : raw
      setTimelineBeats(Math.max(minBeats, snapped))
    }
    const onUp = () => {
      setResizingEnd(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Marquee selection ─────────────────────────────────────────────────────
  const [marquee, setMarquee] = useState(null)
  // Set when a marquee drag just ended, so the trailing click doesn't move the playhead
  const marqueeJustEnded = useRef(false)

  const handleTracksMouseDown = (e) => {
    // Clips handle their own drags
    if (e.button !== 0 || e.target.closest('.tl-clip')) return

    const origin = clientToTracks(e.clientX, e.clientY)
    let active = false

    const onMove = (ev) => {
      const p = clientToTracks(ev.clientX, ev.clientY)
      // Only begin once the pointer clearly moved, so plain clicks still scrub
      if (!active && Math.abs(p.x - origin.x) < 4 && Math.abs(p.y - origin.y) < 4) return
      active = true

      const rect = {
        x1: Math.min(origin.x, p.x), x2: Math.max(origin.x, p.x),
        y1: Math.min(origin.y, p.y), y2: Math.max(origin.y, p.y),
      }
      setMarquee(rect)

      const hits = useStore.getState().timelineClips.filter((c) => {
        const left = c.startBeat * pixelsPerBeat
        const right = left + c.durationBeats * pixelsPerBeat
        const top = c.track * TRACK_HEIGHT
        const bottom = top + TRACK_HEIGHT
        return left < rect.x2 && right > rect.x1 && top < rect.y2 && bottom > rect.y1
      })
      setSelectedClipIds(hits.map((c) => c.id))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (active) {
        marqueeJustEnded.current = true
        setMarquee(null)
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Drop from library ─────────────────────────────────────────────────────
  const [dropPos, setDropPos] = useState(null)

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const pos = clientToTimeline(e.clientX, e.clientY)
    setDropPos(pos)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const clipId = e.dataTransfer.getData('clipId')
    const lib = libraryClips.find((c) => c.id === clipId)
    if (!lib) return
    const pos = clientToTimeline(e.clientX, e.clientY)
    const startBeat = Math.max(0, snapBeat(pos.beat))
    addTimelineClip(lib, startBeat, pos.track)
    setDropPos(null)
  }

  // ── Clip interaction ──────────────────────────────────────────────────────
  // True while a drag is being held back by a collision in the destination
  const [moveBlocked, setMoveBlocked] = useState(false)

  const handleClipMouseDown = useCallback((e, clip, mode) => {
    e.preventDefault()
    e.stopPropagation()

    const st = useStore.getState()
    // Dragging a member of a multi-selection moves the whole group, so don't
    // collapse the selection down to this one clip
    const isGroupMove = mode === 'move' && st.selectedClipIds.length > 1
      && st.selectedClipIds.includes(clip.id)
    if (!isGroupMove) selectClip(clip.id)

    // Treat a single clip as a group of one so the move logic has one shape
    const origins = (isGroupMove
      ? st.timelineClips.filter((c) => st.selectedClipIds.includes(c.id))
      : [clip]
    ).map((c) => ({
      id: c.id, startBeat: c.startBeat, durationBeats: c.durationBeats, track: c.track,
    }))
    const movingIds = origins.map((o) => o.id)
    const minStart = Math.min(...origins.map((o) => o.startBeat))
    const minTrack = Math.min(...origins.map((o) => o.track))
    const maxTrack = Math.max(...origins.map((o) => o.track))

    const startX = e.clientX
    const startY = e.clientY
    const origStart = clip.startBeat
    const origDuration = clip.durationBeats
    const origEnd = origStart + origDuration

    // Beat offset within clip where mouse landed (for move)
    const timelineX = startX - scrollRef.current.getBoundingClientRect().left + scrollRef.current.scrollLeft
    const mouseAtBeat = timelineX / pixelsPerBeat
    const beatOffset = mouseAtBeat - origStart

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dBeats = dx / pixelsPerBeat
      const su = useStore.getState().snapToGrid
      const gu = useStore.getState().getGridUnitBeats()

      if (mode === 'move') {
        // The dragged clip drives snapping; the resulting delta applies to everyone
        const rawStart = origStart + dBeats
        const snappedStart = su ? Math.round(rawStart / gu) * gu : rawStart
        let dBeat = snappedStart - origStart
        if (minStart + dBeat < 0) dBeat = -minStart

        // Vertical delta in whole rows, clamped so no member leaves the track range
        let dTrack = Math.round((ev.clientY - startY) / TRACK_HEIGHT)
        dTrack = Math.max(-minTrack, Math.min(NUM_TRACKS - 1 - maxTrack, dTrack))

        const proposed = origins.map((o) => ({
          id: o.id,
          startBeat: o.startBeat + dBeat,
          durationBeats: o.durationBeats,
          track: o.track + dTrack,
        }))

        // Reject the move outright if any member would land on an occupied span.
        // Members can't collide with each other — this is a rigid translation.
        const others = useStore.getState().timelineClips.filter((c) => !movingIds.includes(c.id))
        const blocked = proposed.some((p) => others.some((o) => (
          o.track === p.track
          && p.startBeat < o.startBeat + o.durationBeats
          && p.startBeat + p.durationBeats > o.startBeat
        )))

        setMoveBlocked(blocked)
        // Hold the last valid position rather than jumping through the obstacle
        if (blocked) return

        proposed.forEach((p) => {
          updateTimelineClip(p.id, { startBeat: p.startBeat, track: p.track })
        })

      } else if (mode === 'resize-right') {
        const rawEnd = origEnd + dBeats
        const snappedEnd = su ? Math.round(rawEnd / gu) * gu : rawEnd
        const newDur = Math.max(gu, snappedEnd - origStart)
        updateTimelineClip(clip.id, { durationBeats: newDur })

      } else if (mode === 'resize-left') {
        const rawStart = origStart + dBeats
        const snappedStart = su ? Math.round(rawStart / gu) * gu : rawStart
        const newStart = Math.max(0, Math.min(origEnd - gu, snappedStart))
        const newDur = origEnd - newStart
        updateTimelineClip(clip.id, { startBeat: newStart, durationBeats: newDur })
      }
    }

    const onUp = () => {
      setMoveBlocked(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pixelsPerBeat, selectClip, updateTimelineClip])

  // ── Click on empty track — set cursor / deselect ──────────────────────────
  const handleTrackAreaClick = (e) => {
    if (e.target.closest('.tl-clip') || e.target.closest('.tl-waveform')) return
    // A marquee drag ends with a click; don't let it also scrub or clear the selection
    if (marqueeJustEnded.current) {
      marqueeJustEnded.current = false
      return
    }
    const pos = clientToTimeline(e.clientX, e.clientY)
    setCurrentTime(Math.max(0, pos.beat) * (60 / bpm))
    selectClip(null)
  }

  // Align the music element to the playhead, honouring the waveform offset.
  // Reads the store directly so a mid-playback offset drag takes effect immediately.
  const syncAudio = (t) => {
    const audio = audioRef.current
    if (!audio) return
    const st = useStore.getState()
    if (!st.selectedMusicFile) return
    const fileTime = t - st.beatsToSeconds(st.musicOffsetBeats)
    if (fileTime < 0 || (audio.duration && fileTime > audio.duration)) {
      if (!audio.paused) audio.pause()
      return
    }
    if (audio.paused) {
      audio.currentTime = fileTime
      audio.play().catch(() => {})
    } else if (Math.abs(audio.currentTime - fileTime) > 0.25) {
      audio.currentTime = fileTime
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  const startPlayback = () => {
    if (isPlaying) return
    setIsPlaying(true)
    playStartWall.current = performance.now()
    playStartTime.current = currentTime

    syncAudio(currentTime)

    const tick = () => {
      const elapsed = (performance.now() - playStartWall.current) / 1000
      const t = playStartTime.current + elapsed
      setCurrentTime(t)
      syncAudio(t)
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
  }

  const stopPlayback = (reset = false) => {
    setIsPlaying(false)
    cancelAnimationFrame(animRef.current)
    if (audioRef.current) {
      audioRef.current.pause()
      if (reset) audioRef.current.currentTime = 0
    }
    if (reset) setCurrentTime(0)
  }

  const togglePlay = () => {
    if (isPlaying) stopPlayback()
    else startPlayback()
  }

  useEffect(() => () => cancelAnimationFrame(animRef.current), [])

  // Update audio src when music file changes
  useEffect(() => {
    if (!audioRef.current) return
    if (selectedMusicFile) {
      audioRef.current.src = `/music/${encodeURIComponent(selectedMusicFile)}`
    } else {
      audioRef.current.src = ''
    }
  }, [selectedMusicFile])

  // Auto-scroll cursor into view
  useEffect(() => {
    if (!isPlaying || !scrollRef.current) return
    const cursorX = currentTime * (bpm / 60) * pixelsPerBeat
    const { scrollLeft, clientWidth } = scrollRef.current
    if (cursorX > scrollLeft + clientWidth - 80) {
      scrollRef.current.scrollLeft = cursorX - 80
    }
  }, [currentTime, isPlaying, bpm, pixelsPerBeat])

  // ── Export ────────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportEta, setExportEta] = useState(null)

  const handleExport = async () => {
    const state = useStore.getState()
    if (state.timelineClips.length === 0) return alert('No clips in timeline to export.')
    setExporting(true)
    setExportProgress(0)
    setExportEta(null)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: state.timelineClips,
          musicFile: state.selectedMusicFile,
          musicOffsetBeats: state.musicOffsetBeats,
          bpm: state.bpm,
        }),
      })
      const started = await res.json()
      if (!started.jobId) throw new Error(started.error || 'export did not start')

      // Poll the job until it finishes
      for (;;) {
        await new Promise((r) => setTimeout(r, 400))
        const job = await (await fetch(`/api/export/${started.jobId}`)).json()
        if (typeof job.progress === 'number') setExportProgress(job.progress)
        setExportEta(typeof job.etaSeconds === 'number' ? job.etaSeconds : null)

        if (job.status === 'done') {
          const a = document.createElement('a')
          a.href = job.url
          a.download = 'music-video.mp4'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          break
        }
        if (job.status === 'error') throw new Error(job.error || 'unknown error')
      }
    } catch (err) {
      alert('Export error: ' + err.message)
    }
    setExporting(false)
    setExportProgress(0)
    setExportEta(null)
  }

  const currentBeat = currentTime * (bpm / 60)
  const cursorLeft = currentBeat * pixelsPerBeat

  const formatEta = (secs) => {
    if (secs >= 60) {
      const m = Math.floor(secs / 60)
      return `${m}m ${String(secs % 60).padStart(2, '0')}s`
    }
    return `${secs}s`
  }

  const formatTime = (t) => {
    const m = Math.floor(t / 60)
    const s = (t % 60).toFixed(2).padStart(5, '0')
    return `${m}:${s}`
  }

  return (
    <div className="tl-wrapper">
      {/* Hidden audio element for music playback */}
      <audio ref={audioRef} preload="auto" />

      {/* Controls bar */}
      <div className="tl-controls">
        <button className="tl-btn" onClick={togglePlay} title="Play/Pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="tl-btn" onClick={() => stopPlayback(true)} title="Stop">⏹</button>

        <span className="tl-time">
          {formatTime(currentTime)} &nbsp;|&nbsp; Beat {currentBeat.toFixed(2)}
        </span>

        <span className="tl-spacer" />

        {exporting && (
          <div className="tl-export-progress">
            <div className="tl-export-bar" style={{ width: `${exportProgress}%` }} />
            <span className="tl-export-pct">{Math.round(exportProgress)}%</span>
          </div>
        )}
        {exporting && (
          <span className="tl-export-eta">
            {exportEta === null ? 'estimating…' : `~${formatEta(exportEta)} left`}
          </span>
        )}

        <button
          className="tl-btn tl-btn-export"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Rendering…' : '⬇ Render'}
        </button>
      </div>

      {/* Scrollable timeline area */}
      <div
        className="tl-scroll"
        ref={scrollRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={() => setDropPos(null)}
        onClick={handleTrackAreaClick}
      >
        <div className="tl-inner" style={{ width: timelineWidth }}>

          {/* Beat ruler */}
          <div className="tl-ruler">
            {rulerBeats.map((b) => {
              const isMeasure = b % 4 === 0
              const showLabel = b % (gridUnit <= 0.5 ? 2 : 4) === 0
              return (
                <div
                  key={b}
                  className={`tl-ruler-tick ${isMeasure ? 'tl-ruler-measure' : ''}`}
                  style={{ left: b * pixelsPerBeat }}
                >
                  {showLabel && <span>{b}</span>}
                </div>
              )
            })}
          </div>

          {/* Track area */}
          <div
            className="tl-tracks"
            style={{ height: TRACK_HEIGHT * NUM_TRACKS }}
            onMouseDown={handleTracksMouseDown}
          >
            {/* Grid cells (alternating shading) */}
            {gridCells.map((b, i) => (
              <div
                key={b}
                className={`tl-cell ${i % 2 === 0 ? 'tl-cell-even' : 'tl-cell-odd'} ${b % 4 === 0 ? 'tl-cell-bar' : ''}`}
                style={{ left: b * pixelsPerBeat, width: gridUnit * pixelsPerBeat }}
              />
            ))}

            {/* Track row backgrounds */}
            {Array.from({ length: NUM_TRACKS }, (_, t) => (
              <div
                key={t}
                className="tl-track-row"
                style={{ top: t * TRACK_HEIGHT, height: TRACK_HEIGHT }}
              />
            ))}

            {/* Bar lines */}
            {rulerBeats.filter((b) => b % 4 === 0).map((b) => (
              <div key={b} className="tl-bar-line" style={{ left: b * pixelsPerBeat }} />
            ))}

            {/* Timeline clips */}
            {timelineClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                pixelsPerBeat={pixelsPerBeat}
                trackHeight={TRACK_HEIGHT}
                isSelected={selectedClipIds.includes(clip.id)}
                isBlocked={moveBlocked && selectedClipIds.includes(clip.id)}
                onMouseDown={handleClipMouseDown}
                onDelete={removeTimelineClip}
              />
            ))}

            {/* Marquee selection box */}
            {marquee && (
              <div
                className="tl-marquee"
                style={{
                  left: marquee.x1,
                  top: marquee.y1,
                  width: marquee.x2 - marquee.x1,
                  height: marquee.y2 - marquee.y1,
                }}
              />
            )}

            {/* Drop ghost */}
            {dropPos && (
              <div
                className="tl-drop-ghost"
                style={{
                  left: Math.max(0, snapBeat(dropPos.beat)) * pixelsPerBeat,
                  top: dropPos.track * TRACK_HEIGHT,
                  height: TRACK_HEIGHT,
                }}
              />
            )}

            {/* Playback cursor */}
            <div
              className="tl-cursor"
              style={{ left: cursorLeft, height: TRACK_HEIGHT * NUM_TRACKS }}
            />
          </div>

          {/* Waveform track */}
          <WaveformTrack
            musicFile={selectedMusicFile}
            timelineWidth={timelineWidth}
            pixelsPerBeat={pixelsPerBeat}
            bpm={bpm}
            cursorLeft={cursorLeft}
            musicOffsetBeats={musicOffsetBeats}
            setMusicOffsetBeats={setMusicOffsetBeats}
          />

          {/* Drag the timeline end to lengthen or shorten the grid */}
          <div
            className={`tl-end-handle ${resizingEnd ? 'tl-end-handle-active' : ''}`}
            style={{ left: timelineWidth - 5 }}
            onMouseDown={handleEndMouseDown}
            title={`Timeline: ${totalBeats.toFixed(2)} beats (${(totalBeats / 4).toFixed(2)} bars) — drag to resize`}
          />
        </div>
      </div>
    </div>
  )
}

// ── Waveform track ─────────────────────────────────────────────────────────
const WAVEFORM_HEIGHT = 56

function WaveformTrack({
  musicFile, timelineWidth, pixelsPerBeat, bpm, cursorLeft,
  musicOffsetBeats, setMusicOffsetBeats,
}) {
  const canvasRef = useRef(null)
  const audioBufferRef = useRef(null)
  const lastMusicFileRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const draw = useCallback((audioBuffer, offsetBeats) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const data = audioBuffer.getChannelData(0)
    const rate = audioBuffer.sampleRate
    const pxPerSec = pixelsPerBeat * bpm / 60
    const secPerPx = 1 / pxPerSec
    const offsetPx = offsetBeats * pixelsPerBeat
    const from = Math.max(0, Math.floor(offsetPx))
    const to = Math.min(width, Math.ceil(offsetPx + audioBuffer.duration * pxPerSec))
    if (to <= from) return

    const mid = height / 2
    const amp = mid - 2

    // Faint tint marks where the song sits on the timeline
    ctx.fillStyle = 'rgba(74,144,217,0.07)'
    ctx.fillRect(from, 0, to - from, height)

    for (let px = from; px < to; px++) {
      const t = (px - offsetPx) * secPerPx
      let a = Math.floor(t * rate)
      let b = Math.floor((t + secPerPx) * rate)
      if (b <= a) b = a + 1
      if (a < 0) a = 0
      if (b > data.length) b = data.length
      let mn = 0, mx = 0
      for (let i = a; i < b; i++) {
        const v = data[i]
        if (v > mx) mx = v
        if (v < mn) mn = v
      }
      const yTop = mid - mx * amp
      const yBot = mid - mn * amp
      ctx.fillStyle = '#3a7ec0'
      ctx.fillRect(px, yTop, 1, Math.max(1, yBot - yTop))
    }
  }, [pixelsPerBeat, bpm])

  // Redraw on zoom / bpm / offset change using the cached buffer
  useEffect(() => {
    if (audioBufferRef.current && lastMusicFileRef.current === musicFile) {
      draw(audioBufferRef.current, musicOffsetBeats)
    }
  }, [pixelsPerBeat, bpm, timelineWidth, musicOffsetBeats, draw, musicFile])

  // Fetch + decode when the music file changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!musicFile) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
      audioBufferRef.current = null
      lastMusicFileRef.current = null
      return
    }
    if (lastMusicFileRef.current === musicFile && audioBufferRef.current) return

    let cancelled = false
    setLoading(true)
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    fetch(`/music/${encodeURIComponent(musicFile)}`)
      .then((r) => r.arrayBuffer())
      .then((buf) => ac.decodeAudioData(buf))
      .then((audioBuffer) => {
        if (cancelled) return
        audioBufferRef.current = audioBuffer
        lastMusicFileRef.current = musicFile
        setLoading(false)
        draw(audioBuffer, musicOffsetBeats)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
      .finally(() => ac.close().catch(() => {}))

    return () => { cancelled = true }
  }, [musicFile, draw])

  // Drag the waveform horizontally to set where the song starts
  const handleMouseDown = (e) => {
    const buffer = audioBufferRef.current
    if (!buffer) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)

    const startX = e.clientX
    const orig = musicOffsetBeats
    // Don't allow dragging so far left that the song ends before beat 0
    const minOffset = -buffer.duration * (bpm / 60)

    // Deliberately unsnapped: the downbeat is rarely a round number of beats into
    // the file, so the offset must be continuous to align an interior point to a beat
    const onMove = (ev) => {
      const raw = orig + (ev.clientX - startX) / pixelsPerBeat
      setMusicOffsetBeats(Math.max(minOffset, raw))
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="tl-waveform">
      <canvas
        ref={canvasRef}
        className={`tl-waveform-canvas ${dragging ? 'tl-waveform-dragging' : ''}`}
        width={timelineWidth}
        height={WAVEFORM_HEIGHT}
        onMouseDown={handleMouseDown}
      />
      {loading && <span className="tl-waveform-loading">Loading waveform…</span>}
      {!loading && musicFile && (
        <span className="tl-waveform-offset">
          start: beat {musicOffsetBeats.toFixed(2)} · drag to move
        </span>
      )}
      <div className="tl-cursor" style={{ left: cursorLeft, height: WAVEFORM_HEIGHT }} />
    </div>
  )
}

// ── Clip block ─────────────────────────────────────────────────────────────
function TimelineClipBlock({ clip, pixelsPerBeat, trackHeight, isSelected, isBlocked, onMouseDown, onDelete }) {
  const left = clip.startBeat * pixelsPerBeat
  const width = Math.max(2, clip.durationBeats * pixelsPerBeat)
  const top = clip.track * trackHeight

  return (
    <div
      className={`tl-clip ${isSelected ? 'tl-clip-sel' : ''} ${isBlocked ? 'tl-clip-blocked' : ''}`}
      style={{ left, width, top, height: trackHeight - 2 }}
      onMouseDown={(e) => onMouseDown(e, clip, 'move')}
    >
      {clip.thumbnail && (
        <img src={clip.thumbnail} className="tl-clip-thumb" alt="" draggable={false} />
      )}
      <div className="tl-clip-label">{clip.name}</div>

      {/* Resize handles */}
      <div
        className="tl-resize tl-resize-l"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, clip, 'resize-left') }}
      />
      <div
        className="tl-resize tl-resize-r"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, clip, 'resize-right') }}
      />

      {/* Delete button */}
      {isSelected && (
        <button
          className="tl-clip-del"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(clip.id) }}
          title="Remove clip"
        >×</button>
      )}
    </div>
  )
}
