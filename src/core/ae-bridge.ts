// Bridge between the panel and After Effects (ExtendScript in host/kinetix.jsx).
// In a normal browser (dev preview) calls are routed to a mock so the whole UI
// can be developed and tested without AE.

declare global {
  interface Window {
    __adobe_cep__?: { evalScript(script: string, cb: (res: string) => void): void; getSystemPath?(k: string): string };
    cep?: any;
    cep_node?: { require: NodeRequire };
  }
}

export const inAE = typeof window !== 'undefined' && !!window.__adobe_cep__;

type MockFn = (...args: any[]) => any;
const mocks: Record<string, MockFn> = {};
export function registerMock(name: string, fn: MockFn) { mocks[name] = fn; }

export class HostError extends Error {}

// set by core/log (kept as a hook to avoid an import cycle)
export let onHostError: (name: string, msg: string) => void = () => {};
export function setHostErrorHook(fn: (name: string, msg: string) => void) { onHostError = fn; }

/** Call a function exported by host/kinetix.jsx (KX.<name>). */
export function call<T = any>(name: string, ...args: any[]): Promise<T> {
  if (!inAE) {
    const m = mocks[name];
    return new Promise((res, rej) => setTimeout(() => {
      try { res(m ? m(...args) : (null as T)); } catch (e) { rej(e); }
    }, 60));
  }
  const payload = JSON.stringify(JSON.stringify(args));
  const script = `kx_call(${JSON.stringify(name)}, ${payload})`;
  return new Promise((res, rej) => {
    window.__adobe_cep__!.evalScript(script, (out: string) => {
      if (out === 'EvalScript error.' || out == null) { onHostError(name, 'EvalScript error'); return rej(new HostError(`Host call ${name} failed (EvalScript error). Is host/kinetix.jsx loaded?`)); }
      let parsed: any;
      try { parsed = JSON.parse(out); } catch { return rej(new HostError(`Bad host reply for ${name}: ${String(out).slice(0, 200)}`)); }
      if (parsed.ok) res(parsed.r as T);
      else { onHostError(name, parsed.err); rej(new HostError(parsed.err || 'Unknown host error')); }
    });
  });
}

// ───────── Node (CEP --enable-nodejs) ─────────
export function nodeRequire(): NodeRequire | null {
  try {
    if (window.cep_node?.require) return window.cep_node.require;
    const r = (window as any).require;
    return typeof r === 'function' ? r : null;
  } catch { return null; }
}
export const hasNode = () => !!nodeRequire();

/** Absolute path of the extension folder (only inside CEP). */
export function extensionRoot(): string | null {
  try {
    const p = window.__adobe_cep__?.getSystemPath?.('extension');
    if (!p) return null;
    return decodeURIComponent(p.replace(/^file:\/{2,3}/, '')).replace(/^\/([A-Za-z]:)/, '$1');
  } catch { return null; }
}

// ───────── dialogs ─────────
export function chooseSaveFile(title: string, defName: string, ext: string): string | null {
  if (!window.cep?.fs) return null;
  const r = window.cep.fs.showSaveDialogEx(title, '', [ext], defName);
  return r?.err === 0 && r.data ? r.data : null;
}
export function chooseOpenFile(title: string, exts: string[]): string | null {
  if (!window.cep?.fs) return null;
  const r = window.cep.fs.showOpenDialogEx(false, false, title, '', exts);
  return r?.err === 0 && r.data?.length ? r.data[0] : null;
}
export function chooseFolder(title: string): string | null {
  if (!window.cep?.fs) return null;
  const r = window.cep.fs.showOpenDialogEx(false, true, title, '');
  return r?.err === 0 && r.data?.length ? r.data[0] : null;
}
export function writeTextFile(path: string, text: string) {
  const req = nodeRequire();
  if (req) { req('fs').writeFileSync(path, text, 'utf8'); return true; }
  if (window.cep?.fs) return window.cep.fs.writeFile(path, text).err === 0;
  return false;
}
export function readTextFile(path: string): string | null {
  const req = nodeRequire();
  if (req) return req('fs').readFileSync(path, 'utf8');
  if (window.cep?.fs) { const r = window.cep.fs.readFile(path); return r.err === 0 ? r.data : null; }
  return null;
}
export function openInExplorer(path: string) {
  const req = nodeRequire();
  if (!req) return;
  const cp = req('child_process');
  if (/win/i.test(navigator.platform)) cp.spawn('explorer', ['/select,', path.replace(/\//g, '\\')], { detached: true });
  else cp.spawn('open', ['-R', path], { detached: true });
}
