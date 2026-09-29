// Sends browser-side failures to the backend so they land in the server logs
// alongside the request/job that caused them. Never throws: logging must not
// break the UI.
export default function reportError(msg, context = {}, level = 'error') {
  try {
    const body = JSON.stringify({
      level,
      msg,
      context: { ...context, url: window.location.href },
    })
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch { /* ignore */ }
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (e) => {
    reportError(e.message || 'window error', {
      source: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack,
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    reportError('unhandled promise rejection: ' + (r?.message || String(r)), { stack: r?.stack })
  })
}
