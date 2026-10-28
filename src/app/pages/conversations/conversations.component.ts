import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';

interface Conversation {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  color: string;
  lastMessage: string;
  messageCount: number;
  updatedAt: Date;
}

interface AgentOption { id: string; name: string; }
interface Toast { text: string; kind: 'ok' | 'error'; }

@Component({
  selector: 'app-conversations',
  templateUrl: './conversations.component.html',
  styleUrls: ['./conversations.component.scss']
})
export class ConversationsComponent implements OnInit, OnDestroy {
  @ViewChild('renameIn') renameInput?: ElementRef<HTMLInputElement>;

  loading = true;

  conversations: Conversation[] = [];
  filtered: Conversation[] = [];
  paged: Conversation[] = [];

  // Same ids and names as the Home, Chat and Agents pages.
  // Replace with GET /agent/list when you connect the backend.
  agentOptions: AgentOption[] = [
    { id: 'a1', name: 'Sales Assistant' },
    { id: 'a2', name: 'Office Helper' },
    { id: 'a3', name: 'HR Guide' },
  ];

  // Filters + paging
  searchText = '';
  agentFilter = 'all';
  pageNum = 1;
  readonly pageSize = 8;

  // Dialogs + toast
  renameTarget: Conversation | null = null;
  renameText = '';
  renameError = '';
  deleteTarget: Conversation | null = null;
  toast: Toast | null = null;

  private searchTimer: number | null = null;
  private toastTimer: number | null = null;
  private loadTimer: number | null = null;

  constructor(private router: Router) {}

  // ---- Getters ----------------------------------------------------------
  get hasFilters(): boolean {
    return this.searchText !== '' || this.agentFilter !== 'all';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  // ---- Lifecycle --------------------------------------------------------
  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.clearTimer(this.searchTimer);
    this.clearTimer(this.toastTimer);
    this.clearTimer(this.loadTimer);
  }

  /**
   * Replace the body with the real call: GET /conversation/list
   * (the server must return only the signed-in person's own conversations).
   * Always set this.loading = false, also on error. On { code: 'auth' } go to /account.
   */
  load(): void {
    this.loading = true;
    this.loadTimer = window.setTimeout(() => {
      this.loadTimer = null;
      this.conversations = this.seed();
      this.loading = false;
      this.refresh();
    }, 500);
  }

  private seed(): Conversation[] {
    const now = Date.now();
    const hour = 3600000;
    const day = 24 * hour;
    return [
      { id: 'c1', title: "Summarise last week's enquiries", agentId: 'a1', agentName: 'Sales Assistant', color: '#14b8a6',
        lastMessage: 'Here is the summary of last week\'s enquiries.', messageCount: 6, updatedAt: new Date(now - 2 * hour) },
      { id: 'c2', title: 'Draft a reply to the supplier', agentId: 'a2', agentName: 'Office Helper', color: '#4338ca',
        lastMessage: 'I have prepared the email for you.', messageCount: 4, updatedAt: new Date(now - 1 * day) },
      { id: 'c3', title: 'Find the leave policy', agentId: 'a3', agentName: 'HR Guide', color: '#0f766e',
        lastMessage: 'Staff may take up to 20 days of annual leave.', messageCount: 3, updatedAt: new Date(now - 3 * day) },
      { id: 'c4', title: 'Price list for new customers', agentId: 'a1', agentName: 'Sales Assistant', color: '#14b8a6',
        lastMessage: 'The updated price list is in the attached document.', messageCount: 8, updatedAt: new Date(now - 4 * day) },
      { id: 'c5', title: 'Meeting notes summary', agentId: 'a2', agentName: 'Office Helper', color: '#4338ca',
        lastMessage: 'Three action points were agreed.', messageCount: 5, updatedAt: new Date(now - 6 * day) },
      { id: 'c6', title: 'Onboarding checklist', agentId: 'a3', agentName: 'HR Guide', color: '#0f766e',
        lastMessage: 'Here is the checklist for a new starter.', messageCount: 7, updatedAt: new Date(now - 9 * day) },
      { id: 'c7', title: 'Follow up with open leads', agentId: 'a1', agentName: 'Sales Assistant', color: '#14b8a6',
        lastMessage: 'Five leads have not replied in over a week.', messageCount: 10, updatedAt: new Date(now - 12 * day) },
      { id: 'c8', title: 'Rewrite the welcome message', agentId: 'a2', agentName: 'Office Helper', color: '#4338ca',
        lastMessage: 'Here is a friendlier version.', messageCount: 2, updatedAt: new Date(now - 15 * day) },
      { id: 'c9', title: 'Public holiday dates', agentId: 'a3', agentName: 'HR Guide', color: '#0f766e',
        lastMessage: 'The office is closed on these dates.', messageCount: 2, updatedAt: new Date(now - 20 * day) },
    ];
  }

