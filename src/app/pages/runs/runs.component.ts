import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

type Role = 'member' | 'builder' | 'admin';
type RunStatus = 'running' | 'waiting' | 'failed' | 'done' | 'stopped';
type StepKind = 'model' | 'tool' | 'result' | 'approval';
type StepStatus = 'ok' | 'failed' | 'waiting' | 'running';

interface RunRow {
  id: string;
  time: Date;
  agent: string;
  person: string;
  status: RunStatus;
  durationSec: number;
  cost: number;
}

interface RunStep {
  id: string;
  kind: StepKind;
  title: string;
  detail?: string;
  at: number;            // seconds from the start of the run
  status: StepStatus;
  error?: string;
}

@Component({
  selector: 'app-runs',
  templateUrl: './runs.component.html',
  styleUrls: ['./runs.component.scss']
})
export class RunsComponent implements OnInit, OnDestroy {
  readonly statusOptions: RunStatus[] = ['running', 'waiting', 'failed', 'done', 'stopped'];

  runs: RunRow[] = [];

  // Filters and paging
  search = '';
  statusFilter: '' | RunStatus = '';
  page = 1;
  readonly pageSize = 10;

  // List state
  loading = false;
  error = '';

  // Details panel
  selected: RunRow | null = null;
  steps: RunStep[] = [];
  stepsLoading = false;
  stepsError = '';

  readonly skeletons = [1, 2, 3, 4, 5];

  private search$ = new Subject<string>();
  private sub?: Subscription;
  private timers: number[] = [];
  private openToken = 0;      // ignores late answers for a run the person already closed

  private listSub?: Subscription;
  private stepsSub?: Subscription;

  constructor(private router: Router, private api: ApiService) {}

  // ---- Session ---------------------------------------------------------
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  // ---- List getters ----------------------------------------------------
  get hasFilters(): boolean {
    return !!this.search || !!this.statusFilter;
  }

  get filtered(): RunRow[] {
    const q = this.search;
    return this.runs
      .filter(r => {
        if (this.statusFilter && r.status !== this.statusFilter) { return false; }
        if (q && (r.agent + ' ' + r.person).toLowerCase().indexOf(q) === -1) { return false; }
        return true;
      })
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get pageItems(): RunRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // Cosmetic guard only: the server must still check the role on every request.
    if (!this.signedIn) {
      this.router.navigate(['/account'], { queryParams: { returnUrl: '/runs' } });
      return;
    }
    if (this.role === 'member') {
      this.router.navigate(['/home']);
      return;
    }

    this.sub = this.search$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(v => {
        this.search = v.trim().toLowerCase();
        this.page = 1;
      });

    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.listSub?.unsubscribe();
    this.stepsSub?.unsubscribe();
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers = [];
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeRun();
  }

