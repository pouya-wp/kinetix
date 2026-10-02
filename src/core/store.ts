// Snapshot-based undoable store. Edits mutate `state` in place; a snapshot of the
// state *before* an edit gesture is pushed to the undo stack when the gesture ends.

type Listener = (reason: string) => void;

export class Store<T extends object> {
  state: T;
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private pending: T | null = null;
  private listeners = new Set<Listener>();
  private notifyQueued = false;
  private reasons = new Set<string>();
  limit = 150;

  constructor(initial: T) {
    this.state = initial;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Start an edit gesture (e.g. slider drag start). */
  begin() {
    if (!this.pending) this.pending = structuredClone(this.state);
  }

  /** Mutate state. `final` closes the gesture and records one undo step. */
  set(fn: (s: T) => void, final = true, reason = 'edit') {
    this.begin();
    fn(this.state);
    if (final) this.commit();
    this.emit(reason);
  }

  /** Mutate without touching history (view-only / transient data). */
  silent(fn: (s: T) => void, reason = 'view') {
    fn(this.state);
    this.emit(reason);
  }

  commit() {
    if (!this.pending) return;
    this.undoStack.push(this.pending);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.pending = null;
  }

  undo() {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(structuredClone(this.state));
    this.state = prev;
    this.emit('history');
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(structuredClone(this.state));
    this.state = next;
    this.emit('history');
    return true;
  }

  get canUndo() { return this.undoStack.length > 0 || !!this.pending; }
  get canRedo() { return this.redoStack.length > 0; }

  replace(next: T, keepHistory = true) {
    if (keepHistory) { this.commit(); this.undoStack.push(structuredClone(this.state)); this.redoStack.length = 0; }
    else { this.undoStack.length = 0; this.redoStack.length = 0; this.pending = null; }
    this.state = next;
    this.emit('load');
  }

  emit(reason: string) {
    this.reasons.add(reason);
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      const r = [...this.reasons].join(',');
      this.reasons.clear();
      for (const l of this.listeners) l(r);
    });
  }
}
