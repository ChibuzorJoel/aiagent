import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';

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
  private readonly allowedExt = ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'];

  private searchTimer: number | null = null;
  private toastTimer: number | null = null;
  private loadTimer: number | null = null;
  private indexTimers: number[] = [];

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
    this.indexTimers.forEach(t => window.clearTimeout(t));
    this.indexTimers = [];
  }

  /**
   * Replace the body with the real call: GET /knowledge/list
   * Always set this.loading = false (also on error). On { code: 'auth' } go to /account.
   */
  load(): void {
    this.loading = true;
    this.loadTimer = window.setTimeout(() => {
      this.loadTimer = null;
      this.sources = this.seed();
      this.loading = false;
      this.refresh();
    }, 500);
  }

  // Same ids and names as the Agents page (k1 to k4) and the agents that use them.
  private seed(): Source[] {
    const now = Date.now();
    const day = 24 * 3600000;
    return [
      { id: 'k1', name: 'Product price list.pdf', type: 'PDF', sizeBytes: 842000, status: 'ready',
        agents: ['Sales Assistant'], addedAt: new Date(now - 2 * day) },
      { id: 'k2', name: 'Customer enquiries 2026.docx', type: 'Word', sizeBytes: 1450000, status: 'ready',
        agents: ['Sales Assistant', 'Office Helper'], addedAt: new Date(now - 5 * day) },
      { id: 'k3', name: 'Leave and HR policy.pdf', type: 'PDF', sizeBytes: 392000, status: 'ready',
        agents: ['HR Guide'], addedAt: new Date(now - 9 * day) },
      { id: 'k4', name: 'Support FAQ (web page)', type: 'Web page', sizeBytes: null, status: 'ready',
        agents: ['Sales Assistant', 'HR Guide'], addedAt: new Date(now - 12 * day), url: 'https://example.com/support/faq' },
      { id: 'k5', name: 'Old brochure scan.png', type: 'Image', sizeBytes: 3100000, status: 'failed',
        agents: [], addedAt: new Date(now - 14 * day) },
    ];
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

  /**
   * Replace the indexing simulation with POST /knowledge/add (send the file),
   * then poll GET /knowledge/list (or use your stream) until status is ready or failed.
   * The server must also check type and size again.
   * (Mock tip: a file whose name contains "fail" ends in the Failed state.)
   */
  private addFiles(files: File[]): void {
    this.fileError = '';
    if (files.length === 0) { return; }

    if (files.length > this.maxFiles) {
      this.fileError = 'You can add up to ' + this.maxFiles + ' files at a time.';
      files = files.slice(0, this.maxFiles);
    }

    let added = 0;
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

      const source: Source = {
        id: this.uid(),
        name: f.name,
        type: this.typeFromExt(ext),
        sizeBytes: f.size,
        status: 'indexing',
        agents: [],
        addedAt: new Date()
      };
      this.sources.unshift(source);
      this.finishIndexing(source, f.name.toLowerCase().indexOf('fail') !== -1);
      added++;
    }

    if (added > 0) {
      this.pageNum = 1;
      this.refresh();
      this.showToast(added === 1 ? 'File added. Indexing has started.' : added + ' files added. Indexing has started.', 'ok');
    }
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

    const source: Source = {
      id: this.uid(),
      name: parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : ''),
      type: 'Web page',
      sizeBytes: null,
      status: 'indexing',
      agents: [],
      addedAt: new Date(),
      url: parsed.href
    };

    this.sources.unshift(source);
    this.finishIndexing(source, raw.toLowerCase().indexOf('fail') !== -1);
    input.value = '';
    this.pageNum = 1;
    this.refresh();
    this.showToast('Link added. Indexing has started.', 'ok');
  }

  // ---- Re-index ---------------------------------------------------------------------
  /** Replace with POST /knowledge/reindex { id } */
  reindex(s: Source): void {
    if (s.status === 'indexing') { return; }
    s.status = 'indexing';
    this.finishIndexing(s, false);
    this.refresh();
    this.showToast('Re-indexing started.', 'ok');
  }

  private finishIndexing(s: Source, willFail: boolean): void {
    const t = window.setTimeout(() => {
      s.status = willFail ? 'failed' : 'ready';
      this.indexTimers = this.indexTimers.filter(x => x !== t);
      this.refresh();
    }, 2500);
    this.indexTimers.push(t);
  }

  // ---- Delete -------------------------------------------------------------------------
  askDelete(s: Source): void {
    this.deleteTarget = s;
  }

  cancelDelete(): void {
    this.deleteTarget = null;
  }

  /** Replace with POST /knowledge/delete { id } */
  confirmDelete(): void {
    const target = this.deleteTarget;
    if (!target) { return; }

    this.sources = this.sources.filter(s => s.id !== target.id);
    this.deleteTarget = null;
    this.refresh();
    this.showToast('Source deleted.', 'ok');
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

  private typeFromExt(ext: string): SourceType {
    if (ext === 'pdf') { return 'PDF'; }
    if (ext === 'doc' || ext === 'docx') { return 'Word'; }
    if (ext === 'txt') { return 'Text'; }
    return 'Image';
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

  private uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}