  // ---- Loading the list ------------------------------------------------
  /** GET /runs/list (builders see their own agents' runs, admins see all) */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.listSub?.unsubscribe();
    this.listSub = this.api.get('/runs/list', { pageSize: 100 }).subscribe({
      next: (r: any) => {
        this.runs = (r.runs || []).map((x: any): RunRow => ({
          id: x.id,
          time: new Date(x.time),
          agent: x.agentName,
          person: x.person,
          status: this.toStatus(x.status),
          durationSec: (x.durationMs || 0) / 1000,
          cost: x.cost || 0
        }));
        this.loading = false;
        if (this.page > this.totalPages) { this.page = this.totalPages; }
      },
      error: (e: ApiError) => {
        this.loading = false;
        this.error = e.message;      // an expired session is handled by the interceptor
      }
    });
  }

  private toStatus(s: string): RunStatus {
    return s === 'running' || s === 'waiting' || s === 'failed' || s === 'stopped' ? s : 'done';
  }

  // ---- Filters and paging ----------------------------------------------
  onSearch(value: string): void { this.search$.next(value || ''); }

  onStatus(value: string): void {
    this.statusFilter = (value === 'running' || value === 'waiting' || value === 'failed' || value === 'done' || value === 'stopped') ? value : '';
    this.page = 1;
  }

  clearFilters(q: HTMLInputElement, ss: HTMLSelectElement): void {
    q.value = '';
    ss.value = '';
    this.search = '';
    this.statusFilter = '';
    this.page = 1;
  }

  prev(): void { if (this.page > 1) { this.page--; } }
  next(): void { if (this.page < this.totalPages) { this.page++; } }

  // ---- Run details -----------------------------------------------------
  openRun(r: RunRow): void {
    this.selected = r;
    this.loadSteps(r);
  }

  closeRun(): void {
    if (!this.selected) { return; }
    this.openToken++;
    this.selected = null;
    this.steps = [];
    this.stepsLoading = false;
    this.stepsError = '';
  }

  retrySteps(): void {
    if (this.selected && !this.stepsLoading) { this.loadSteps(this.selected); }
  }

  /** GET /runs/get?id=... (the steps of the run) */
  private loadSteps(r: RunRow): void {
    const token = ++this.openToken;
    this.steps = [];
    this.stepsError = '';
    this.stepsLoading = true;

    this.stepsSub?.unsubscribe();
    this.stepsSub = this.api.run(r.id).subscribe({
      next: (res: any) => {
        if (token !== this.openToken) { return; }
        const run = res.run || {};
        const start = new Date(run.time).getTime();
        const list = run.steps || [];

        this.steps = list.map((st: any, i: number): RunStep => {
          const failed = st.status === 'failed' || st.status === 'blocked' || st.status === 'rejected';
          const status: StepStatus = failed ? 'failed' : st.status === 'waiting' ? 'waiting' : 'ok';
          const at = st.time ? Math.max(0, (new Date(st.time).getTime() - start) / 1000) : 0;
          return {
            id: r.id + '-' + i,
            kind: st.type === 'tool' ? 'tool' : st.type === 'approval' ? 'approval' : 'model',
            title: st.name || 'Step',
            detail: st.detail || undefined,
            at,
            status,
            error: st.error || undefined
          };
        });

        // a failure that has no step of its own is still shown
        if (run.error && !this.steps.some(x => x.status === 'failed')) {
          this.steps.push({ id: r.id + '-err', kind: 'result', title: 'The run stopped', at: r.durationSec, status: 'failed', error: run.error });
        }
        this.stepsLoading = false;
      },
      error: (e: ApiError) => {
        if (token !== this.openToken) { return; }
        this.stepsLoading = false;
        this.stepsError = e.message;
      }
    });
  }

  // ---- Labels ----------------------------------------------------------
  statusText(s: RunStatus): string {
    switch (s) {
      case 'running': return '⋯ Running';
      case 'waiting': return '⏳ Waiting for approval';
      case 'failed':  return '✖ Failed';
      case 'stopped': return '■ Stopped';
      default:        return '✔ Done';
    }
  }

  stepStatus(s: StepStatus): string {
    switch (s) {
      case 'failed':  return '✖ Failed';
      case 'waiting': return '⏳ Waiting';
      case 'running': return '⋯ In progress';
      default:        return '✔ Done';
    }
  }

  kindLabel(k: StepKind): string {
    switch (k) {
      case 'model':    return 'Model call';
      case 'tool':     return 'Tool call';
      case 'result':   return 'Result';
      default:         return 'Approval';
    }
  }

  icon(k: StepKind): string {
    switch (k) {
      case 'model':    return '🧠';
      case 'tool':     return '🧰';
      case 'result':   return '📄';
      default:         return '✅';
    }
  }

  duration(sec: number): string {
    if (sec < 60) { return sec.toFixed(1) + ' s'; }
    const m = Math.floor(sec / 60);
    const s = Math.round(sec - m * 60);
    return m + ' min ' + s + ' s';
  }

  // ---- Helpers ---------------------------------------------------------
  trackById(index: number, r: RunRow): string { return r.id; }
  trackByStep(index: number, s: RunStep): string { return s.id; }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter(t => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }
}
