import { Component, OnDestroy, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

type Role = 'member' | 'builder' | 'admin';
type StatusFilter = '' | 'active' | 'inactive';

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  active: boolean;
  lastActive: Date | null;
}

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent implements OnInit, OnDestroy {
  readonly roles: Role[] = ['member', 'builder', 'admin'];

  users: UserRow[] = [];

  // Filters
  search = '';
  roleFilter: '' | Role = '';
  statusFilter: StatusFilter = '';
  page = 1;
  readonly pageSize = 8;

  // State
  loading = false;
  saving = false;
  error = '';
  formError = '';
  notice = '';

  // Panel and dialog
  panelOpen = false;
  editing: UserRow | null = null;      // null while the panel is in "add" mode
  confirmUser: UserRow | null = null;

  readonly skeletons = [1, 2, 3, 4, 5];

  private search$ = new Subject<string>();
  private sub?: Subscription;
  private timers: number[] = [];
  private noticeTimer: number | null = null;

  private listSub?: Subscription;

  constructor(private router: Router, private api: ApiService) {}

  // ---- Session ---------------------------------------------------------
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  /** E-mail of the signed-in person, read from the profile the Account page keeps. */
  private get myEmail(): string {
    try {
      const p = JSON.parse(localStorage.getItem('profile') || '{}') || {};
      return String(p.email || '').toLowerCase();
    } catch {
      return '';
    }
  }

  isSelf(u: UserRow): boolean {
    return !!this.myEmail && u.email.toLowerCase() === this.myEmail;
  }

  // ---- List getters ----------------------------------------------------
  get activeCount(): number {
    return this.users.filter(u => u.active).length;
  }

  get inactiveCount(): number {
    return this.users.length - this.activeCount;
  }

  get hasFilters(): boolean {
    return !!this.search || !!this.roleFilter || !!this.statusFilter;
  }

  get filtered(): UserRow[] {
    const q = this.search;
    return this.users
      .filter(u => {
        if (this.roleFilter && u.role !== this.roleFilter) { return false; }
        if (this.statusFilter === 'active' && !u.active) { return false; }
        if (this.statusFilter === 'inactive' && u.active) { return false; }
        if (q) {
          const hay = (u.name + ' ' + u.email + ' ' + u.phone).toLowerCase();
          if (hay.indexOf(q) === -1) { return false; }
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get pageItems(): UserRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // Cosmetic guard only: the server must still check the role on every request.
    if (!this.signedIn) {
      this.router.navigate(['/account'], { queryParams: { returnUrl: '/users' } });
      return;
    }
    if (this.role !== 'admin') {
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
    this.timers.forEach(id => window.clearTimeout(id));
    this.timers = [];
    if (this.noticeTimer !== null) { window.clearTimeout(this.noticeTimer); }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmUser) {
      this.closeConfirm();
    } else if (this.panelOpen) {
      this.closePanel();
    }
  }

  // ---- Loading ---------------------------------------------------------
  /** GET /users/list (admins only) */
  load(silent = false): void {
    if (!silent) {
      if (this.loading) { return; }
      this.loading = true;
      this.error = '';
    }

    this.listSub?.unsubscribe();
    this.listSub = this.api.get('/users/list', { pageSize: 100 }).subscribe({
      next: (r: any) => {
        this.users = (r.users || []).map((u: any): UserRow => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone || '',
          role: (u.role === 'admin' || u.role === 'builder') ? u.role : 'member',
          active: u.active !== false,
          lastActive: u.lastActive ? new Date(u.lastActive) : null
        }));
        this.loading = false;
        if (this.page > this.totalPages) { this.page = this.totalPages; }
      },
      error: (e: ApiError) => {
        this.loading = false;
        if (!silent) { this.error = e.message; }     // an expired session is handled by the interceptor
      }
    });
  }

  // ---- Filters and paging ----------------------------------------------
  onSearch(value: string): void { this.search$.next(value || ''); }

  onRole(value: string): void {
    this.roleFilter = (value === 'member' || value === 'builder' || value === 'admin') ? value : '';
    this.page = 1;
  }

  onStatus(value: string): void {
    this.statusFilter = (value === 'active' || value === 'inactive') ? value : '';
    this.page = 1;
  }

  clearFilters(q: HTMLInputElement, rs: HTMLSelectElement, ss: HTMLSelectElement): void {
    q.value = '';
    rs.value = '';
    ss.value = '';
    this.search = '';
    this.roleFilter = '';
    this.statusFilter = '';
    this.page = 1;
  }

  prev(): void { if (this.page > 1) { this.page--; } }
  next(): void { if (this.page < this.totalPages) { this.page++; } }

  // ---- Add / edit panel ------------------------------------------------
  openAdd(): void {
    this.editing = null;
    this.formError = '';
    this.panelOpen = true;
  }

  openEdit(u: UserRow): void {
    this.editing = u;
    this.formError = '';
    this.panelOpen = true;
  }

  closePanel(): void {
    if (this.saving) { return; }
    this.panelOpen = false;
    this.editing = null;
    this.formError = '';
  }

  /** REPLACE with POST /structure/save { id?, name, email, phone, role } */
  saveUser(event: Event, rawName: string, rawEmail: string, rawPhone: string, rawRole: string): void {
    event.preventDefault();
    if (this.saving) { return; }
    this.formError = '';

    const name = (rawName || '').trim();
    const phone = (rawPhone || '').trim();
    const email = this.editing ? this.editing.email : (rawEmail || '').trim().toLowerCase();
    let role: Role = (rawRole === 'admin' || rawRole === 'builder') ? rawRole : 'member';

    if (!name) {
      this.formError = 'Please enter the name.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.formError = 'Please enter a valid e-mail address.';
      return;
    }
    if (phone && !/^\+?[0-9\s-]{7,15}$/.test(phone)) {
      this.formError = 'Please enter a valid phone number.';
      return;
    }
    if (!this.editing && this.users.some(u => u.email.toLowerCase() === email)) {
      this.formError = 'A user with this e-mail already exists.';
      return;
    }

    // You cannot change your own role.
    if (this.editing && this.isSelf(this.editing)) {
      role = this.editing.role;
    }

    const target = this.editing;
    this.saving = true;

    const done = (text: string): void => {
      this.saving = false;
      this.panelOpen = false;
      this.editing = null;
      this.showNotice(text);
      this.load(true);
    };
    const failed = (e: ApiError): void => {
      this.saving = false;
      this.formError = e.message;
    };

    if (target) {
      // POST /users/update { id, name, phone, role }
      this.api.updateUser({ id: target.id, name, phone, role } as any).subscribe({
        next: () => done('User updated.'),
        error: failed
      });
    } else {
      // POST /users/create { email, name, phone, role }
      this.api.createUser({ email, name, phone, role } as any).subscribe({
        next: () => done('User added. They can now sign in with their e-mail.'),
        error: failed
      });
    }
  }

  // ---- Deactivate / reactivate -----------------------------------------
  askToggle(u: UserRow): void {
    if (this.saving || this.isSelf(u)) { return; }
    this.confirmUser = u;
  }

  closeConfirm(): void {
    if (this.saving) { return; }
    this.confirmUser = null;
  }

  /** POST /users/update { id, active } */
  confirmToggle(): void {
    if (!this.confirmUser || this.saving || this.isSelf(this.confirmUser)) { return; }

    const u = this.confirmUser;
    this.saving = true;

    this.api.updateUser({ id: u.id, active: !u.active }).subscribe({
      next: () => {
        u.active = !u.active;
        this.saving = false;
        this.confirmUser = null;
        if (this.page > this.totalPages) { this.page = this.totalPages; }
        this.showNotice(u.active ? 'User reactivated.' : 'User deactivated.');
      },
      error: (e: ApiError) => {
        this.saving = false;
        this.confirmUser = null;
        this.error = e.message;
      }
    });
  }

  // ---- Helpers ---------------------------------------------------------
  trackById(index: number, u: UserRow): string {
    return u.id;
  }

  private showNotice(text: string): void {
    this.notice = text;
    if (this.noticeTimer !== null) { window.clearTimeout(this.noticeTimer); }
    this.noticeTimer = window.setTimeout(() => {
      this.notice = '';
      this.noticeTimer = null;
    }, 3500);
  }


}
