const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

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
    const id = uuidv4();
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

app.post('/api/export', async (req, res) => {
  const { clips, musicFile, bpm } = req.body;

  if (!clips || clips.length === 0) {
    return res.status(400).json({ error: 'No clips provided' });
  }
  if (!bpm || bpm <= 0) {
    return res.status(400).json({ error: 'Invalid BPM' });
  }

  const exportId = uuidv4();
  const tempDir = path.join(EXPORTS_DIR, exportId + '_tmp');
  const outputPath = path.join(EXPORTS_DIR, `${exportId}.mp4`);
  fs.mkdirSync(tempDir, { recursive: true });

  const beatsToSeconds = (beats) => beats * (60 / bpm);

  try {
    const sortedClips = [...clips].sort((a, b) => a.startBeat - b.startBeat);

    // Trim each clip segment
    const segmentPaths = [];
    for (let i = 0; i < sortedClips.length; i++) {
      const clip = sortedClips[i];
      const clipPath = path.join(CLIPS_DIR, clip.filename);
      const segPath = path.join(tempDir, `seg_${i}.mp4`);
      const duration = beatsToSeconds(clip.durationBeats);

      await new Promise((resolve, reject) => {
        ffmpeg(clipPath)
          .setStartTime(clip.trimStart || 0)
          .setDuration(duration)
          .output(segPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-preset fast', '-crf 23', '-movflags +faststart'])
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      segmentPaths.push(segPath);
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

    // Mix with music track
    if (musicFile) {
      const musicPath = path.join(MUSIC_DIR, musicFile);
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatPath)
          .input(musicPath)
          .outputOptions([
            '-map 0:v:0',
            '-map 1:a:0',
            '-shortest',
            '-preset fast',
            '-crf 23',
            '-movflags +faststart',
          ])
          .videoCodec('libx264')
          .audioCodec('aac')
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    } else {
      fs.copyFileSync(concatPath, outputPath);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });

    res.json({ success: true, exportId, url: `/exports/${exportId}.mp4` });
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`  Clips:      ${CLIPS_DIR}`);
  console.log(`  Music:      ${MUSIC_DIR}`);
  console.log(`  Thumbnails: ${THUMBNAILS_DIR}`);
  console.log(`  Exports:    ${EXPORTS_DIR}`);
});
