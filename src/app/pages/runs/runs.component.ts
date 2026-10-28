import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

type Role = 'member' | 'builder' | 'admin';
type RunStatus = 'running' | 'waiting' | 'failed' | 'done';
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
  readonly statusOptions: RunStatus[] = ['running', 'waiting', 'failed', 'done'];

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

  constructor(private router: Router) {}

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
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers = [];
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeRun();
  }

  // ---- Loading the list ------------------------------------------------
  /**
   * REPLACE with GET /run/list.
   * On { code: 'auth' } navigate to /account; on any other error set this.error and loading = false.
   */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.later(() => {
      this.runs = this.mockRuns();
      this.loading = false;
      if (this.page > this.totalPages) { this.page = this.totalPages; }
    }, 600);
  }

  // ---- Filters and paging ----------------------------------------------
  onSearch(value: string): void { this.search$.next(value || ''); }

  onStatus(value: string): void {
    this.statusFilter = (value === 'running' || value === 'waiting' || value === 'failed' || value === 'done') ? value : '';
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

  /** REPLACE with GET /run/get?id=... (returns the steps of the run) */
  private loadSteps(r: RunRow): void {
    const token = ++this.openToken;
    this.steps = [];
    this.stepsError = '';
    this.stepsLoading = true;

    this.later(() => {
      if (token !== this.openToken) { return; }
      this.steps = this.buildSteps(r);
      this.stepsLoading = false;
    }, 450);
  }

  // ---- Labels ----------------------------------------------------------
  statusText(s: RunStatus): string {
    switch (s) {
      case 'running': return '⋯ Running';
      case 'waiting': return '⏳ Waiting for approval';
      case 'failed':  return '✖ Failed';
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

  // ---- MOCK DATA (remove when connected to the backend) -------------------
  private mockRuns(): RunRow[] {
    const agents = ['Sales Assistant', 'HR Guide', 'Office Helper'];
    const people = ['Ada Obi', 'Tunde Bello', 'Chika Eze', 'Ngozi Okafor'];
    const statuses: RunStatus[] = ['done', 'done', 'done', 'failed', 'waiting', 'done', 'running', 'done', 'done', 'failed'];

    const rows: RunRow[] = [];
    for (let i = 0; i < 18; i++) {
      rows.push({
        id: 'r' + (i + 1),
        time: new Date(Date.now() - (i * 95 + 7) * 60000),
        agent: agents[i % agents.length],
        person: people[(i * 3) % people.length],
        status: statuses[i % statuses.length],
        durationSec: ((i * 7) % 38) + 2.4,
        cost: 0.012 + ((i * 17) % 40) / 1000
      });
    }
    return rows;
  }

  private buildSteps(r: RunRow): RunStep[] {
    const total = r.durationSec;
    const steps: RunStep[] = [
      { id: r.id + '-1', kind: 'model', title: 'Read the question and chose what to do', detail: 'The model planned the answer.', at: 0, status: 'ok' },
      { id: r.id + '-2', kind: 'tool', title: 'Search the knowledge base', detail: 'Looked through the documents attached to ' + r.agent + '.', at: Math.min(0.8, total), status: 'ok' },
    ];

    if (r.status === 'failed') {
      steps.push({
        id: r.id + '-3', kind: 'result', title: 'Read the database', at: total, status: 'failed',
        error: 'The database did not answer in time (timeout after 30 s).'
      });
      return steps;
    }

    steps.push({ id: r.id + '-3', kind: 'result', title: 'Found 2 matching passages', detail: 'Passages were passed back to the model.', at: Math.min(2.1, total), status: 'ok' });

    if (r.status === 'waiting') {
      steps.push({
        id: r.id + '-4', kind: 'approval', title: 'Send the email "Following up on your enquiry" to the customer.',
        detail: 'The run is paused until someone approves or rejects this action.', at: total, status: 'waiting'
      });
      return steps;
    }

    if (r.status === 'running') {
      steps.push({ id: r.id + '-4', kind: 'model', title: 'Writing the answer', at: total, status: 'running' });
      return steps;
    }

    steps.push({ id: r.id + '-4', kind: 'model', title: 'Wrote the answer', detail: 'The answer was streamed to the person.', at: total, status: 'ok' });
    return steps;
  }
}