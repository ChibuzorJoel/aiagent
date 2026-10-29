import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

type SourceType = 'PDF' | 'Word' | 'Text' | 'Image' | 'Web page';
type SourceStatus = 'indexing' | 'ready' | 'failed';

interface Source {
  id: string;
  name: string;
  type: SourceType;
  sizeBytes: number | null;     // null for web pages
  status: SourceStatus;
  agents: string[];             // names of agents that use it
  addedAt: Date;
  url?: string;
  error?: string;               // why indexing failed
}

interface Toast { text: string; kind: 'ok' | 'error'; }

@Component({
  selector: 'app-knowledge',
  templateUrl: './knowledge.component.html',
  styleUrls: ['./knowledge.component.scss']
})
export class KnowledgeComponent implements OnInit, OnDestroy {
  loading = true;

  sources: Source[] = [];
  filtered: Source[] = [];
  paged: Source[] = [];

  typeOptions: SourceType[] = ['PDF', 'Word', 'Text', 'Image', 'Web page'];

  // Upload state
  dragging = false;
  fileError = '';
  linkError = '';

  // Filters + paging
  searchText = '';
  typeFilter = 'all';
  statusFilter = 'all';
  pageNum = 1;
  readonly pageSize = 8;

  // Dialog + toast
  deleteTarget: Source | null = null;
  toast: Toast | null = null;

