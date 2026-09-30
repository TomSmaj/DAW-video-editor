import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export const BEAT_DIVISIONS = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
}

const BASE_PIXELS_PER_BEAT = 80

const useStore = create((set, get) => ({
  // Library
  libraryClips: [],
  musicFiles: [],

  // Filenames of library clips the user has filed into the "In Use" folder. Purely
  // organisational: the files on disk are untouched. Saved with the project.
  inUseClipFilenames: [],

  // Project settings
  bpm: 120,
  beatDivision: 'quarter',
  snapToGrid: true,
  zoom: 1,

  // Derived
  pixelsPerBeat: BASE_PIXELS_PER_BEAT,

  // Timeline clips
  timelineClips: [],
  selectedClipIds: [],

  // User-set timeline length in beats; null means size automatically to the clips
  timelineBeats: null,

  // Music
  selectedMusicFile: null,

  // Timeline beat where the music file's t=0 sits; negative skips into the file
  musicOffsetBeats: 0,

  // Which page is showing: 'app' (the editor) or 'logs'
  view: 'app',

  // Playback
  isPlaying: false,
  currentTime: 0,

  // Actions — library
  setLibraryClips: (clips) => set({ libraryClips: clips }),
  setMusicFiles: (files) => set({ musicFiles: files }),

  moveClipToInUse: (filename) => {
    if (get().inUseClipFilenames.includes(filename)) return
    get().pushHistory()
    set((state) => ({ inUseClipFilenames: [...state.inUseClipFilenames, filename] }))
  },

  moveClipFromInUse: (filename) => {
    if (!get().inUseClipFilenames.includes(filename)) return
    get().pushHistory()
    set((state) => ({ inUseClipFilenames: state.inUseClipFilenames.filter((f) => f !== filename) }))
  },

  // Actions — project settings
  setBpm: (bpm) => set({ bpm: Math.max(20, Math.min(300, bpm)) }),
  setBeatDivision: (div) => set({ beatDivision: div }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setZoom: (zoom) => set({ zoom, pixelsPerBeat: BASE_PIXELS_PER_BEAT * zoom }),
  setSelectedMusicFile: (file) => set({ selectedMusicFile: file }),
  setMusicOffsetBeats: (beats) => set({ musicOffsetBeats: beats }),

  // Helpers
  beatsToSeconds: (beats) => beats * (60 / get().bpm),
  secondsToBeats: (seconds) => seconds * (get().bpm / 60),

  getGridUnitBeats: () => BEAT_DIVISIONS[get().beatDivision] ?? 1,

  snapBeat: (beat) => {
    const { snapToGrid, getGridUnitBeats } = get()
    if (!snapToGrid) return beat
    const unit = getGridUnitBeats()
    return Math.round(beat / unit) * unit
  },

  // Timeline clip actions
  addTimelineClip: (libraryClip, startBeat, track = 0) => {
    const { bpm, getGridUnitBeats } = get()
    const gridUnit = getGridUnitBeats()
    const durationBeats = libraryClip.duration * (bpm / 60)
    const snappedDuration = Math.max(gridUnit, Math.round(durationBeats / gridUnit) * gridUnit)

    const clip = {
      id: uuidv4(),
      clipId: libraryClip.id,
      filename: libraryClip.filename,
      url: libraryClip.url,
      thumbnail: libraryClip.thumbnail,
      name: libraryClip.filename,
      clipDuration: libraryClip.duration,
      startBeat,
      durationBeats: snappedDuration,
      trimStart: 0,
      track,
    }
    set((state) => ({ timelineClips: [...state.timelineClips, clip], selectedClipIds: [clip.id] }))
    return clip
  },

  updateTimelineClip: (id, updates) => {
    set((state) => ({
      timelineClips: state.timelineClips.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }))
  },

  removeTimelineClip: (id) => {
    set((state) => ({
      timelineClips: state.timelineClips.filter((c) => c.id !== id),
      selectedClipIds: state.selectedClipIds.filter((s) => s !== id),
    }))
  },

  selectClip: (id) => set({ selectedClipIds: id ? [id] : [] }),
  setSelectedClipIds: (ids) => set({ selectedClipIds: ids }),

  setTimelineBeats: (beats) => set({ timelineBeats: beats }),

  // ── Undo history ──────────────────────────────────────────────────────────
  // Snapshots of the document-ish state. View settings (zoom, grid division,
  // snap) and transport state are deliberately excluded — reverting those with
  // Ctrl+Z would be surprising.
  history: [],
  future: [],

  getUndoSnapshot: () => {
    const s = get()
    // Clip objects are replaced rather than mutated on edit, so holding the
    // array reference is enough; no deep clone needed.
    return {
      timelineClips: s.timelineClips,
      musicOffsetBeats: s.musicOffsetBeats,
      timelineBeats: s.timelineBeats,
      selectedMusicFile: s.selectedMusicFile,
      bpm: s.bpm,
      inUseClipFilenames: s.inUseClipFilenames,
    }
  },

  // Call once at the START of a discrete action, before mutating. Doing it at
  // interaction boundaries is what keeps a whole drag to a single undo step.
  pushHistory: () => {
    const snap = get().getUndoSnapshot()
    // A fresh edit invalidates whatever redo path existed
    set((state) => ({ history: [...state.history.slice(-49), snap], future: [] }))
  },

  undo: () => {
    const { history, future, selectedClipIds, getUndoSnapshot } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    const current = getUndoSnapshot()
    const liveIds = new Set(prev.timelineClips.map((c) => c.id))
    set({
      ...prev,
      history: history.slice(0, -1),
      future: [...future.slice(-49), current],
      // Drop anything from the selection that the restored state no longer has
      selectedClipIds: selectedClipIds.filter((id) => liveIds.has(id)),
    })
  },

  redo: () => {
    const { history, future, selectedClipIds, getUndoSnapshot } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    const current = getUndoSnapshot()
    const liveIds = new Set(next.timelineClips.map((c) => c.id))
    set({
      ...next,
      future: future.slice(0, -1),
      history: [...history.slice(-49), current],
      selectedClipIds: selectedClipIds.filter((id) => liveIds.has(id)),
    })
  },

  setView: (view) => set({ view }),

  // Playback
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),

  // Current project identity (null = unsaved)
  currentProjectId: null,
  currentProjectName: null,

  setCurrentProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),

  // Snapshot of saveable project state
  getProjectState: () => {
    const s = get()
    return {
      bpm: s.bpm,
      beatDivision: s.beatDivision,
      snapToGrid: s.snapToGrid,
      zoom: s.zoom,
      selectedMusicFile: s.selectedMusicFile,
      musicOffsetBeats: s.musicOffsetBeats,
      timelineBeats: s.timelineBeats,
      timelineClips: s.timelineClips,
      inUseClipFilenames: s.inUseClipFilenames,
    }
  },

  // Restore project state from a saved snapshot
  applyProjectState: (state) => {
    set({
      bpm: state.bpm ?? 120,
      beatDivision: state.beatDivision ?? 'quarter',
      snapToGrid: state.snapToGrid ?? true,
      zoom: state.zoom ?? 1,
      pixelsPerBeat: BASE_PIXELS_PER_BEAT * (state.zoom ?? 1),
      selectedMusicFile: state.selectedMusicFile ?? null,
      musicOffsetBeats: state.musicOffsetBeats ?? 0,
      timelineBeats: state.timelineBeats ?? null,
      // Loading a project is a fresh document, not an undoable edit
      history: [],
      future: [],
      timelineClips: state.timelineClips ?? [],
      inUseClipFilenames: state.inUseClipFilenames ?? [],
      selectedClipIds: [],
      currentTime: 0,
      isPlaying: false,
    })
  },
}))

export default useStore
