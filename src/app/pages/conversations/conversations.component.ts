import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

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

  // Filled from GET /agents/list
  agentOptions: AgentOption[] = [];

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

  private listSub?: Subscription;

  constructor(private router: Router, private api: ApiService) {}

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
    this.listSub?.unsubscribe();
  }

  /** GET /conversations/list (the server returns only this person's own conversations) and GET /agents/list */
  load(): void {
    this.loading = true;
    this.listSub?.unsubscribe();

    this.listSub = this.api.get('/conversations/list', { pageSize: 100 }).subscribe({
      next: (r: any) => {
        this.conversations = (r.conversations || []).map((c: any): Conversation => ({
          id: c.id,
          title: c.title,
          agentId: c.agentId,
          agentName: c.agentName,
          color: c.color || '#4338ca',
          lastMessage: c.lastMessage || '',
          messageCount: c.messageCount || 0,
          updatedAt: new Date(c.updatedAt)
        }));

        // the agents in the filter: the ones that appear in the conversations
        const seen = new Map<string, string>();
        this.conversations.forEach(c => { if (!seen.has(c.agentId)) { seen.set(c.agentId, c.agentName); } });
        this.agentOptions = Array.from(seen.entries()).map(([id, name]) => ({ id, name }));

        this.loading = false;
        this.refresh();
      },
      error: (e: ApiError) => {
        this.loading = false;
        this.showToast(e.message, 'error');
      }
    });
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

  /** POST /conversations/rename { id, title } */
  saveRename(): void {
    const target = this.renameTarget;
    if (!target) { return; }

    const title = this.renameText.trim();
    if (!title) {
      this.renameError = 'Please enter a title.';
      return;
    }

    this.api.renameConversation(target.id, title.slice(0, 80)).subscribe({
      next: (r: any) => {
        target.title = (r && r.title) || title.slice(0, 80);
        this.cancelRename();
        this.refresh();
        this.showToast('Conversation renamed.', 'ok');
      },
      error: (e: ApiError) => { this.renameError = e.message; }
    });
  }

  // ---- Delete ------------------------------------------------------------------
  askDelete(c: Conversation): void {
    this.deleteTarget = c;
  }

  cancelDelete(): void {
    this.deleteTarget = null;
  }

  /** POST /conversations/delete { id } */
  confirmDelete(): void {
    const target = this.deleteTarget;
    if (!target) { return; }
    this.deleteTarget = null;

    this.api.deleteConversation(target.id).subscribe({
      next: () => {
        this.conversations = this.conversations.filter(c => c.id !== target.id);
        this.refresh();
        this.showToast('Conversation deleted.', 'ok');
      },
      error: (e: ApiError) => this.showToast(e.message, 'error')
    });
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