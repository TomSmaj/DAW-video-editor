const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const CLIPS_DIR = process.env.CLIPS_DIR || path.join(__dirname, '../media/clips');
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, '../media/music');
const THUMBNAILS_DIR = process.env.THUMBNAILS_DIR || path.join(__dirname, '../media/thumbnails');
const EXPORTS_DIR = process.env.EXPORTS_DIR || path.join(__dirname, '../media/exports');
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(__dirname, '../media/projects');

[CLIPS_DIR, MUSIC_DIR, THUMBNAILS_DIR, EXPORTS_DIR, PROJECTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.MOV', '.MP4'];
const AUDIO_EXTS = ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a'];

function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
}

function generateThumbnail(clipPath, thumbPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(clipPath)
      .screenshots({
        count: 1,
        timemarks: ['5%'],
        filename: path.basename(thumbPath),
        folder: path.dirname(thumbPath),
        size: '320x180',
      })
      .on('end', resolve)
      .on('error', reject);
  });
}

app.get('/api/clips', async (req, res) => {
  try {
    let files = [];
    try {
      files = fs.readdirSync(CLIPS_DIR).filter(f =>
        VIDEO_EXTS.some(ext => f.endsWith(ext))
      );
    } catch (e) {
      return res.json([]);
    }

    const clips = await Promise.all(files.map(async (filename) => {
      const id = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
      const clipPath = path.join(CLIPS_DIR, filename);
      const thumbName = `${id}.jpg`;
      const thumbPath = path.join(THUMBNAILS_DIR, thumbName);

      let duration = 0;
      let width = 1920;
      let height = 1080;
      try {
        const meta = await getVideoMetadata(clipPath);
        duration = meta.format.duration || 0;
        const vs = meta.streams.find(s => s.codec_type === 'video');
        if (vs) { width = vs.width; height = vs.height; }
      } catch (e) {}

      if (!fs.existsSync(thumbPath)) {
        try { await generateThumbnail(clipPath, thumbPath); } catch (e) {}
      }

      return {
        id,
        filename,
        duration,
        width,
        height,
        thumbnail: `/thumbnails/${thumbName}`,
        url: `/clips/${encodeURIComponent(filename)}`,
      };
    }));

    res.json(clips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/music', (req, res) => {
  try {
    let files = [];
    try {
      files = fs.readdirSync(MUSIC_DIR).filter(f =>
        AUDIO_EXTS.some(ext => f.endsWith(ext))
      );
    } catch (e) {}

    const music = files.map(filename => ({
      id: filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_'),
      filename,
      url: `/music/${encodeURIComponent(filename)}`,
    }));
    res.json(music);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Project CRUD ──────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    const projects = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8');
        const data = JSON.parse(raw);
        return { id: data.id, name: data.name, savedAt: data.savedAt };
      } catch { return null; }
    }).filter(Boolean);
    projects.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const { name, state } = req.body;
    if (!name || !state) return res.status(400).json({ error: 'name and state required' });
    const slug = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100);
    const id = slug || uuidv4();
    const project = { id, name, savedAt: new Date().toISOString(), state };
    fs.writeFileSync(path.join(PROJECTS_DIR, `${id}.json`), JSON.stringify(project, null, 2));
    res.json({ id, name, savedAt: project.savedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    if (!filePath.startsWith(PROJECTS_DIR)) return res.status(403).end();
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    if (!filePath.startsWith(PROJECTS_DIR)) return res.status(403).end();
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { name, state } = req.body;
    const updated = { ...existing, name: name ?? existing.name, state: state ?? existing.state, savedAt: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
    res.json({ id: updated.id, name: updated.name, savedAt: updated.savedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    if (!filePath.startsWith(PROJECTS_DIR)) return res.status(403).end();
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/clips', (req, res, next) => {
  const filename = decodeURIComponent(req.path.slice(1));
  const filePath = path.join(CLIPS_DIR, filename);
  if (!filePath.startsWith(CLIPS_DIR)) return res.status(403).end();
  res.sendFile(filePath);
});

app.use('/music', (req, res, next) => {
  const filename = decodeURIComponent(req.path.slice(1));
  const filePath = path.join(MUSIC_DIR, filename);
  if (!filePath.startsWith(MUSIC_DIR)) return res.status(403).end();
  res.sendFile(filePath);
});

app.use('/thumbnails', express.static(THUMBNAILS_DIR));
app.use('/exports', express.static(EXPORTS_DIR));

const TARGET_FPS = 30;
const TARGET_RATE = 44100;

function hasAudioStream(metadata) {
  return (metadata.streams || []).some((s) => s.codec_type === 'audio');
}

// fluent-ffmpeg's capability check rejects any input using -f lavfi: it parses
// `ffmpeg -formats`, where lavfi prints with a third "device" flag column its regex
// can't read. ffmpeg handles lavfi fine, so shell out directly for these two.
async function runFfmpeg(args) {
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim().split('\n').slice(-4).join(' ');
    throw new Error(`ffmpeg failed: ${detail}`);
  }
}

const COMMON_OUT = [
  '-c:v', 'libx264',
  '-c:a', 'aac',
  '-r', String(TARGET_FPS),
  '-ar', String(TARGET_RATE),
  '-ac', '2',
  '-pix_fmt', 'yuv420p',
  '-preset', 'fast',
  '-crf', '23',
];

// Every segment must share codec params so the concat demuxer can stream-copy them
function renderClipSegment(clipPath, segPath, startTime, duration, w, h, withAudio) {
  const filters = [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
  ].join(',');

  return runFfmpeg([
    '-i', clipPath,
    // Sources without an audio track get silence, so all segments match
    ...(withAudio ? [] : ['-f', 'lavfi', '-i', `anullsrc=r=${TARGET_RATE}:cl=stereo`]),
    '-ss', String(startTime),
    '-t', String(duration),
    '-vf', filters,
    ...(withAudio ? [] : ['-map', '0:v:0', '-map', '1:a:0']),
    ...COMMON_OUT,
    segPath,
  ]);
}

// Black + silence filler so timeline gaps survive into the export
function renderGapSegment(segPath, duration, w, h) {
  return runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${TARGET_FPS}`,
    '-f', 'lavfi', '-i', `anullsrc=r=${TARGET_RATE}:cl=stereo`,
    '-t', String(duration),
    ...COMMON_OUT,
    segPath,
  ]);
}

// In-memory export jobs. Keyed by jobId; the client polls for progress.
const exportJobs = new Map();

function setProgress(jobId, pct) {
  const job = exportJobs.get(jobId);
  // Monotonic so a slow phase never appears to move backwards
  if (job) job.progress = Math.min(100, Math.max(job.progress, pct));
}

app.post('/api/export', (req, res) => {
  const { clips, musicFile, musicOffsetBeats, bpm } = req.body;

  if (!clips || clips.length === 0) {
    return res.status(400).json({ error: 'No clips provided' });
  }
  if (!bpm || bpm <= 0) {
    return res.status(400).json({ error: 'Invalid BPM' });
  }

  const jobId = uuidv4();
  exportJobs.set(jobId, { status: 'running', progress: 0, url: null, error: null, startedAt: Date.now() });
  res.json({ jobId });

  runExport(jobId, { clips, musicFile, musicOffsetBeats, bpm }).catch((err) => {
    const job = exportJobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = err.message;
    }
  });
});

app.get('/api/export/:jobId', (req, res) => {
  const job = exportJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Unknown export job' });

  // Linear extrapolation from elapsed time. Suppressed below 3% because the
  // first tick or two extrapolate to wildly inflated estimates.
  let etaSeconds = null;
  if (job.status === 'running' && job.progress >= 3) {
    const elapsed = (Date.now() - job.startedAt) / 1000;
    etaSeconds = Math.max(0, Math.round((elapsed * (100 - job.progress)) / job.progress));
  }

  res.json({ ...job, etaSeconds });
});

async function runExport(jobId, { clips, musicFile, musicOffsetBeats, bpm }) {
  const exportId = uuidv4();
  const tempDir = path.join(EXPORTS_DIR, exportId + '_tmp');
  const outputPath = path.join(EXPORTS_DIR, `${exportId}.mp4`);
  fs.mkdirSync(tempDir, { recursive: true });

  const beatsToSeconds = (beats) => beats * (60 / bpm);

  // Segment rendering and the music mix each re-encode the whole timeline, so they
  // cost roughly the same; concat is a stream copy and barely registers.
  const SEG_WEIGHT = musicFile ? 45 : 90;
  const CONCAT_WEIGHT = musicFile ? 5 : 10;
  const MIX_WEIGHT = musicFile ? 50 : 0;

  try {
    const sortedClips = [...clips].sort((a, b) => a.startBeat - b.startBeat);

    // Normalize every segment to the first clip's dimensions
    let targetW = 1920;
    let targetH = 1080;
    try {
      const meta = await getVideoMetadata(path.join(CLIPS_DIR, sortedClips[0].filename));
      const vs = (meta.streams || []).find((s) => s.codec_type === 'video');
      if (vs && vs.width && vs.height) {
        targetW = vs.width - (vs.width % 2);
        targetH = vs.height - (vs.height % 2);
      }
    } catch (e) { /* keep 1080p default */ }

    // Plan the whole timeline first so total output duration is known up front,
    // which is what makes segment progress a real fraction rather than a guess
    const plan = [];
    let cursorBeat = 0;
    for (const clip of sortedClips) {
      const gapBeats = clip.startBeat - cursorBeat;
      if (gapBeats > 0.001) {
        plan.push({ kind: 'gap', seconds: beatsToSeconds(gapBeats) });
      }
      plan.push({ kind: 'clip', clip, seconds: beatsToSeconds(clip.durationBeats) });
      // max() so an overlapping clip never rewinds the cursor
      cursorBeat = Math.max(cursorBeat, clip.startBeat + clip.durationBeats);
    }

    const totalSeconds = plan.reduce((sum, step) => sum + step.seconds, 0) || 1;

    const segmentPaths = [];
    let doneSeconds = 0;

    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const segPath = path.join(tempDir, `seg_${i}${step.kind === 'gap' ? '_gap' : ''}.mp4`);

      if (step.kind === 'gap') {
        await renderGapSegment(segPath, step.seconds, targetW, targetH);
      } else {
        const clipPath = path.join(CLIPS_DIR, step.clip.filename);
        let withAudio = true;
        try {
          withAudio = hasAudioStream(await getVideoMetadata(clipPath));
        } catch (e) { withAudio = true; }
        await renderClipSegment(
          clipPath, segPath, step.clip.trimStart || 0,
          step.seconds, targetW, targetH, withAudio
        );
      }

      segmentPaths.push(segPath);
      doneSeconds += step.seconds;
      setProgress(jobId, (doneSeconds / totalSeconds) * SEG_WEIGHT);
    }

    // Concatenate
    const concatListPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatListPath, segmentPaths.map(p => `file '${p}'`).join('\n'));

    const concatPath = path.join(tempDir, 'concat.mp4');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .output(concatPath)
        .videoCodec('copy')
        .audioCodec('copy')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    setProgress(jobId, SEG_WEIGHT + CONCAT_WEIGHT);

    // Mix with music track
    if (musicFile) {
      const musicPath = path.join(MUSIC_DIR, musicFile);
      const offsetSec = beatsToSeconds(musicOffsetBeats || 0);
      await new Promise((resolve, reject) => {
        const cmd = ffmpeg().input(concatPath).input(musicPath);
        const maps = ['-map 0:v:0'];

        if (offsetSec > 0) {
          // Song starts partway into the timeline: delay it
          cmd.complexFilter([`[1:a]adelay=${Math.round(offsetSec * 1000)}:all=1[a]`]);
          maps.push('-map [a]');
        } else {
          // Song's t=0 sits at or before beat 0: skip into the file
          if (offsetSec < 0) cmd.seekInput(-offsetSec);
          maps.push('-map 1:a:0');
        }

        cmd
          .outputOptions([
            ...maps,
            '-shortest',
            '-preset fast',
            '-crf 23',
            '-movflags +faststart',
          ])
          .videoCodec('libx264')
          .audioCodec('aac')
          .output(outputPath)
          .on('progress', (p) => {
            if (typeof p.percent === 'number' && isFinite(p.percent)) {
              setProgress(jobId, SEG_WEIGHT + CONCAT_WEIGHT + (p.percent / 100) * MIX_WEIGHT);
            }
          })
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    } else {
      fs.copyFileSync(concatPath, outputPath);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });

    const job = exportJobs.get(jobId);
    if (job) {
      job.status = 'done';
      job.progress = 100;
      job.url = `/exports/${exportId}.mp4`;
    }
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  } finally {
    // Keep the record around long enough for the client to read the final state
    setTimeout(() => exportJobs.delete(jobId), 10 * 60 * 1000);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`  Clips:      ${CLIPS_DIR}`);
  console.log(`  Music:      ${MUSIC_DIR}`);
  console.log(`  Thumbnails: ${THUMBNAILS_DIR}`);
  console.log(`  Exports:    ${EXPORTS_DIR}`);
});
