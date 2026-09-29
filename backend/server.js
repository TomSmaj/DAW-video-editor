const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const log = require('./logger');

const app = express();
app.use(cors());

// Request logging. Media streaming and the export progress poll are high-volume,
// so successful hits on those only show up at LOG_LEVEL=debug.
const QUIET_PATHS = /^\/(clips|music|thumbnails|exports)\/|^\/api\/export\/[^/]+$|^\/api\/logs$/;
app.use((req, res, next) => {
  const reqId = uuidv4().slice(0, 8);
  const started = process.hrtime.bigint();
  req.log = log.child({ reqId });
  res.setHeader('X-Request-Id', reqId);

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const ctx = { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms) };
    if (res.statusCode >= 500) req.log.error('request failed', ctx);
    else if (res.statusCode >= 400) req.log.warn('request rejected', ctx);
    // originalUrl, not req.path: routers mounted with app.use('/clips', ...) strip
    // their prefix from req.path, so it would never match
    else if (QUIET_PATHS.test(req.originalUrl.split('?')[0])) req.log.debug('request', ctx);
    else req.log.info('request', ctx);
  });
  next();
});

app.use(express.json({ limit: '10mb' }));

function sendServerError(req, res, err, msg = 'unhandled route error') {
  req.log.error(msg, { method: req.method, path: req.originalUrl, err });
  sendServerError(req, res, err);
}

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
      req.log.warn('cannot read clips directory', { dir: CLIPS_DIR, err: e });
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
      } catch (e) {
        req.log.warn('ffprobe failed for clip', { filename, err: e });
      }

      if (!fs.existsSync(thumbPath)) {
        try {
          await generateThumbnail(clipPath, thumbPath);
        } catch (e) {
          req.log.warn('thumbnail generation failed', { filename, err: e });
        }
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

    req.log.debug('listed clips', { count: clips.length });
    res.json(clips);
  } catch (err) {
    sendServerError(req, res, err);
  }
});

app.get('/api/music', (req, res) => {
  try {
    let files = [];
    try {
      files = fs.readdirSync(MUSIC_DIR).filter(f =>
        AUDIO_EXTS.some(ext => f.endsWith(ext))
      );
    } catch (e) {
      req.log.warn('cannot read music directory', { dir: MUSIC_DIR, err: e });
    }

    const music = files.map(filename => ({
      id: filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_'),
      filename,
      url: `/music/${encodeURIComponent(filename)}`,
    }));
    res.json(music);
  } catch (err) {
    sendServerError(req, res, err);
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
      } catch (e) {
        req.log.warn('skipping unreadable project file', { file: f, err: e });
        return null;
      }
    }).filter(Boolean);
    projects.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json(projects);
  } catch (err) {
    sendServerError(req, res, err);
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
    req.log.info('project saved', { id, name, clips: state.timelineClips?.length });
    res.json({ id, name, savedAt: project.savedAt });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    if (!filePath.startsWith(PROJECTS_DIR)) return res.status(403).end();
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    sendServerError(req, res, err);
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
    req.log.info('project updated', { id: updated.id, name: updated.name, clips: updated.state?.timelineClips?.length });
    res.json({ id: updated.id, name: updated.name, savedAt: updated.savedAt });
  } catch (err) {
    sendServerError(req, res, err);
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
    if (!filePath.startsWith(PROJECTS_DIR)) return res.status(403).end();
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(filePath);
    req.log.info('project deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    sendServerError(req, res, err);
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
    const stderr = (err.stderr || err.message || '').toString().trim();
    const detail = stderr.split('\n').slice(-4).join(' ');
    const wrapped = new Error(`ffmpeg failed: ${detail}`);
    wrapped.ffmpegArgs = args.join(' ');
    wrapped.ffmpegStderr = stderr.split('\n').slice(-30).join('\n');
    throw wrapped;
  }
}

// Export quality presets. maxHeight caps the output resolution (null = keep the
// source's); lower crf / slower preset trade render time for fidelity.
const QUALITY_PRESETS = {
  draft:    { maxHeight: 480,  crf: 30, preset: 'ultrafast', audioBitrate: '96k' },
  low:      { maxHeight: 720,  crf: 26, preset: 'veryfast',  audioBitrate: '128k' },
  standard: { maxHeight: null, crf: 23, preset: 'fast',      audioBitrate: '192k' },
  high:     { maxHeight: null, crf: 18, preset: 'slow',      audioBitrate: '256k' },
  max:      { maxHeight: null, crf: 14, preset: 'slower',    audioBitrate: '320k' },
};
const DEFAULT_QUALITY = 'standard';

function commonOut(q) {
  return [
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-b:a', q.audioBitrate,
    '-r', String(TARGET_FPS),
    '-ar', String(TARGET_RATE),
    '-ac', '2',
    '-pix_fmt', 'yuv420p',
    '-preset', q.preset,
    '-crf', String(q.crf),
  ];
}

