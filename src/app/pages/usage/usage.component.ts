import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';

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

  constructor(private router: Router) {}

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
  }

  // ---- Loading ---------------------------------------------------------
  /**
   * REPLACE with GET /usage/summary?days=<rangeDays>
   * On { code: 'auth' } navigate to /account; on any other error set this.error and loading = false.
   */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.later(() => {
      this.buildMock(this.rangeDays);
      this.loading = false;
    }, 500);
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
    if (this.days.length <= 14) { return true; }
    return index % 5 === 0 || index === this.days.length - 1;
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter(t => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }

  // ---- MOCK DATA (remove when connected to the backend) -------------------
  private buildMock(range: number): void {
    const days: DayUsage[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);

      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const base = 45 + ((date.getDate() * 37) % 55);
      const messages = weekend ? Math.round(base / 3) : base;
      days.push({ date, messages, cost: messages * 0.0125 });
    }
    this.days = days;

    const totalMsg = this.totalMessages;
    const totalCost = this.totalCost;

    this.byAgent = this.split(totalMsg, totalCost, [
      ['Sales Assistant', 0.5],
      ['HR Guide', 0.3],
      ['Office Helper', 0.2],
    ]);

    this.byPerson = this.split(totalMsg, totalCost, [
      ['Ada Obi', 0.35],
      ['Tunde Bello', 0.25],
      ['Chika Eze', 0.2],
      ['Ngozi Okafor', 0.12],
      ['Ibrahim Musa', 0.08],
    ]);

    this.monthCost = 412.4;
    this.monthLimit = 500;
  }

  private split(totalMsg: number, totalCost: number, parts: Array<[string, number]>): UsageRow[] {
    return parts.map(p => ({
      name: p[0],
      messages: Math.round(totalMsg * p[1]),
      cost: totalCost * p[1],
      share: Math.round(p[1] * 100)
    }));
  }
}