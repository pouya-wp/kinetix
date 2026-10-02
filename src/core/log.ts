// Diagnostics log: every host error, uncaught exception and failed promise is kept in memory
// and appended to Documents/Kinetix/kinetix.log (inside AE) so problems can be traced.
import { nodeRequire } from './ae-bridge';

const lines: string[] = [];
let file: string | null = null;

function target(): string | null {
  if (file !== null) return file || null;
  const req = nodeRequire();
  file = '';
  if (!req) return null;
  try {
    const os = req('os'), path = req('path'), fs = req('fs');
    const dir = path.join(os.homedir(), 'Documents', 'Kinetix');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'kinetix.log');
    // keep the file small
    try { if (fs.statSync(file).size > 512 * 1024) fs.writeFileSync(file, ''); } catch { /* new file */ }
  } catch { file = ''; }
  return file || null;
}

export function log(level: 'info' | 'warn' | 'error', msg: string) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}`;
  lines.push(line);
  if (lines.length > 400) lines.shift();
  if (level === 'error') console.error(line); else console.log(line);
  const f = target();
  if (f) try { nodeRequire()!('fs').appendFileSync(f, line + '\n'); } catch { /* disk full / locked: memory copy remains */ }
}

export const logText = () => lines.join('\n');
export const logPath = () => target();

export function installGlobalHandlers() {
  window.addEventListener('error', (e) => log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => log('error', 'Unhandled: ' + (e.reason?.stack || e.reason?.message || String(e.reason))));
  log('info', `Kinetix started · ${navigator.userAgent}`);
}