// Every segment must share codec params so the concat demuxer can stream-copy them
function renderClipSegment(clipPath, segPath, startTime, duration, w, h, withAudio, q) {
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
    ...commonOut(q),
    segPath,
  ]);
}

// Black + silence filler so timeline gaps survive into the export
function renderGapSegment(segPath, duration, w, h, q) {
  return runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${TARGET_FPS}`,
    '-f', 'lavfi', '-i', `anullsrc=r=${TARGET_RATE}:cl=stereo`,
    '-t', String(duration),
    ...commonOut(q),
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
  const { clips, musicFile, musicOffsetBeats, bpm, quality = DEFAULT_QUALITY } = req.body;

  if (!clips || clips.length === 0) {
    return res.status(400).json({ error: 'No clips provided' });
  }
  if (!bpm || bpm <= 0) {
    return res.status(400).json({ error: 'Invalid BPM' });
  }
  if (!Object.hasOwn(QUALITY_PRESETS, quality)) {
    return res.status(400).json({ error: `Unknown quality: ${quality}` });
  }

  const jobId = uuidv4();
  exportJobs.set(jobId, { status: 'running', progress: 0, url: null, error: null, startedAt: Date.now() });
  res.json({ jobId });

  const jobLog = req.log.child({ jobId });
  jobLog.info('export started', {
    clips: clips.length, musicFile: musicFile || null, musicOffsetBeats, bpm, quality,
  });

  runExport(jobId, { clips, musicFile, musicOffsetBeats, bpm, quality }, jobLog).catch((err) => {
    const job = exportJobs.get(jobId);
    jobLog.error('export failed', {
      elapsedSec: job ? Math.round((Date.now() - job.startedAt) / 1000) : undefined,
      err,
      // Full timeline so the failure can be reproduced
      clips: clips.map((c) => ({
        filename: c.filename, startBeat: c.startBeat, durationBeats: c.durationBeats, trimStart: c.trimStart,
      })),
    });
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

async function runExport(jobId, { clips, musicFile, musicOffsetBeats, bpm, quality }, jobLog) {
  const q = QUALITY_PRESETS[quality];
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
    } catch (e) {
      jobLog.warn('could not probe first clip for dimensions, using 1080p', { filename: sortedClips[0].filename, err: e });
    }

    // Downscale to the preset's cap, preserving aspect ratio; x264 needs even dims
    if (q.maxHeight && targetH > q.maxHeight) {
      targetW = Math.round((targetW * q.maxHeight) / targetH);
      targetW -= targetW % 2;
      targetH = q.maxHeight;
    }

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
    jobLog.info('export planned', {
      segments: plan.length,
      gaps: plan.filter((s) => s.kind === 'gap').length,
      totalSeconds: +totalSeconds.toFixed(2),
      width: targetW, height: targetH, preset: q,
    });

    const segmentPaths = [];
    let doneSeconds = 0;

    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const segPath = path.join(tempDir, `seg_${i}${step.kind === 'gap' ? '_gap' : ''}.mp4`);
      const segStarted = Date.now();

      if (step.kind === 'gap') {
        await renderGapSegment(segPath, step.seconds, targetW, targetH, q);
      } else {
        const clipPath = path.join(CLIPS_DIR, step.clip.filename);
        let withAudio = true;
        try {
          withAudio = hasAudioStream(await getVideoMetadata(clipPath));
        } catch (e) {
          jobLog.warn('ffprobe failed, assuming clip has audio', { filename: step.clip.filename, err: e });
          withAudio = true;
        }
        try {
          await renderClipSegment(
            clipPath, segPath, step.clip.trimStart || 0,
            step.seconds, targetW, targetH, withAudio, q
          );
        } catch (err) {
          err.segment = { index: i, filename: step.clip.filename, trimStart: step.clip.trimStart || 0, seconds: step.seconds, withAudio };
          throw err;
        }
      }
      jobLog.debug('segment rendered', {
        index: i, kind: step.kind, filename: step.clip?.filename,
        seconds: +step.seconds.toFixed(3), renderMs: Date.now() - segStarted,
      });

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
        .on('start', (cmdline) => jobLog.debug('concat started', { cmdline }))
        .on('end', resolve)
        .on('error', (err, stdout, stderr) => {
          err.ffmpegStderr = tail(stderr);
          reject(err);
        })
        .run();
    });
    jobLog.debug('concat done');
    setProgress(jobId, SEG_WEIGHT + CONCAT_WEIGHT);

    // Mix with music track
    if (musicFile) {
      const musicPath = path.join(MUSIC_DIR, musicFile);
      const offsetSec = beatsToSeconds(musicOffsetBeats || 0);
      if (!fs.existsSync(musicPath)) jobLog.warn('music file missing', { musicPath });
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
            `-preset ${q.preset}`,
            `-crf ${q.crf}`,
            `-b:a ${q.audioBitrate}`,
            '-movflags +faststart',
          ])
          .videoCodec('libx264')
          .audioCodec('aac')
          .output(outputPath)
          .on('start', (cmdline) => jobLog.debug('music mix started', { cmdline, offsetSec }))
          .on('progress', (p) => {
            if (typeof p.percent === 'number' && isFinite(p.percent)) {
              setProgress(jobId, SEG_WEIGHT + CONCAT_WEIGHT + (p.percent / 100) * MIX_WEIGHT);
            }
          })
          .on('end', resolve)
          .on('error', (err, stdout, stderr) => {
            err.ffmpegStderr = tail(stderr);
            reject(err);
          })
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
      let sizeMB;
      try { sizeMB = +(fs.statSync(outputPath).size / 1048576).toFixed(1); } catch { /* size is informational */ }
      jobLog.info('export finished', {
        elapsedSec: Math.round((Date.now() - job.startedAt) / 1000), output: job.url, sizeMB,
      });
    }
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  } finally {
    // Keep the record around long enough for the client to read the final state
    setTimeout(() => exportJobs.delete(jobId), 10 * 60 * 1000);
  }
}

// ── Log viewer ────────────────────────────────────────────────────────────────

// One-line human summary of an entry's most useful context fields
function summarizeLogEntry(e) {
  const parts = [];
  if (e.method) parts.push(`${e.method} ${e.path} → ${e.status}${e.ms != null ? ` (${e.ms}ms)` : ''}`);
  if (e.filename) parts.push(e.filename);
  if (e.err && e.err.message) parts.push(e.err.message);
  if (e.jobId) parts.push(`job ${String(e.jobId).slice(0, 8)}`);
  return parts.join(' · ');
}

// Newest first, across the daily files, capped at `limit` entries
app.get('/api/logs', (req, res) => {
  const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit, 10) || 5000));
  try {
    const files = fs.readdirSync(log.LOGS_DIR)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .reverse();

    const entries = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(log.LOGS_DIR, f), 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        if (!lines[i]) continue;
        try {
          const e = JSON.parse(lines[i]);
          entries.push({ time: e.time, level: e.level, msg: e.msg, detail: summarizeLogEntry(e) });
        } catch {
          entries.push({ time: null, level: 'info', msg: lines[i], detail: '' });
        }
      }
      if (entries.length >= limit) break;
    }
    res.json({ entries, truncated: entries.length >= limit });
  } catch (err) {
    sendServerError(req, res, err, 'reading logs failed');
  }
});

// Errors reported by the browser (uncaught exceptions, failed renders, etc.)
const CLIENT_LEVELS = new Set(['info', 'warn', 'error']);
app.post('/api/client-log', (req, res) => {
  const { level, msg, context } = req.body || {};
  const lvl = CLIENT_LEVELS.has(level) ? level : 'error';
  req.log[lvl](`client: ${String(msg || 'no message').slice(0, 500)}`, {
    source: 'frontend',
    userAgent: req.get('user-agent'),
    context: JSON.stringify(context ?? null).slice(0, 5000),
  });
  res.status(204).end();
});

// Anything thrown synchronously from a route, or a malformed JSON body
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const logFn = status >= 500 ? req.log.error : req.log.warn;
  logFn('express error', { method: req.method, path: req.originalUrl, status, err });
  if (res.headersSent) return next(err);
  res.status(status).json({ error: err.message });
});

process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', { err: reason });
});
process.on('uncaughtException', (err) => {
  log.error('uncaught exception, exiting', { err });
  // Give the log stream a moment to flush before the container restarts us
  setTimeout(() => process.exit(1), 200);
});

function tail(text, lines = 30) {
  return (text || '').toString().trim().split('\n').slice(-lines).join('\n');
}

async function logStartupDiagnostics() {
  const dirs = { CLIPS_DIR, MUSIC_DIR, THUMBNAILS_DIR, EXPORTS_DIR, PROJECTS_DIR, LOGS_DIR: log.LOGS_DIR };
  const dirStatus = {};
  for (const [name, dir] of Object.entries(dirs)) {
    try {
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      dirStatus[name] = { path: dir, ok: true, entries: fs.readdirSync(dir).length };
    } catch (e) {
      dirStatus[name] = { path: dir, ok: false, error: e.code || e.message };
    }
  }

  let ffmpegVersion = null;
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    ffmpegVersion = stdout.split('\n')[0];
  } catch (e) {
    log.error('ffmpeg not available, exports and thumbnails will fail', { err: e });
  }

  log.info('backend started', {
    port: PORT,
    node: process.version,
    ffmpeg: ffmpegVersion,
    logLevel: log.LOG_LEVEL_NAME,
    logRetentionDays: log.RETENTION_DAYS,
    dirs: dirStatus,
  });
  for (const [name, s] of Object.entries(dirStatus)) {
    if (!s.ok) log.warn('directory not accessible', { name, ...s });
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  logStartupDiagnostics();
});
