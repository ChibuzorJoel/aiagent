import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

type Role = 'member' | 'builder' | 'admin';

type ActionKey =
  | 'sign_in'
  | 'agent_created'
  | 'agent_updated'
  | 'agent_published'
  | 'agent_deleted'
  | 'knowledge_added'
  | 'knowledge_deleted'
  | 'tool_connected'
  | 'tool_disconnected'
  | 'conversation_deleted'
  | 'approval_decided'
  | 'user_changed'
  | 'limit_changed';

interface AuditEntry {
  id: string;
  time: Date;
  person: string;
  action: ActionKey;
  target: string;
  details: string;
}

@Component({
  selector: 'app-audit',
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.scss']
})
export class AuditComponent implements OnInit, OnDestroy {
  readonly actionKeys: ActionKey[] = [
    'sign_in', 'agent_created', 'agent_updated', 'agent_published', 'agent_deleted',
    'knowledge_added', 'knowledge_deleted', 'tool_connected', 'tool_disconnected', 'approval_decided',
    'conversation_deleted', 'user_changed', 'limit_changed'
  ];

  entries: AuditEntry[] = [];

  // Filters and paging
  personFilter = '';
  actionFilter: '' | ActionKey = '';
  from = '';                 // yyyy-mm-dd or ''
  to = '';                   // yyyy-mm-dd or ''
  page = 1;
  readonly pageSize = 10;

  loading = false;
  error = '';

  readonly skeletons = [1, 2, 3, 4, 5, 6];

  private timers: number[] = [];
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

  // ---- List getters ----------------------------------------------------
  get persons(): string[] {
    const seen: string[] = [];
    this.entries.forEach(e => { if (seen.indexOf(e.person) === -1) { seen.push(e.person); } });
    return seen.sort((a, b) => a.localeCompare(b));
  }

  get hasFilters(): boolean {
    return !!this.personFilter || !!this.actionFilter || !!this.from || !!this.to;
  }

  get dateError(): boolean {
    return !!this.from && !!this.to && this.from > this.to;
  }

  get filtered(): AuditEntry[] {
    if (this.dateError) { return []; }

    const start = this.from ? new Date(this.from + 'T00:00:00').getTime() : null;
    const end = this.to ? new Date(this.to + 'T23:59:59.999').getTime() : null;

    return this.entries
      .filter(e => {
        if (this.personFilter && e.person !== this.personFilter) { return false; }
        if (this.actionFilter && e.action !== this.actionFilter) { return false; }
        const t = e.time.getTime();
        if (start !== null && t < start) { return false; }
        if (end !== null && t > end) { return false; }
        return true;
      })
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get pageItems(): AuditEntry[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  get pageStart(): number {
    return this.filtered.length === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.page * this.pageSize, this.filtered.length);
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // Cosmetic guard only: the server must still check the role on every request.
    if (!this.signedIn) {
      this.router.navigate(['/account'], { queryParams: { returnUrl: '/audit' } });
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
    this.sub?.unsubscribe();
  }

  // ---- Loading ---------------------------------------------------------
  /** GET /audit/list (admins only, newest first) */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.sub?.unsubscribe();
    this.sub = this.api.audit({ limit: 1000 }).subscribe({
      next: (r: any) => {
        this.entries = (r.entries || []).map((e: any): AuditEntry => ({
          id: e.id,
          time: new Date(e.time),
          person: e.person,
          action: e.action,
          target: e.target || '-',
          details: e.details || ''
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

  // ---- Filters and paging ----------------------------------------------
  onPerson(value: string): void {
    this.personFilter = value || '';
    this.page = 1;
  }

  onAction(value: string): void {
    this.actionFilter = this.actionKeys.indexOf(value as ActionKey) !== -1 ? (value as ActionKey) : '';
    this.page = 1;
  }

  onFrom(value: string): void {
    this.from = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    this.page = 1;
  }

  onTo(value: string): void {
    this.to = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    this.page = 1;
  }

  clearFilters(ps: HTMLSelectElement, ac: HTMLSelectElement, fi: HTMLInputElement, ti: HTMLInputElement): void {
    ps.value = '';
    ac.value = '';
    fi.value = '';
    ti.value = '';
    this.personFilter = '';
    this.actionFilter = '';
    this.from = '';
    this.to = '';
    this.page = 1;
  }

  prev(): void { if (this.page > 1) { this.page--; } }
  next(): void { if (this.page < this.totalPages) { this.page++; } }

  // ---- Labels ----------------------------------------------------------
  actionLabel(a: ActionKey): string {
    switch (a) {
      case 'sign_in':          return 'Signed in';
      case 'agent_created':    return 'Agent created';
      case 'agent_updated':    return 'Agent updated';
      case 'agent_published':  return 'Agent published';
      case 'agent_deleted':    return 'Agent deleted';
      case 'knowledge_added':  return 'Document added';
      case 'knowledge_deleted': return 'Document deleted';
      case 'tool_connected':   return 'Tool connected';
      case 'tool_disconnected': return 'Tool disconnected';
      case 'conversation_deleted': return 'Chat deleted';
      case 'approval_decided': return 'Approval decided';
      case 'user_changed':     return 'User changed';
      default:                 return 'Limits changed';
    }
  }

  /** Only used to pick a chip colour. The label text always carries the meaning. */
  actionGroup(a: ActionKey): string {
    if (a === 'agent_deleted' || a === 'knowledge_deleted' || a === 'conversation_deleted') { return 'danger'; }
    if (a === 'limit_changed' || a === 'user_changed') { return 'policy'; }
    if (a === 'agent_updated' || a === 'agent_published' || a === 'tool_connected') { return 'change'; }
    return '';
  }

  // ---- Helpers ---------------------------------------------------------
  trackById(index: number, e: AuditEntry): string {
    return e.id;
  }

}
