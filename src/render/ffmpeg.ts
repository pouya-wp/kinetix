// FFmpeg via CEP's Node.js: locate, (optionally) download, run with progress.

import { nodeRequire, extensionRoot } from '../core/ae-bridge';

const isWin = () => /win/i.test(navigator.platform);

export function bundledPath(): string | null {
  const root = extensionRoot();
  if (!root) return null;
  const req = nodeRequire();
  if (!req) return null;
  const path = req('path');
  return path.join(root, 'bin', 'ffmpeg', isWin() ? 'win' : 'mac', isWin() ? 'ffmpeg.exe' : 'ffmpeg');
}

/** Find a usable ffmpeg: user setting → bundled copy → PATH. */
export function findFFmpeg(userPath: string): string | null {
  const req = nodeRequire();
  if (!req) return null;
  const fs = req('fs');
  for (const p of [userPath, bundledPath()]) if (p && fs.existsSync(p)) return p;
  try {
    const cp = req('child_process');
    const out: string = cp.execSync(isWin() ? 'where ffmpeg' : 'command -v ffmpeg || ls /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg 2>/dev/null', { encoding: 'utf8', timeout: 4000 });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch { /* not on PATH */ }
  return null;
}

export const FFMPEG_SOURCE = isWin()
  ? { url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', label: 'gyan.dev ffmpeg-release-essentials.zip (~100 MB, GPL build with x264/x265)' }
  : { url: 'https://evermeet.cx/ffmpeg/getrelease/zip', label: 'evermeet.cx ffmpeg release zip (~25 MB, GPL build with x264/x265)' };

/** Download + unpack FFmpeg into bin/ffmpeg (only when the user clicks the button). */
export function downloadFFmpeg(onLog: (s: string) => void): Promise<string> {
  const req = nodeRequire();
  const dest = bundledPath();
  if (!req || !dest) return Promise.reject(new Error('Node.js is not available in this panel.'));
  const path = req('path'), fs = req('fs'), cp = req('child_process'), os = req('os');
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(os.tmpdir(), 'kinetix-ffmpeg-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const zip = path.join(tmp, 'ffmpeg.zip');
  return new Promise((resolve, reject) => {
    let cmd: string, args: string[];
    if (isWin()) {
      const ps = [
        `$ProgressPreference='SilentlyContinue'`,
        `Invoke-WebRequest -Uri '${FFMPEG_SOURCE.url}' -OutFile '${zip}'`,
        `Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force`,
        `$f = Get-ChildItem -Path '${tmp}' -Recurse -Filter ffmpeg.exe | Select-Object -First 1`,
        `Copy-Item $f.FullName '${dest}' -Force`,
        `Remove-Item '${tmp}' -Recurse -Force`,
      ].join('; ');
      cmd = 'powershell'; args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps];
    } else {
      cmd = '/bin/sh'; args = ['-c', `curl -L '${FFMPEG_SOURCE.url}' -o '${zip}' && unzip -o '${zip}' -d '${tmp}' && cp '${tmp}/ffmpeg' '${dest}' && chmod +x '${dest}' && rm -rf '${tmp}'`];
    }
    onLog('Downloading ' + FFMPEG_SOURCE.label + '…');
    const p = cp.spawn(cmd, args, { windowsHide: true });
    p.stderr.on('data', (d: Buffer) => onLog(String(d).trim()));
    p.on('close', (code: number) => (code === 0 && fs.existsSync(dest) ? resolve(dest) : reject(new Error('FFmpeg download failed (exit ' + code + ')'))));
  });
}

export interface Job { cancel(): void; done: Promise<void> }

/** Run ffmpeg, reporting progress (0..1) from its time= output. */
export function runFFmpeg(bin: string, args: string[], duration: number, onProgress: (p: number, line: string) => void): Job {
  const req = nodeRequire()!;
  const cp = req('child_process');
  const proc = cp.spawn(bin, args, { windowsHide: true });
  let tail = '';
  const done = new Promise<void>((resolve, reject) => {
    proc.stderr.on('data', (d: Buffer) => {
      const s = String(d);
      tail = (tail + s).slice(-4000);
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
      if (m) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / Math.max(0.01, duration)), s.trim().split(/\r|\n/).pop() ?? '');
    });
    proc.on('error', reject);
    proc.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error('FFmpeg failed (exit ' + code + '):\n' + tail.split(/\r?\n/).slice(-6).join('\n')))));
  });
  return { cancel: () => { try { proc.kill(); } catch { /* */ } }, done };
}
