import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

type Role = 'member' | 'builder' | 'admin';
type LimitState = 'ok' | 'warn' | 'danger';

interface DayUsage {
  date: Date;
  messages: number;
  cost: number;
}

interface UsageRow {
  name: string;
  messages: number;
  cost: number;
  share: number;     // percent of total cost
}

@Component({
  selector: 'app-usage',
  templateUrl: './usage.component.html',
  styleUrls: ['./usage.component.scss']
})
export class UsageComponent implements OnInit, OnDestroy {
  rangeDays = 14;
  days: DayUsage[] = [];
  byAgent: UsageRow[] = [];
  byPerson: UsageRow[] = [];

  monthCost = 0;
  monthLimit = 0;

  loading = false;
  error = '';

  readonly skeletons = [1, 2, 3];

  private timers: number[] = [];
  private sub?: Subscription;

  constructor(private router: Router, private api: ApiService) {}

  // ---- Getters ---------------------------------------------------------
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  get totalMessages(): number {
    return this.days.reduce((sum, d) => sum + d.messages, 0);
  }

  get totalCost(): number {
    return this.days.reduce((sum, d) => sum + d.cost, 0);
  }

  get avgCost(): number {
    return this.totalMessages > 0 ? this.totalCost / this.totalMessages : 0;
  }

  get maxMessages(): number {
    return this.days.reduce((m, d) => Math.max(m, d.messages), 0);
  }

  get maxCost(): number {
    return this.days.reduce((m, d) => Math.max(m, d.cost), 0);
  }

  get limitPct(): number {
    if (this.monthLimit <= 0) { return 0; }
    return Math.min(100, Math.round((this.monthCost / this.monthLimit) * 100));
  }

  get limitState(): LimitState {
    if (this.limitPct >= 100) { return 'danger'; }
    if (this.limitPct >= 80) { return 'warn'; }
    return 'ok';
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // Cosmetic guard only: the server must still check the role on every request.
    if (!this.signedIn) {
      this.router.navigate(['/account'], { queryParams: { returnUrl: '/usage' } });
      return;
    }
    if (this.role === 'member') {
      this.router.navigate(['/home']);
      return;
    }
    this.load();
  }

  ngOnDestroy(): void {
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers = [];
    this.sub?.unsubscribe();
  }

  // ---- Loading ---------------------------------------------------------
  /** GET /usage/summary?days=<rangeDays> */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.sub?.unsubscribe();
    this.sub = this.api.get('/usage/summary', { days: this.rangeDays }).subscribe({
      next: (r: any) => {
        this.days = (r.days || []).map((d: any): DayUsage => ({
          date: new Date(d.date + 'T00:00:00'), messages: d.messages || 0, cost: d.cost || 0
        }));
        this.byAgent = this.toRows(r.byAgent || []);
        this.byPerson = this.toRows(r.byPerson || []);
        this.monthCost = r.monthCost || 0;
        this.monthLimit = r.monthlyCostCap || 0;
        this.loading = false;
      },
      error: (e: ApiError) => {
        this.loading = false;
        this.error = e.message;      // an expired session is handled by the interceptor
      }
    });
  }

  /** The share is of the total cost (or of the messages while everything is free). */
  private toRows(list: any[]): UsageRow[] {
    const totalCost = list.reduce((s, x) => s + (x.cost || 0), 0);
    const totalMsg = list.reduce((s, x) => s + (x.messages || 0), 0);
    return list.map((x: any): UsageRow => ({
      name: x.name,
      messages: x.messages || 0,
      cost: x.cost || 0,
      share: totalCost > 0 ? Math.round(((x.cost || 0) / totalCost) * 100)
           : totalMsg > 0 ? Math.round(((x.messages || 0) / totalMsg) * 100) : 0
    }));
  }

  onRange(value: string): void {
    const n = parseInt(value, 10);
    if (n !== 7 && n !== 14 && n !== 30) { return; }
    this.rangeDays = n;
    this.load();
  }

  // ---- Chart helpers ---------------------------------------------------
  pct(value: number, max: number): number {
    if (max <= 0 || value <= 0) { return 0; }
    return Math.max(2, Math.round((value / max) * 100));
  }

  /** Show every day for short ranges, every 5th day for longer ones. */
  showLabel(index: number): boolean {
    // Fewer labels on narrow screens so the dates do not run into each other
    const step = window.innerWidth < 600 ? 4 : (this.days.length <= 14 ? 1 : 5);
    if (step === 1) { return true; }
    return index % step === 0 || index === this.days.length - 1;
  }

}
