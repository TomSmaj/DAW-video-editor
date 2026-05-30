import React, { useRef, useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import './VideoPreview.css'

export default function VideoPreview() {
  const { timelineClips, currentTime, bpm, isPlaying } = useStore()
  const videoRef = useRef(null)
  const [activeClipId, setActiveClipId] = useState(null)

  const beatsPerSec = bpm / 60

  const getActiveClip = (t) => {
    const currentBeat = t * beatsPerSec
    return timelineClips.find((c) => {
      return currentBeat >= c.startBeat && currentBeat < c.startBeat + c.durationBeats
    }) ?? null
  }

  useEffect(() => {
    const activeClip = getActiveClip(currentTime)
    const newId = activeClip?.id ?? null

    if (newId !== activeClipId) {
      setActiveClipId(newId)
      if (videoRef.current && activeClip) {
        const currentBeat = currentTime * beatsPerSec
        const beatInClip = currentBeat - activeClip.startBeat
        const srcTime = activeClip.trimStart + beatInClip / beatsPerSec
        videoRef.current.src = activeClip.url
        videoRef.current.currentTime = Math.max(0, srcTime)
      }
    } else if (activeClip && videoRef.current) {
      const currentBeat = currentTime * beatsPerSec
      const beatInClip = currentBeat - activeClip.startBeat
      const srcTime = activeClip.trimStart + beatInClip / beatsPerSec
      if (Math.abs(videoRef.current.currentTime - srcTime) > 0.15) {
        videoRef.current.currentTime = Math.max(0, srcTime)
      }
    }
  }, [currentTime, bpm, timelineClips])

  const activeClip = timelineClips.find((c) => c.id === activeClipId)

  return (
    <div className="video-preview">
      <div className="panel-header">Timeline Preview</div>
      <div className="video-preview-body">
        {activeClip ? (
          <video
            ref={videoRef}
            className="preview-video"
            muted
            playsInline
          />
        ) : (
          <div className="preview-placeholder">
            <div className="preview-icon">▶</div>
            <div>Use playback controls<br />to preview the timeline</div>
          </div>
        )}
      </div>
    </div>
  )
}
