export interface EvidenceCaptureJob { readonly key: string; readonly run: () => Promise<void>; readonly onFailure: (error: Error, attempt: number) => Promise<void> | void }

export class EvidenceCaptureQueue {
  private readonly pending: EvidenceCaptureJob[] = [];
  private running = false;
  private active = false;
  private idleResolvers: Array<() => void> = [];
  constructor(private readonly maximumAttempts = 2) { if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) throw new Error('maximumAttempts must be a positive integer'); }
  enqueue(job: EvidenceCaptureJob): void {
    this.pending.push(job);
    if (!this.running) { this.running = true; queueMicrotask(() => { void this.drain(); }); }
  }
  get size(): number { return this.pending.length + (this.active ? 1 : 0); }
  waitForIdle(): Promise<void> { if (!this.running && this.pending.length === 0) return Promise.resolve(); return new Promise((resolve) => this.idleResolvers.push(resolve)); }
  private async drain(): Promise<void> {
    while (this.pending.length) {
      const job = this.pending.shift()!;
      this.active = true;
      for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
        try { await job.run(); break; }
        catch (cause) { await job.onFailure(cause instanceof Error ? cause : new Error(String(cause)), attempt); }
      }
      this.active = false;
    }
    this.running = false;
    const resolvers = this.idleResolvers; this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
