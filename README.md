# Music Video Editor

A BPM-aware music video editor running in Docker. Sync video clip cuts precisely to the beat.

## Quick Start

### 1. Add your media

Either drop files into the project's `media/` folders:
```
media/clips/   ← your video clips (.mp4, .mov, .mkv, .webm, etc.)
media/music/   ← your music files (.mp3, .wav, .aac, .flac, etc.)
```

Or point Docker at your existing directories by creating a `.env` file:
```bash
cp .env.example .env
# Edit .env with your paths
```

### 2. Start the app

```bash
docker compose up --build
```

Open **http://localhost:3000** in your browser.

---

## UI Overview

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar: BPM · Grid Division · Snap · Zoom · Music     │
├──────────────┬──────────────────────┬───────────────────┤
│  Clip        │   Clip Preview       │  Timeline         │
│  Library     │   + Trim Editor      │  Preview          │
│              │                      │                   │
│  (drag clips │  (shows selected     │  (plays back      │
│   to the     │   timeline clip,     │   the timeline    │
│   timeline)  │   drag trim window   │   at current      │
│              │   to set in/out pts) │   position)       │
├──────────────┴──────────────────────┴───────────────────┤
│  ▶ ⏹  0:00.00 | Beat 0.00                    ⬇ Export  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  BPM grid timeline — drag clips here               │ │
│  │  [clip block][  clip block  ]  [clip]              │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Workflow

1. **Save / Load** — click "💾 Projects" in the toolbar to open the project manager. Name your project and save; reload it anytime from the list. Project files are stored in `media/projects/` as JSON.
2. **Set BPM** — enter the song's BPM in the toolbar
2. **Choose grid division** — Whole / Half / Quarter / Eighth / Sixteenth note
3. **Enable Snap to Grid** — clips snap to beat boundaries automatically
4. **Drag clips** from the library onto the timeline tracks
5. **Resize clips** — drag the left/right edges to align with beats
6. **Trim clip content** — select a clip in the timeline, then drag the blue trim window in the Clip Preview panel to choose which portion of the source clip plays (without moving the clip's position in the timeline)
7. **Select music** — pick a music file from the toolbar dropdown
8. **Export** — click ⬇ Export to render the final video with the music mixed in

## Development (without Docker)

```bash
# Terminal 1 — backend
cd backend && npm install && node server.js

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```

Frontend dev server: http://localhost:5173 (proxies API to port 3001)

## Supported formats

- **Video**: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`
- **Audio**: `.mp3`, `.wav`, `.aac`, `.flac`, `.ogg`, `.m4a`
