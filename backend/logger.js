// Minimal file + console logger. One file per day (app-YYYY-MM-DD.log) in LOGS_DIR,
// each line a JSON object so logs can be grepped by hand or piped through jq.
const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, '../logs');
const LOG_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS, 10) || 14);

let fileLoggingOk = true;
try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (err) {
  fileLoggingOk = false;
  console.error(`[logger] cannot create ${LOGS_DIR}, logging to console only: ${err.message}`);
}

let currentDay = null;
let stream = null;

function streamForToday() {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== currentDay) {
    if (stream) stream.end();
    currentDay = day;
    stream = fs.createWriteStream(path.join(LOGS_DIR, `app-${day}.log`), { flags: 'a' });
    stream.on('error', (err) => {
      fileLoggingOk = false;
      console.error(`[logger] file logging disabled: ${err.message}`);
    });
    pruneOldLogs();
  }
  return stream;
}

function pruneOldLogs() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(LOGS_DIR)) {
      const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && Date.parse(m[1]) < cutoff) fs.unlinkSync(path.join(LOGS_DIR, f));
    }
  } catch (err) {
    console.error(`[logger] pruning old logs failed: ${err.message}`);
  }
}

// Errors don't JSON.stringify (their fields are non-enumerable), so flatten them
function serialize(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, ...value };
  }
  return value;
}

function write(level, msg, context) {
  if (LEVELS[level] < LOG_LEVEL) return;

  const entry = { time: new Date().toISOString(), level, msg };
  if (context) {
    for (const [k, v] of Object.entries(context)) entry[k] = serialize(v);
  }

  let line;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ time: entry.time, level, msg, note: 'context not serializable' });
  }

  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  if (fileLoggingOk) streamForToday().write(line + '\n');
}

// child() pins fields (e.g. jobId) onto every entry so one request/job can be traced
function makeLogger(bound = {}) {
  const withBound = (ctx) => ({ ...bound, ...ctx });
  return {
    debug: (msg, ctx) => write('debug', msg, withBound(ctx)),
    info: (msg, ctx) => write('info', msg, withBound(ctx)),
    warn: (msg, ctx) => write('warn', msg, withBound(ctx)),
    error: (msg, ctx) => write('error', msg, withBound(ctx)),
    child: (ctx) => makeLogger(withBound(ctx)),
  };
}

module.exports = makeLogger();
module.exports.LOGS_DIR = LOGS_DIR;
module.exports.LOG_LEVEL_NAME = Object.keys(LEVELS).find((k) => LEVELS[k] === LOG_LEVEL);
module.exports.RETENTION_DAYS = RETENTION_DAYS;
