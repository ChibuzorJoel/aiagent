import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';
type Tab = 'pending' | 'history';

interface Approval {
  id: string;
  agent: string;
  text: string;
  requestedBy: string;
  createdAt: Date;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: Date;
  reason?: string;
}

interface DialogState {
  item: Approval;
  approve: boolean;
}

@Component({
  selector: 'app-approvals',
  templateUrl: './approvals.component.html',
  styleUrls: ['./approvals.component.scss']
})
export class ApprovalsComponent implements OnInit, OnDestroy {
  @ViewChild('reasonBox') reasonRef?: ElementRef<HTMLTextAreaElement>;

  items: Approval[] = [];           // the rows of the current tab and page (the server does the paging)
  tab: Tab = 'pending';
  page = 1;

  loading = false;
  saving = false;
  error = '';
  notice = '';
  dialog: DialogState | null = null;

  readonly skeletons = [1, 2, 3];

  private waitingTotal = 0;         // pendingCount from the server
  private pages = 1;
  private seq = 0;                  // drops answers that arrive late (fast tab switching)
  private listSub?: Subscription;
  private timers: number[] = [];
  private noticeTimer: number | null = null;
  private pollTimer: number | null = null;

  constructor(private router: Router, private api: ApiService) {}

  // ---- Getters (the template reads these) --------------------------------
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get pendingCount(): number { return this.waitingTotal; }
  get list(): Approval[] { return this.items; }
  get pageItems(): Approval[] { return this.items; }
  get totalPages(): number { return Math.max(1, this.pages); }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    if (!this.signedIn) {
      this.goToLogin();
      return;
    }
    this.load();

    // Quietly look for new requests every 30 seconds while the page is visible
    this.pollTimer = window.setInterval(() => {
      if (document.hidden || this.loading || this.saving || this.dialog) { return; }
      this.load(true);
    }, 30000);
  }

  ngOnDestroy(): void {
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers = [];
    if (this.noticeTimer !== null) { window.clearTimeout(this.noticeTimer); }
    if (this.pollTimer !== null) { window.clearInterval(this.pollTimer); }
    this.listSub?.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDialog();
  }

  // ---- Loading: GET /approvals/list?tab=&page= ---------------------------
  load(silent = false): void {
    const mySeq = ++this.seq;
    this.listSub?.unsubscribe();
    if (!silent) {
      this.loading = true;
      this.error = '';
    }

    this.listSub = this.api.approvals(this.tab, this.page).subscribe({
      next: (r: any) => {
        if (mySeq !== this.seq) { return; }
        this.items = (r.approvals || []).map((a: any) => this.toApproval(a));
        this.waitingTotal = r.pendingCount || 0;
        this.pages = r.pages || 1;
        this.loading = false;

        // keeps the red count in the menu in step with this page
        window.dispatchEvent(new CustomEvent('approvals-count', { detail: this.waitingTotal }));

        if (this.page > this.pages) {      // e.g. the last item on the last page was just decided
          this.page = this.pages;
          this.load(true);
        }
      },
      error: (e: ApiError) => {
        if (mySeq !== this.seq) { return; }
        this.loading = false;
        if (!silent) { this.error = e.message; }   // an expired session is handled by the interceptor
      }
    });
  }

  private toApproval(a: any): Approval {
    return {
      id: a.id,
      agent: a.agentName,
      text: a.description,
      requestedBy: a.requestedBy,
      createdAt: new Date(a.createdAt),
      status: a.status,
      decidedBy: a.decidedBy || undefined,
      decidedAt: a.decidedAt ? new Date(a.decidedAt) : undefined,
      reason: a.reason || undefined
    };
  }

  // ---- Tabs and paging -------------------------------------------------
  setTab(tab: Tab): void {
    if (this.tab === tab) { return; }
    this.tab = tab;
    this.page = 1;
    this.items = [];
    this.load();
  }

  prev(): void { if (this.page > 1) { this.page--; this.load(); } }
  next(): void { if (this.page < this.pages) { this.page++; this.load(); } }

  // ---- Decision dialog -------------------------------------------------
  openDialog(item: Approval, approve: boolean): void {
    if (this.saving || item.status !== 'pending') { return; }
    this.dialog = { item, approve };
    this.later(() => {
      if (this.reasonRef) { this.reasonRef.nativeElement.focus(); }
    }, 0);
  }

  closeDialog(): void {
    if (this.saving) { return; }
    this.dialog = null;
  }

  /**
   * POST /approvals/decide { id, decision, reason }
   * Approving runs the action and lets the agent finish, so this can take a few seconds.
   * The agent's final message is saved in the person's conversation (History).
   */
  confirm(rawReason: string): void {
    if (!this.dialog || this.saving) { return; }

    const d = this.dialog;
    const reason = (rawReason || '').trim();
    this.saving = true;
    this.error = '';

    this.api.decideApproval(d.item.id, d.approve ? 'approve' : 'reject', reason).subscribe({
      next: (r: any) => {
        this.saving = false;
        this.dialog = null;

        let text = d.approve ? 'Action approved.' : 'Action rejected.';
        if (r.error) { text = r.error; }
        else if (r.nextApproval) { text += ' The agent is now asking for another approval.'; }
        else if (r.status === 'failed') { text += ' The agent could not finish afterwards.'; }

        this.load();
        this.showNotice(text);
      },
      error: (e: ApiError) => {
        this.saving = false;
        this.dialog = null;
        this.load();                 // someone else may have decided it already
        this.error = e.message;
      }
    });
  }

  // ---- Helpers ---------------------------------------------------------
  trackById(index: number, a: Approval): string {
    return a.id;
  }

  waited(from: Date): string {
    const mins = Math.floor((Date.now() - from.getTime()) / 60000);
    if (mins < 1) { return 'less than a minute'; }
    if (mins < 60) { return mins + ' min'; }
    const hours = Math.floor(mins / 60);
    if (hours < 24) { return hours + ' h'; }
    return Math.floor(hours / 24) + ' d';
  }

  private goToLogin(): void {
    this.router.navigate(['/account'], { queryParams: { returnUrl: '/approvals' } });
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