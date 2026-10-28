import { Component, OnDestroy, OnInit, HostListener } from '@angular/core';
import { Router } from '@angular/router';
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

  constructor(private router: Router) {}

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
  /**
   * REPLACE with GET /structure (returns the users).
   * On { code: 'auth' } navigate to /account; on any other error set this.error and loading = false.
   */
  load(): void {
    if (this.loading) { return; }
    this.loading = true;
    this.error = '';

    this.later(() => {
      this.users = this.mockData();
      this.loading = false;
      if (this.page > this.totalPages) { this.page = this.totalPages; }
    }, 600);
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

    this.later(() => {
      if (target) {
        target.name = name;
        target.phone = phone;
        target.role = role;
        this.showNotice('User updated.');
      } else {
        this.users = [...this.users, {
          id: this.uid(), name, email, phone, role, active: true, lastActive: null
        }];
        this.showNotice('User added. They can now sign in with their e-mail.');
      }
      this.saving = false;
      this.panelOpen = false;
      this.editing = null;
    }, 500);
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

  /** REPLACE with POST /structure/save { id, active } */
  confirmToggle(): void {
    if (!this.confirmUser || this.saving || this.isSelf(this.confirmUser)) { return; }

    const u = this.confirmUser;
    this.saving = true;

    this.later(() => {
      u.active = !u.active;
      this.saving = false;
      this.confirmUser = null;
      if (this.page > this.totalPages) { this.page = this.totalPages; }
      this.showNotice(u.active ? 'User reactivated.' : 'User deactivated.');
    }, 500);
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

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter(t => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }

  private uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---- MOCK DATA (remove when connected to the backend) -------------------
  private mockData(): UserRow[] {
    const ago = (hours: number) => new Date(Date.now() - hours * 3600000);
    return [
      { id: 'u1',  name: 'Ada Obi',        email: 'ada.obi@example.com',       phone: '+234 801 111 2222', role: 'admin',   active: true,  lastActive: ago(1) },
      { id: 'u2',  name: 'Tunde Bello',    email: 'tunde.bello@example.com',   phone: '+234 802 333 4444', role: 'builder', active: true,  lastActive: ago(5) },
      { id: 'u3',  name: 'Chika Eze',      email: 'chika.eze@example.com',     phone: '',                  role: 'member',  active: true,  lastActive: ago(26) },
      { id: 'u4',  name: 'Ngozi Okafor',   email: 'ngozi.okafor@example.com',  phone: '+234 803 555 6666', role: 'member',  active: true,  lastActive: ago(50) },
      { id: 'u5',  name: 'Ibrahim Musa',   email: 'ibrahim.musa@example.com',  phone: '+234 805 777 8888', role: 'builder', active: true,  lastActive: ago(72) },
      { id: 'u6',  name: 'Funke Adeyemi',  email: 'funke.adeyemi@example.com', phone: '',                  role: 'member',  active: false, lastActive: ago(24 * 20) },
      { id: 'u7',  name: 'Samuel Okoro',   email: 'samuel.okoro@example.com',  phone: '+234 806 999 0000', role: 'member',  active: true,  lastActive: null },
      { id: 'u8',  name: 'Halima Yusuf',   email: 'halima.yusuf@example.com',  phone: '+234 807 121 3434', role: 'member',  active: true,  lastActive: ago(8) },
      { id: 'u9',  name: 'Emeka Nwosu',    email: 'emeka.nwosu@example.com',   phone: '',                  role: 'member',  active: false, lastActive: ago(24 * 45) },
      { id: 'u10', name: 'Bisi Alabi',     email: 'bisi.alabi@example.com',    phone: '+234 809 565 7878', role: 'builder', active: true,  lastActive: ago(3) },
    ];
  }
}