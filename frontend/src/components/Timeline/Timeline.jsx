import React, { useRef, useCallback, useEffect, useState } from 'react'
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
    selectClip, selectedClipId,
    bpm, beatDivision, snapToGrid, pixelsPerBeat,
    getGridUnitBeats, snapBeat,
    currentTime, isPlaying, setIsPlaying, setCurrentTime,
    selectedMusicFile,
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
  const totalBeats = Math.ceil(Math.max(MIN_BEATS, lastClipEnd + BUFFER_BEATS) / 4) * 4

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
  const handleClipMouseDown = useCallback((e, clip, mode) => {
    e.preventDefault()
    e.stopPropagation()
    selectClip(clip.id)

    const startX = e.clientX
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
        const rawStart = origStart + dBeats
        const newStart = Math.max(0, su ? Math.round(rawStart / gu) * gu : rawStart)
        updateTimelineClip(clip.id, { startBeat: newStart })

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
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pixelsPerBeat, selectClip, updateTimelineClip])

  // ── Click on empty track — set cursor / deselect ──────────────────────────
  const handleTrackAreaClick = (e) => {
    if (e.target.closest('.tl-clip')) return
    const pos = clientToTimeline(e.clientX, e.clientY)
    setCurrentTime(Math.max(0, pos.beat) * (60 / bpm))
    selectClip(null)
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  const startPlayback = () => {
    if (isPlaying) return
    setIsPlaying(true)
    playStartWall.current = performance.now()
    playStartTime.current = currentTime

    if (audioRef.current && selectedMusicFile) {
      audioRef.current.currentTime = currentTime
      audioRef.current.play().catch(() => {})
    }

    const tick = () => {
      const elapsed = (performance.now() - playStartWall.current) / 1000
      setCurrentTime(playStartTime.current + elapsed)
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
  const handleExport = async () => {
    const state = useStore.getState()
    if (state.timelineClips.length === 0) return alert('No clips in timeline to export.')
    setExporting(true)
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: state.timelineClips,
          musicFile: state.selectedMusicFile,
          bpm: state.bpm,
        }),
      })
      const data = await res.json()
      if (data.url) {
        const a = document.createElement('a')
        a.href = data.url
        a.download = 'music-video.mp4'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      } else {
        alert('Export failed: ' + (data.error || 'unknown error'))
      }
    } catch (err) {
      alert('Export error: ' + err.message)
    }
    setExporting(false)
  }

  const currentBeat = currentTime * (bpm / 60)
  const cursorLeft = currentBeat * pixelsPerBeat

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

        <button
          className="tl-btn tl-btn-export"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting…' : '⬇ Export'}
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
          <div className="tl-tracks" style={{ height: TRACK_HEIGHT * NUM_TRACKS }}>
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
                isSelected={clip.id === selectedClipId}
                onMouseDown={handleClipMouseDown}
                onDelete={removeTimelineClip}
              />
            ))}

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
        </div>
      </div>
    </div>
  )
}

// ── Clip block ─────────────────────────────────────────────────────────────
function TimelineClipBlock({ clip, pixelsPerBeat, trackHeight, isSelected, onMouseDown, onDelete }) {
  const left = clip.startBeat * pixelsPerBeat
  const width = Math.max(2, clip.durationBeats * pixelsPerBeat)
  const top = clip.track * trackHeight

  return (
    <div
      className={`tl-clip ${isSelected ? 'tl-clip-sel' : ''}`}
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
