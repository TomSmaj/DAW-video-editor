import React, { useRef, useEffect, useState, useCallback } from 'react'
import useStore from '../../store/useStore'
import './ClipPreview.css'

export default function ClipPreview() {
  const {
    timelineClips, selectedClipId,
    updateTimelineClip,
    bpm, beatsToSeconds,
  } = useStore()

  const videoRef = useRef(null)
  const trimBarRef = useRef(null)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartTrimStart = useRef(0)
  const [, forceUpdate] = useState(0)

  const clip = timelineClips.find((c) => c.id === selectedClipId) ?? null

  // Load video when selected clip changes
  useEffect(() => {
    if (!videoRef.current || !clip) return
    videoRef.current.src = clip.url
    videoRef.current.currentTime = clip.trimStart
  }, [clip?.id, clip?.url])

  // Seek video when trimStart changes externally
  useEffect(() => {
    if (!videoRef.current || !clip) return
    if (Math.abs(videoRef.current.currentTime - clip.trimStart) > 0.05) {
      videoRef.current.currentTime = clip.trimStart
    }
  }, [clip?.trimStart])

  const usedDurationSec = clip ? beatsToSeconds(clip.durationBeats) : 0
  const trimEnd = clip ? clip.trimStart + usedDurationSec : 0

  // Compute trim window geometry
  const getTrimGeometry = useCallback(() => {
    if (!clip || !trimBarRef.current) return { left: 0, width: 0 }
    const barW = trimBarRef.current.clientWidth
    const left = (clip.trimStart / clip.clipDuration) * barW
    const width = (usedDurationSec / clip.clipDuration) * barW
    return { left: Math.max(0, left), width: Math.max(4, width) }
  }, [clip, usedDurationSec])

  const handleTrimMouseDown = (e) => {
    if (!clip) return
    e.preventDefault()
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartTrimStart.current = clip.trimStart
  }

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current || !clip || !trimBarRef.current) return
      const barW = trimBarRef.current.clientWidth
      const dx = e.clientX - dragStartX.current
      const dt = (dx / barW) * clip.clipDuration
      const newTrimStart = Math.max(0, Math.min(clip.clipDuration - usedDurationSec, dragStartTrimStart.current + dt))
      updateTimelineClip(clip.id, { trimStart: newTrimStart })
      if (videoRef.current) videoRef.current.currentTime = newTrimStart
      forceUpdate((n) => n + 1)
    }
    const onUp = () => { isDragging.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [clip, usedDurationSec, updateTimelineClip])

  const { left: trimLeft, width: trimWidth } = getTrimGeometry()

  return (
    <div className="clip-preview">
      <div className="panel-header">Clip Preview</div>

      {clip ? (
        <div className="clip-preview-body">
          <div className="clip-video-wrap">
            <video
              ref={videoRef}
              className="clip-video"
              controls
              preload="metadata"
            />
          </div>

          <div className="trim-section">
            <div className="trim-labels">
              <span className="trim-label-text">
                In: {clip.trimStart.toFixed(2)}s &nbsp;→&nbsp; Out: {trimEnd.toFixed(2)}s
                &nbsp;&nbsp;
                <span className="trim-hint">(drag block to adjust)</span>
              </span>
              <span className="trim-label-text dim">
                Duration in timeline: {usedDurationSec.toFixed(2)}s ({clip.durationBeats.toFixed(2)} beats)
              </span>
            </div>

            <div className="trim-bar" ref={trimBarRef}>
              <div
                className="trim-window"
                style={{ left: trimLeft, width: trimWidth }}
                onMouseDown={handleTrimMouseDown}
              >
                <div className="trim-handle trim-handle-left" />
                <div className="trim-handle trim-handle-right" />
              </div>
            </div>

            <div className="trim-bar-labels">
              <span>0s</span>
              <span>{clip.clipDuration?.toFixed(1)}s (full clip)</span>
            </div>
          </div>

          <div className="clip-info-row">
            <span className="clip-info-name">{clip.name}</span>
          </div>
        </div>
      ) : (
        <div className="clip-preview-empty">
          Select a clip in the timeline<br />to preview and trim
        </div>
      )}
    </div>
  )
}