  // ---- Filtering, sorting, paging ----------------------------------------
  private refresh(): void {
    let list = this.conversations.slice();
    const q = this.searchText;

    if (q) {
      list = list.filter(c =>
        c.title.toLowerCase().indexOf(q) !== -1 ||
        c.agentName.toLowerCase().indexOf(q) !== -1 ||
        c.lastMessage.toLowerCase().indexOf(q) !== -1);
    }
    if (this.agentFilter !== 'all') {
      list = list.filter(c => c.agentId === this.agentFilter);
    }

    // newest first
    list.sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
    this.filtered = list;

    const pages = Math.max(1, Math.ceil(list.length / this.pageSize));
    if (this.pageNum > pages) { this.pageNum = pages; }
    if (this.pageNum < 1) { this.pageNum = 1; }

    const start = (this.pageNum - 1) * this.pageSize;
    this.paged = list.slice(start, start + this.pageSize);
  }

  onSearch(value: string): void {
    this.clearTimer(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      this.searchText = (value || '').trim().toLowerCase();
      this.pageNum = 1;
      this.refresh();
    }, 250);
  }

  onAgent(value: string): void {
    this.agentFilter = value || 'all';
    this.pageNum = 1;
    this.refresh();
  }

  clearFilters(q: HTMLInputElement, ag: HTMLSelectElement): void {
    this.clearTimer(this.searchTimer);
    q.value = '';
    ag.value = 'all';
    this.searchText = '';
    this.agentFilter = 'all';
    this.pageNum = 1;
    this.refresh();
  }

  goPage(n: number): void {
    this.pageNum = n;
    this.refresh();
  }

  // ---- Navigation ---------------------------------------------------------
  open(c: Conversation): void {
    this.router.navigate(['/chat'], { queryParams: { agent: c.agentId, id: c.id } });
  }

  newChat(): void {
    this.router.navigate(['/chat']);
  }

  // ---- Rename -----------------------------------------------------------------
  askRename(c: Conversation): void {
    this.renameTarget = c;
    this.renameText = c.title;
    this.renameError = '';
    window.setTimeout(() => {
      const el = this.renameInput ? this.renameInput.nativeElement : null;
      if (el) { el.focus(); el.select(); }
    }, 0);
  }

  cancelRename(): void {
    this.renameTarget = null;
    this.renameText = '';
    this.renameError = '';
  }

  /** Replace with POST /conversation/rename { id, title } */
  saveRename(): void {
    const target = this.renameTarget;
    if (!target) { return; }

    const title = this.renameText.trim();
    if (!title) {
      this.renameError = 'Please enter a title.';
      return;
    }

    target.title = title.slice(0, 80);
    this.cancelRename();
    this.refresh();
    this.showToast('Conversation renamed.', 'ok');
  }

  // ---- Delete ------------------------------------------------------------------
  askDelete(c: Conversation): void {
    this.deleteTarget = c;
  }

  cancelDelete(): void {
    this.deleteTarget = null;
  }

  /** Replace with POST /conversation/delete { id } */
  confirmDelete(): void {
    const target = this.deleteTarget;
    if (!target) { return; }

    this.conversations = this.conversations.filter(c => c.id !== target.id);
    this.deleteTarget = null;
    this.refresh();
    this.showToast('Conversation deleted.', 'ok');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.deleteTarget) {
      this.cancelDelete();
    } else if (this.renameTarget) {
      this.cancelRename();
    }
  }

  // ---- Helpers -------------------------------------------------------------------
  trackById(index: number, c: Conversation): string {
    return c.id;
  }

  initial(name: string): string {
    const n = (name || '').trim();
    return n ? n.charAt(0).toUpperCase() : '?';
  }

  plural(n: number, word: string): string {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  when(d: Date): string {
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) { return 'Just now'; }
    if (min < 60) { return min + (min === 1 ? ' minute ago' : ' minutes ago'); }
    const hrs = Math.floor(min / 60);
    if (hrs < 24) { return hrs + (hrs === 1 ? ' hour ago' : ' hours ago'); }
    const days = Math.floor(hrs / 24);
    if (days === 1) { return 'Yesterday'; }
    if (days < 7) { return days + ' days ago'; }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private showToast(text: string, kind: 'ok' | 'error'): void {
    this.clearTimer(this.toastTimer);
    this.toast = { text, kind };
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, 3000);
  }

  private clearTimer(id: number | null): void {
    if (id !== null) {
      window.clearTimeout(id);
    }
  }
}