  private readonly maxFiles = 5;
  private readonly maxBytes = 10 * 1024 * 1024;
  private readonly allowedExt = ['pdf', 'docx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'webp'];

  private searchTimer: number | null = null;
  private toastTimer: number | null = null;
  private loadTimer: number | null = null;
  private pollTimer: number | null = null;
  private listSub?: Subscription;
  private busy = 0;                    // uploads and actions still in flight

  constructor(private api: ApiService) {}

  // ---- Session (swap for your RolesService when ready) -----------------
  // Cosmetic only: the server must check the role on every request.
  get role(): string {
    return localStorage.getItem('role') || 'member';
  }

  get canBuild(): boolean {
    return this.role === 'builder' || this.role === 'admin';
  }

  get hasFilters(): boolean {
    return this.searchText !== '' || this.typeFilter !== 'all' || this.statusFilter !== 'all';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  get readyCount(): number { return this.sources.filter(s => s.status === 'ready').length; }
  get indexingCount(): number { return this.sources.filter(s => s.status === 'indexing').length; }
  get failedCount(): number { return this.sources.filter(s => s.status === 'failed').length; }

  // ---- Lifecycle ----------------------------------------------------------
  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.clearTimer(this.searchTimer);
    this.clearTimer(this.toastTimer);
    this.clearTimer(this.loadTimer);
    this.clearTimer(this.pollTimer);
    this.listSub?.unsubscribe();
  }

  /** GET /knowledge/list (the server keeps only what this person may see) */
  load(silent = false): void {
    if (!silent) { this.loading = true; }
    this.listSub?.unsubscribe();
    this.listSub = this.api.get('/knowledge/list', { pageSize: 100 }).subscribe({
      next: (r: any) => {
        this.sources = (r.sources || []).map((k: any) => this.toSource(k));
        this.loading = false;
        this.refresh();
        this.pollIfIndexing();
      },
      error: (e: ApiError) => {
        this.loading = false;
        if (!silent) { this.showToast(e.message, 'error'); }
      }
    });
  }

  private toSource(k: any): Source {
    return {
      id: k.id,
      name: k.name,
      type: this.typeLabel(k.type),
      sizeBytes: k.type === 'web' ? null : (k.size || 0),
      status: k.status === 'Ready' ? 'ready' : k.status === 'Failed' ? 'failed' : 'indexing',
      agents: k.agents || [],
      addedAt: new Date(k.createdAt),
      url: k.url || undefined,
      error: k.error || undefined
    };
  }

  private typeLabel(t: string): SourceType {
    switch (t) {
      case 'pdf': return 'PDF';
      case 'docx': return 'Word';
      case 'text': return 'Text';
      case 'image': return 'Image';
      default: return 'Web page';
    }
  }

  /** While something is being indexed, look again every 2 seconds. */
  private pollIfIndexing(): void {
    this.clearTimer(this.pollTimer);
    this.pollTimer = null;
    if (!this.sources.some(s => s.status === 'indexing')) { return; }
    this.pollTimer = window.setTimeout(() => this.load(true), 2000);
  }

  // ---- Filtering, paging -----------------------------------------------------
  private refresh(): void {
    let list = this.sources.slice();
    const q = this.searchText;

    if (q) {
      list = list.filter(s =>
        s.name.toLowerCase().indexOf(q) !== -1 ||
        s.agents.some(a => a.toLowerCase().indexOf(q) !== -1));
    }
    if (this.typeFilter !== 'all') {
      list = list.filter(s => s.type === this.typeFilter);
    }
    if (this.statusFilter !== 'all') {
      list = list.filter(s => s.status === this.statusFilter);
    }

    list.sort((x, y) => y.addedAt.getTime() - x.addedAt.getTime());   // newest first
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

  onType(value: string): void {
    this.typeFilter = value || 'all';
    this.pageNum = 1;
    this.refresh();
  }

  onStatus(value: string): void {
    this.statusFilter = value || 'all';
    this.pageNum = 1;
    this.refresh();
  }

  clearFilters(q: HTMLInputElement, ty: HTMLSelectElement, st: HTMLSelectElement): void {
    this.clearTimer(this.searchTimer);
    q.value = '';
    ty.value = 'all';
    st.value = 'all';
    this.searchText = '';
    this.typeFilter = 'all';
    this.statusFilter = 'all';
    this.pageNum = 1;
    this.refresh();
  }

  goPage(n: number): void {
    this.pageNum = n;
    this.refresh();
  }

  // ---- Upload ------------------------------------------------------------------
  onFiles(input: HTMLInputElement): void {
    const picked = input.files ? Array.from(input.files) : [];
    input.value = '';                 // lets the same file be picked again
    this.addFiles(picked);
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragging = true;
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.dragging = false;
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging = false;
    const list = e.dataTransfer ? e.dataTransfer.files : null;
    if (list) {
      this.addFiles(Array.from(list));
    }
  }

  /** POST /knowledge/add (one file at a time). The server indexes in the background and we poll the list. */
  private addFiles(files: File[]): void {
    this.fileError = '';
    if (files.length === 0) { return; }

    if (files.length > this.maxFiles) {
      this.fileError = 'You can add up to ' + this.maxFiles + ' files at a time.';
      files = files.slice(0, this.maxFiles);
    }

    const ok: File[] = [];
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();

      if (this.allowedExt.indexOf(ext) === -1) {
        this.fileError = f.name + ' is not an allowed file type.';
        continue;
      }
      if (f.size > this.maxBytes) {
        this.fileError = f.name + ' is larger than 10 MB.';
        continue;
      }
      if (this.sources.some(s => s.name.toLowerCase() === f.name.toLowerCase())) {
        this.fileError = f.name + ' has already been added.';
        continue;
      }
      ok.push(f);
    }
    if (ok.length === 0) { return; }

    let added = 0;
    const next = (): void => {
      const f = ok.shift();
      if (!f) {
        this.busy--;
        if (added > 0) {
          this.pageNum = 1;
          this.showToast(added === 1 ? 'File added. Indexing has started.' : added + ' files added. Indexing has started.', 'ok');
        }
        this.load(true);
        return;
      }
      this.api.addKnowledgeFile(f).subscribe({
        next: () => { added++; next(); },
        error: (e: ApiError) => { this.fileError = f.name + ': ' + e.message; next(); }
      });
    };
    this.busy++;
    next();
  }

  // ---- Web link ---------------------------------------------------------------------
  /** Replace with POST /knowledge/add { url } */
  addLink(input: HTMLInputElement): void {
    this.linkError = '';
    const raw = (input.value || '').trim();

    if (!raw) {
      this.linkError = 'Please paste a web page address.';
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch (e) {
      this.linkError = 'That does not look like a valid address. Start with https://';
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      this.linkError = 'Only http and https links are allowed.';
      return;
    }
    if (this.sources.some(s => s.url === parsed.href)) {
      this.linkError = 'That page has already been added.';
      return;
    }

    this.api.addKnowledgeUrl(parsed.href).subscribe({
      next: () => {
        input.value = '';
        this.pageNum = 1;
        this.showToast('Link added. Indexing has started.', 'ok');
        this.load(true);
      },
      error: (e: ApiError) => { this.linkError = e.message; }
    });
  }

  // ---- Re-index ---------------------------------------------------------------------
  /** POST /knowledge/reindex { id } */
  reindex(s: Source): void {
    if (s.status === 'indexing') { return; }
    this.api.reindexKnowledge(s.id).subscribe({
      next: () => {
        s.status = 'indexing';
        this.refresh();
        this.showToast('Re-indexing started.', 'ok');
        this.load(true);
      },
      error: (e: ApiError) => this.showToast(e.message, 'error')
    });
  }

  // ---- Delete -------------------------------------------------------------------------
  askDelete(s: Source): void {
    this.deleteTarget = s;
  }

  cancelDelete(): void {
    this.deleteTarget = null;
  }

  /** POST /knowledge/delete { id } */
  confirmDelete(): void {
    const target = this.deleteTarget;
    if (!target) { return; }
    this.deleteTarget = null;

    this.api.deleteKnowledge(target.id).subscribe({
      next: () => {
        this.sources = this.sources.filter(s => s.id !== target.id);
        this.refresh();
        this.showToast('Source deleted.', 'ok');
      },
      error: (e: ApiError) => this.showToast(e.message, 'error')
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.deleteTarget) {
      this.cancelDelete();
    }
  }

  // ---- Helpers ---------------------------------------------------------------------------
  trackById(index: number, s: Source): string {
    return s.id;
  }

  plural(n: number, word: string): string {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  statusLabel(s: SourceStatus): string {
    return s === 'ready' ? 'Ready' : s === 'indexing' ? 'Indexing' : 'Failed';
  }

  icon(t: SourceType): string {
    switch (t) {
      case 'PDF': return '📕';
      case 'Word': return '📘';
      case 'Text': return '📄';
      case 'Image': return '🖼️';
      default: return '🌐';
    }
  }

  formatSize(bytes: number | null): string {
    if (bytes === null) { return '—'; }
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1024 * 1024) { return Math.round(bytes / 1024) + ' KB'; }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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