import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

type Role = 'member' | 'builder' | 'admin';

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  action?: 'logout';
  roles?: Role[];                 // omitted = any signed-in role
  auth: 'in' | 'out' | 'any';     // login-state visibility
  badge?: number;
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-nav',
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.scss']
})
export class NavComponent implements OnInit, OnDestroy {
  drawerOpen = false;
  openGroup = 'workspace';
  approvalsBadge = 0;
  private sub?: Subscription;

  groups: NavGroup[] = [
    { key: 'workspace', label: 'Workspace', items: [
      { label: 'Home',    icon: '🏠', route: '/home',          auth: 'in' },
      { label: 'Chat',    icon: '💬', route: '/chat',          auth: 'in' },
      { label: 'History', icon: '🕘', route: '/conversations', auth: 'in' },
    ]},
    { key: 'build', label: 'Build', items: [
      { label: 'My Agents', icon: '🤖', route: '/agents',    auth: 'in', roles: ['builder', 'admin'] },
      { label: 'Knowledge', icon: '📚', route: '/knowledge', auth: 'in', roles: ['builder', 'admin'] },
      { label: 'Tools',     icon: '🧰', route: '/tools',     auth: 'in', roles: ['builder', 'admin'] },
    ]},
    { key: 'operate', label: 'Operate', items: [
      { label: 'Approvals', icon: '✅', route: '/approvals', auth: 'in' },
      { label: 'Runs',      icon: '📈', route: '/runs',      auth: 'in', roles: ['builder', 'admin'] },
      { label: 'Usage',     icon: '📊', route: '/usage',     auth: 'in', roles: ['builder', 'admin'] },
    ]},
    { key: 'admin', label: 'Admin', items: [
      { label: 'Users',               icon: '👥', route: '/users',  auth: 'in', roles: ['admin'] },
      { label: 'Limits and Policies', icon: '🛡️', route: '/limits', auth: 'in', roles: ['admin'] },
      { label: 'Audit Log',           icon: '🧾', route: '/audit',  auth: 'in', roles: ['admin'] },
    ]},
    { key: 'account', label: 'Account', items: [
      { label: 'Login',   icon: '🔑', route: '/account', auth: 'out' },
      { label: 'Profile', icon: '👤', route: '/account', auth: 'in' },
      { label: 'Logout',  icon: '🚪', action: 'logout',  auth: 'in' },
    ]},
  ];

  constructor(private router: Router) {}

  // ---- Session state ------------------------------------------------
  // Replace these two getters with your RolesService when it is ready,
  // e.g. this.roles.role / this.roles.isSignedIn
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  // ---- Visibility (cosmetic only: the server must still check roles) --
  private canSee(i: NavItem): boolean {
    if (i.auth === 'out') return !this.signedIn;
    if (i.auth === 'in' && !this.signedIn) return false;
    if (i.roles && !i.roles.includes(this.role)) return false;
    return true;
  }

  // The menu is rebuilt ONLY when login state, role or the badge changes.
  // (Returning a brand-new array on every change-detection pass made Angular throw
  //  ExpressionChangedAfterItHasBeenChecked and rebuild the whole menu, which is what
  //  broke the drop-downs.)
  private cacheKey = '';
  private cache: NavGroup[] = [];

  get visibleGroups(): NavGroup[] {
    const key = `${this.signedIn}|${this.role}|${this.approvalsBadge}`;
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cache = this.groups
        .map(g => ({
          ...g,
          items: g.items
            .filter(i => this.canSee(i))
            .map(i => (i.route === '/approvals' ? { ...i, badge: this.approvalsBadge } : i))
        }))
        .filter(g => g.items.length > 0);
    }
    return this.cache;
  }

  trackGroup = (_: number, g: NavGroup) => g.key;
  trackItem = (_: number, i: NavItem) => i.label;

  // ---- Lifecycle -----------------------------------------------------
  ngOnInit(): void {
    this.syncOffset();
    this.openGroupForUrl(this.router.url);

    this.sub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        this.openGroupForUrl(e.urlAfterRedirects);
        this.closeDrawer();
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ---- Approvals badge -------------------------------------------------
  // Any page can update the count, e.g. after loading /approvals/list (it returns pendingCount):
  //   window.dispatchEvent(new CustomEvent('approvals-count', { detail: res.pendingCount }));
  @HostListener('window:approvals-count', ['$event'])
  onApprovalsCount(e: Event): void {
    const n = Number((e as CustomEvent).detail);
    this.approvalsBadge = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  // ---- Accordion: one group open at a time ---------------------------
  toggleGroup(key: string, ev?: Event): void {
    const opening = this.openGroup !== key;
    this.openGroup = opening ? key : '';

    // Make sure the group that just opened is never hidden below the fold of the sidebar
    if (opening && ev) {
      const el = (ev.currentTarget as HTMLElement | null)?.closest('.group');
      setTimeout(() => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
    }
  }

  private openGroupForUrl(url: string): void {
    const path = '/' + url.split('?')[0].split('#')[0].split('/').filter(Boolean)[0];
    const g = this.visibleGroups.find(x => x.items.some(i => i.route === path));
    if (g) this.openGroup = g.key;
  }

  // ---- Drawer (phones) -----------------------------------------------
  toggleDrawer(): void { this.drawerOpen = !this.drawerOpen; }
  closeDrawer(): void { this.drawerOpen = false; }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closeDrawer(); }

  @HostListener('window:resize')
  onResize(): void {
    this.syncOffset();
    if (window.innerWidth >= 992) this.closeDrawer();
  }

  // Publishes the sidebar width so pages never sit under the menu
  private syncOffset(): void {
    const offset = window.innerWidth >= 992 ? '260px' : '0px';
    document.documentElement.style.setProperty('--nav-content-offset', offset);
  }

  // ---- Logout --------------------------------------------------------
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    this.approvalsBadge = 0;
    this.openGroup = 'account';
    this.closeDrawer();
    this.router.navigate(['/account']);
  }
}