import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';

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
  readonly retentionOptions = [30, 90, 180, 365];

  // Same tools as the Tools page. Replace with the list from GET /tool/list if you want it dynamic.
  readonly tools: ToolInfo[] = [
    { key: 'search_kb',     name: 'Search the knowledge base', desc: 'Reads the documents attached to an agent. No side effects.' },
    { key: 'read_db',       name: 'Read the database',         desc: 'Looks up records. No side effects.' },
    { key: 'send_email',    name: 'Send e-mail',               desc: 'Sends a message to someone outside the system.' },
    { key: 'create_record', name: 'Create a record',           desc: 'Adds a new record to the database.' },
    { key: 'update_record', name: 'Update a record',           desc: 'Changes an existing record.' },
    { key: 'delete_record', name: 'Delete a record',           desc: 'Removes a record permanently.' },
  ];

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

  constructor(private router: Router) {}

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
  }

  // ---- Loading ---------------------------------------------------------
  /**
   * REPLACE with GET /limit/get.
   * On { code: 'auth' } navigate to /account; on any other error set this.error and loading = false.
   */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.later(() => {
      this.saved = { monthlyCap: 500, dailyMessages: 100, retentionDays: 90, blockedTools: ['delete_record'] };
      this.blocked = this.saved.blockedTools.slice();
      this.monthCost = 412.4;
      this.loading = false;
    }, 600);
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
  /** REPLACE with POST /limit/save { monthlyCap, dailyMessages, retentionDays, blockedTools } */
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
    this.later(() => {
      this.saved = next;
      this.saving = false;
      this.showNotice(
        next.monthlyCap < this.monthCost
          ? 'Saved. The new cap is below this month\'s cost, so agents will stop until next month.'
          : 'Limits and policies saved.'
      );
    }, 600);
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

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter(t => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }
}