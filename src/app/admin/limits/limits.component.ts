import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

type Role = 'member' | 'builder' | 'admin';

interface LimitSettings {
  monthlyCap: number;
  dailyMessages: number;
  retentionDays: number;
  blockedTools: string[];
}

interface ToolInfo {
  key: string;
  name: string;
  desc: string;
}

@Component({
  selector: 'app-limits',
  templateUrl: './limits.component.html',
  styleUrls: ['./limits.component.scss']
})
export class LimitsComponent implements OnInit, OnDestroy {
  retentionOptions = [30, 90, 180, 365];

  // Filled from GET /limits/get (the same tools the server knows about)
  tools: ToolInfo[] = [];

  private readonly toolDesc: { [key: string]: string } = {
    search_knowledge: 'Reads the documents attached to an agent. No side effects.',
    get_current_time: 'Tells the agent the current date and time. No side effects.',
    send_email:       'Sends a message to someone outside the system.',
    create_record:    'Adds a new record to the database.'
  };

  private alwaysApprove: string[] = [];   // kept as the server has them, so saving does not wipe them

  saved: LimitSettings | null = null;     // what the server has
  blocked: string[] = [];                 // working copy of the ticked tools
  monthCost = 0;

  loading = false;
  saving = false;
  error = '';
  formError = '';
  notice = '';

  readonly skeletons = [1, 2, 3];

  private timers: number[] = [];
  private noticeTimer: number | null = null;

  private sub?: Subscription;

  constructor(private router: Router, private api: ApiService) {}

  // ---- Session ---------------------------------------------------------
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // Cosmetic guard only: the server must still check the role on every request.
    if (!this.signedIn) {
      this.router.navigate(['/account'], { queryParams: { returnUrl: '/limits' } });
      return;
    }
    if (this.role !== 'admin') {
      this.router.navigate(['/home']);
      return;
    }
    this.load();
  }

  ngOnDestroy(): void {
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers = [];
    if (this.noticeTimer !== null) { window.clearTimeout(this.noticeTimer); }
    this.sub?.unsubscribe();
  }

  // ---- Loading ---------------------------------------------------------
  /** GET /limits/get (and this month's cost from GET /usage/summary) */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.sub?.unsubscribe();
    this.sub = this.api.limits().subscribe({
      next: (r: any) => {
        const L = r.limits || {};
        this.tools = (r.tools || []).map((t: any): ToolInfo => ({
          key: t.key, name: t.name, desc: this.toolDesc[t.key] || 'An action agents can take.'
        }));
        this.applyLimits(L);
        this.alwaysApprove = (L.alwaysApproveTools || []).slice();
        this.loading = false;

        // the cost so far this month is only for the notice after saving; a failure here is not important
        this.api.usage(7).subscribe({ next: (u: any) => { this.monthCost = u.monthCost || 0; }, error: () => {} });
      },
      error: (e: ApiError) => {
        this.loading = false;
        this.error = e.message;      // an expired session is handled by the interceptor
      }
    });
  }

  private applyLimits(L: any): void {
    const days = L.retentionDays || 90;
    if (this.retentionOptions.indexOf(days) === -1) {
      this.retentionOptions = [...this.retentionOptions, days].sort((a, b) => a - b);
    }
    this.saved = {
      monthlyCap: L.monthlyCostCap || 0,
      dailyMessages: L.dailyMessageCap || 0,
      retentionDays: days,
      blockedTools: (L.blockedTools || []).slice()
    };
    this.blocked = this.saved.blockedTools.slice();
  }

  // ---- Blocked tools ---------------------------------------------------
  isBlocked(key: string): boolean {
    return this.blocked.indexOf(key) !== -1;
  }

  toggleBlocked(key: string, checked: boolean): void {
    if (this.saving) { return; }
    const without = this.blocked.filter(k => k !== key);
    this.blocked = checked ? [...without, key] : without;
  }

  // ---- Save / discard --------------------------------------------------
  /** POST /limits/save */
  save(event: Event, rawCap: string, rawDaily: string, rawRetention: string): void {
    event.preventDefault();
    if (this.saving || !this.saved) { return; }
    this.formError = '';

    const cap = parseFloat(rawCap);
    const daily = Number(rawDaily);
    const retention = parseInt(rawRetention, 10);

    if (!isFinite(cap) || cap <= 0 || cap > 1000000) {
      this.formError = 'Enter a monthly cost cap greater than 0 (and not more than 1,000,000).';
      return;
    }
    if (rawDaily.trim() === '' || !isFinite(daily) || Math.floor(daily) !== daily || daily < 1 || daily > 10000) {
      this.formError = 'Enter a whole number of messages per day between 1 and 10,000.';
      return;
    }
    if (this.retentionOptions.indexOf(retention) === -1) {
      this.formError = 'Choose how long conversations are kept.';
      return;
    }

    const next: LimitSettings = {
      monthlyCap: Math.round(cap * 100) / 100,
      dailyMessages: daily,
      retentionDays: retention,
      blockedTools: this.blocked.slice()
    };

    this.saving = true;
    this.api.saveLimits({
      monthlyCostCap: next.monthlyCap,
      dailyMessageCap: next.dailyMessages,
      retentionDays: next.retentionDays,
      blockedTools: next.blockedTools,
      alwaysApproveTools: this.alwaysApprove
    }).subscribe({
      next: (r: any) => {
        this.applyLimits(r.limits || {});
        this.alwaysApprove = ((r.limits && r.limits.alwaysApproveTools) || this.alwaysApprove).slice();
        this.saving = false;
        this.showNotice(
          next.monthlyCap < this.monthCost
            ? 'Saved. The new cap is below this month\'s cost, so agents will stop until next month.'
            : 'Limits and policies saved.'
        );
      },
      error: (e: ApiError) => {
        this.saving = false;
        this.formError = e.message;
      }
    });
  }

  /** Puts the saved values back into the fields and the tool list. */
  discard(capI: HTMLInputElement, dailyI: HTMLInputElement, retS: HTMLSelectElement): void {
    if (this.saving || !this.saved) { return; }
    capI.value = String(this.saved.monthlyCap);
    dailyI.value = String(this.saved.dailyMessages);
    retS.value = String(this.saved.retentionDays);
    this.blocked = this.saved.blockedTools.slice();
    this.formError = '';
  }

  // ---- Helpers ---------------------------------------------------------
  trackByKey(index: number, t: ToolInfo): string {
    return t.key;
  }

  private showNotice(text: string): void {
    this.notice = text;
    if (this.noticeTimer !== null) { window.clearTimeout(this.noticeTimer); }
    this.noticeTimer = window.setTimeout(() => {
      this.notice = '';
      this.noticeTimer = null;
    }, 4000);
  }

}