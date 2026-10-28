import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { forkJoin, of, Observable, Subscription } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

type AgentStatus = 'draft' | 'published';
type ToolMode = 'ask' | 'allowed';
type PanelTab = 'basics' | 'instructions' | 'knowledge' | 'tools' | 'test';
type StatusFilter = 'all' | AgentStatus;
type SortBy = 'new' | 'name';

interface ToolSetting {
  id: string;            // the tool key used by the server, e.g. "send_email"
  mode: ToolMode;
}

interface Agent {
  id: string;
  name: string;
  purpose: string;
  color: string;
  instructions: string;
  status: AgentStatus;
  knowledgeIds: string[];
  tools: ToolSetting[];
  toolsCount: number;
  knowledgeCount: number;
  ownerName: string;
  canEdit: boolean;      // false for published agents that belong to someone else
  updatedAt: Date;
}

interface AgentDraft {
  id: string | null;
  name: string;
  purpose: string;
  color: string;
  instructions: string;
  status: AgentStatus;
  knowledgeIds: string[];
  tools: ToolSetting[];
}

interface KnowledgeDoc { id: string; name: string; type: string; status: string; }
interface ToolInfo {
  id: string;
  name: string;
  description: string;
  sideEffects: boolean;
  connected: boolean;
  blocked: boolean;
}
interface TestMessage { role: 'user' | 'agent'; text: string; }
interface Toast { text: string; kind: 'ok' | 'error'; }

// ---- Shapes returned by the server ----
interface ServerAgent {
  id: string;
  name: string;
  purpose?: string;
  color?: string;
  status: AgentStatus;
  ownerName?: string;
  toolsCount?: number;
  knowledgeCount?: number;
  canEdit?: boolean;
  updatedAt: string;
  instructions?: string;
  knowledgeIds?: string[];
  tools?: { key: string; mode: string }[];
}
interface ServerKnowledge { id: string; name: string; type: string; status: string; }
interface ServerTool {
  key: string;
  name: string;
  description: string;
  readOnly: boolean;
  blocked: boolean;
  connected: boolean;
}

// Base URL of the API (matches PORT in the backend .env). Move this to
// environment.ts (environment.apiUrl) when you have one.
const API_URL = 'http://localhost:3000';

@Component({
  selector: 'app-agents',
  templateUrl: './agents.component.html',
  styleUrls: ['./agents.component.scss']
})
export class AgentsComponent implements OnInit, OnDestroy {
  @ViewChild('testScroll') testScroll?: ElementRef<HTMLElement>;

  loading = true;
  loadError = '';
  saving = false;
  deleting = false;

  // Data (GET /agents/list, /knowledge/list, /tools/list)
  agents: Agent[] = [];
  filtered: Agent[] = [];
  paged: Agent[] = [];

  knowledgeDocs: KnowledgeDoc[] = [];
  toolsCatalog: ToolInfo[] = [];

  colors: string[] = ['#14b8a6', '#4338ca', '#0f766e', '#0ea5e9', '#d97706', '#be185d', '#475569'];

  tabs: { key: PanelTab; label: string }[] = [
    { key: 'basics', label: 'Basics' },
    { key: 'instructions', label: 'Instructions' },
    { key: 'knowledge', label: 'Knowledge' },
    { key: 'tools', label: 'Tools' },
    { key: 'test', label: 'Test' },
  ];

  // Filters + paging
  searchText = '';
  statusFilter: StatusFilter = 'all';
  sortBy: SortBy = 'new';
  pageNum = 1;
  readonly pageSize = 6;

  // Panel
  panelOpen = false;
  panelTab: PanelTab = 'basics';
  submitted = false;
  draft: AgentDraft = this.blankDraft();

  // Test chat
  testMessages: TestMessage[] = [];
  testThinking = false;

  // Dialog + toast
  deleteTarget: Agent | null = null;
  toast: Toast | null = null;

  private subs = new Subscription();
  private testSub: Subscription | null = null;
  private searchTimer: number | null = null;
  private toastTimer: number | null = null;

  constructor(private http: HttpClient, private router: Router) {}

  // ---- Session (swap for your RolesService when ready) -----------------
  // Cosmetic only: the server checks the role on every request.
  get role(): string {
    return localStorage.getItem('role') || 'member';
  }

  get canBuild(): boolean {
    return this.role === 'builder' || this.role === 'admin';
  }

  get hasFilters(): boolean {
    return this.searchText !== '' || this.statusFilter !== 'all';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
  }

  // ---- Lifecycle --------------------------------------------------------
  ngOnInit(): void {
    if (this.canBuild) {
      this.load();
    } else {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.cancelTest();
    this.clearTimer(this.searchTimer);
    this.clearTimer(this.toastTimer);
  }

  /**
   * Loads the agents, the documents and the tools together.
   * If only the documents or tools fail, the page still works and shows a message.
   */
  load(): void {
    this.loading = true;
    this.loadError = '';

    this.subs.add(
      forkJoin({
        agents: this.http.get<{ agents: ServerAgent[] }>(`${API_URL}/agents/list`, { headers: this.authHeaders() }),
        knowledge: this.http
          .get<{ sources: ServerKnowledge[] }>(`${API_URL}/knowledge/list?pageSize=100`, { headers: this.authHeaders() })
          .pipe(catchError(() => of(null))),
        tools: this.http
          .get<{ tools: ServerTool[] }>(`${API_URL}/tools/list`, { headers: this.authHeaders() })
          .pipe(catchError(() => of(null)))
      }).subscribe({
        next: res => {
          this.agents = (res.agents.agents || []).map(a => this.fromServer(a));

          if (res.knowledge) {
            this.knowledgeDocs = (res.knowledge.sources || []).map(k => ({
              id: k.id, name: k.name, type: this.typeLabel(k.type), status: k.status
            }));
          }
          if (res.tools) {
            this.toolsCatalog = (res.tools.tools || []).map(t => ({
              id: t.key, name: t.name, description: t.description,
              sideEffects: !t.readOnly, connected: t.connected, blocked: t.blocked
            }));
          }

          this.loading = false;
          this.refresh();

          if (!res.knowledge || !res.tools) {
            this.showToast('Some documents or tools could not be loaded.', 'error');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.loading = false;
          if (this.handleAuthError(err)) { return; }
          this.loadError = this.messageFrom(err, 'We could not load your agents. Please try again.');
        }
      })
    );
  }

  // ---- Server <-> screen mapping -------------------------------------------
  private fromServer(s: ServerAgent): Agent {
    const tools: ToolSetting[] = (s.tools || []).map(t => ({
      id: t.key,
      mode: t.mode === 'allowed' ? 'allowed' as ToolMode : 'ask' as ToolMode
    }));
    const knowledgeIds = (s.knowledgeIds || []).map(String);

    return {
      id: s.id,
      name: s.name,
      purpose: s.purpose || '',
      color: s.color || '#4338ca',
      instructions: s.instructions || '',
      status: s.status === 'published' ? 'published' : 'draft',
      knowledgeIds,
      tools,
      toolsCount: s.toolsCount != null ? s.toolsCount : tools.length,
      knowledgeCount: s.knowledgeCount != null ? s.knowledgeCount : knowledgeIds.length,
      ownerName: s.ownerName || '',
      canEdit: !!s.canEdit,
      updatedAt: new Date(s.updatedAt)
    };
  }

  private payload(d: AgentDraft): Record<string, unknown> {
    return {
      name: d.name.trim(),
      purpose: d.purpose.trim(),
      color: d.color,
      instructions: d.instructions,
      knowledgeIds: d.knowledgeIds.slice(),
      tools: d.tools.map(t => ({ key: t.id, mode: t.mode }))
    };
  }

  private typeLabel(type: string): string {
    switch (type) {
      case 'pdf':   return 'PDF';
      case 'docx':  return 'Word';
      case 'text':  return 'Text file';
      case 'image': return 'Image';
      case 'web':   return 'Web page';
      default:      return type || 'File';
    }
  }

  // ---- Filtering, sorting, paging ---------------------------------------
  private refresh(): void {
    let list = this.agents.slice();
    const q = this.searchText;

    if (q) {
      list = list.filter(a =>
        a.name.toLowerCase().indexOf(q) !== -1 || a.purpose.toLowerCase().indexOf(q) !== -1);
    }
    if (this.statusFilter !== 'all') {
      list = list.filter(a => a.status === this.statusFilter);
    }

    if (this.sortBy === 'name') {
      list.sort((x, y) => x.name.localeCompare(y.name));
    } else {
      list.sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
    }

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

  onStatus(value: string): void {
    this.statusFilter = value === 'published' || value === 'draft' ? value : 'all';
    this.pageNum = 1;
    this.refresh();
  }

  onSort(value: string): void {
    this.sortBy = value === 'name' ? 'name' : 'new';
    this.pageNum = 1;
    this.refresh();
  }

  clearFilters(q: HTMLInputElement, st: HTMLSelectElement, so: HTMLSelectElement): void {
    this.clearTimer(this.searchTimer);
    q.value = '';
    st.value = 'all';
    so.value = 'new';
    this.searchText = '';
    this.statusFilter = 'all';
    this.sortBy = 'new';
    this.pageNum = 1;
    this.refresh();
  }

  goPage(n: number): void {
    this.pageNum = n;
    this.refresh();
  }

  // ---- Panel ------------------------------------------------------------
  private blankDraft(): AgentDraft {
    return {
      id: null, name: '', purpose: '', color: '#14b8a6', instructions: '',
      status: 'draft', knowledgeIds: [], tools: []
    };
  }

  openNew(): void {
    this.draft = this.blankDraft();
    this.openPanel();
  }

  openEdit(a: Agent): void {
    if (!a.canEdit) {
      this.showToast('Only the owner can change this agent.', 'error');
      return;
    }
    this.draft = {
      id: a.id,
      name: a.name,
      purpose: a.purpose,
      color: a.color,
      instructions: a.instructions,
      status: a.status,
      knowledgeIds: a.knowledgeIds.slice(),
      tools: a.tools.map(t => ({ id: t.id, mode: t.mode }))
    };
    this.openPanel();
  }

  private openPanel(): void {
    this.panelTab = 'basics';
    this.submitted = false;
    this.testMessages = [];
    this.testThinking = false;
    this.panelOpen = true;
  }

  closePanel(): void {
    this.cancelTest();
    this.testMessages = [];
    this.panelOpen = false;
  }

  setTab(key: PanelTab): void {
    this.panelTab = key;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.deleteTarget) {
      this.cancelDelete();
    } else if (this.panelOpen && !this.saving) {
      this.closePanel();
    }
  }

  // ---- Knowledge + tools selection ----------------------------------------
  hasDoc(id: string): boolean {
    return this.draft.knowledgeIds.indexOf(id) !== -1;
  }

  /** A document can be ticked only when it is Ready (or it is already ticked, so it can be unticked). */
  docDisabled(d: KnowledgeDoc): boolean {
    return d.status !== 'Ready' && !this.hasDoc(d.id);
  }

  toggleDoc(id: string): void {
    const i = this.draft.knowledgeIds.indexOf(id);
    if (i === -1) {
      this.draft.knowledgeIds.push(id);
    } else {
      this.draft.knowledgeIds.splice(i, 1);
    }
  }

  toolSetting(id: string): ToolSetting | undefined {
    return this.draft.tools.find(t => t.id === id);
  }

  toolMode(id: string): ToolMode {
    const s = this.toolSetting(id);
    return s ? s.mode : 'ask';
  }

  /** A tool that is blocked by an admin or not connected can only be unticked. */
  toolDisabled(t: ToolInfo): boolean {
    return (t.blocked || !t.connected) && !this.toolSetting(t.id);
  }

  toolNote(t: ToolInfo): string {
    if (t.blocked) { return 'Blocked by an admin.'; }
    if (!t.connected) { return 'Not connected yet. Ask an admin or builder to connect it on the Tools page.'; }
    return '';
  }

  toggleTool(id: string): void {
    const i = this.draft.tools.findIndex(t => t.id === id);
    if (i === -1) {
      this.draft.tools.push({ id, mode: 'ask' });     // safe default: ask first
    } else {
      this.draft.tools.splice(i, 1);
    }
  }

  setToolMode(id: string, value: string): void {
    const s = this.toolSetting(id);
    if (s) {
      s.mode = value === 'allowed' ? 'allowed' : 'ask';
    }
  }

  // ---- Save ---------------------------------------------------------------
  /**
   * POST /agents/create or /agents/update, then POST /agents/publish when the status has to change.
   * The optional argument saves and changes the status in one step.
   */
  save(newStatus?: AgentStatus): void {
    if (this.saving) { return; }
    this.submitted = true;

    if (!this.draft.name.trim()) {
      this.panelTab = 'basics';
      this.showToast('Please give the agent a name.', 'error');
      return;
    }

    if (newStatus) {
      this.draft.status = newStatus;
    }

    if (this.draft.status === 'published' && !this.draft.instructions.trim()) {
      this.draft.status = 'draft';
      this.panelTab = 'instructions';
      this.showToast('Add instructions before publishing.', 'error');
      return;
    }

    const wanted: AgentStatus = this.draft.status;
    const existing = this.draft.id ? this.agents.find(a => a.id === this.draft.id) : undefined;
    const body: Record<string, unknown> = this.payload(this.draft);

    let save$: Observable<{ agent: ServerAgent }>;
    let currentStatus: AgentStatus;

    if (this.draft.id) {
      save$ = this.http.post<{ agent: ServerAgent }>(
        `${API_URL}/agents/update`, { ...body, id: this.draft.id }, { headers: this.authHeaders() });
      currentStatus = existing ? existing.status : 'draft';
    } else {
      save$ = this.http.post<{ agent: ServerAgent }>(
        `${API_URL}/agents/create`, body, { headers: this.authHeaders() });
      currentStatus = 'draft';                      // new agents always start as drafts
    }

    this.saving = true;
    let publishFailed = '';

    this.subs.add(
      save$.pipe(
        switchMap(res => {
          if (wanted === currentStatus) { return of(res); }
          return this.http.post<{ agent: ServerAgent }>(
            `${API_URL}/agents/publish`,
            { id: res.agent.id, published: wanted === 'published' },
            { headers: this.authHeaders() }
          ).pipe(
            catchError((err: HttpErrorResponse) => {
              // The content was saved; only the status change failed.
              publishFailed = this.messageFrom(err, 'The agent was saved, but its status could not be changed.');
              return of(res);
            })
          );
        })
      ).subscribe({
        next: res => {
          this.saving = false;
          const saved = this.fromServer(res.agent);

          const index = this.agents.findIndex(a => a.id === saved.id);
          if (index === -1) {
            this.agents.unshift(saved);
          } else {
            this.agents[index] = saved;
          }

          this.closePanel();
          this.refresh();

          if (publishFailed) {
            this.showToast(publishFailed, 'error');
          } else {
            this.showToast(saved.status === 'published' ? 'Agent saved and published.' : 'Agent saved.', 'ok');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.saving = false;
          if (this.handleAuthError(err)) { return; }
          this.showToast(this.messageFrom(err, 'We could not save the agent. Please try again.'), 'error');
        }
      })
    );
  }

  // ---- Publish / unpublish from a card ------------------------------------
  /** POST /agents/publish { id, published } */
  togglePublish(a: Agent): void {
    if (!a.canEdit) { return; }

    if (a.status === 'draft' && !a.instructions.trim()) {
      this.showToast('Add instructions before publishing.', 'error');
      this.openEdit(a);
      this.panelTab = 'instructions';
      return;
    }

    const publish = a.status !== 'published';
    this.subs.add(
      this.http.post<{ agent: ServerAgent }>(
        `${API_URL}/agents/publish`, { id: a.id, published: publish }, { headers: this.authHeaders() }
      ).subscribe({
        next: res => {
          const updated = this.fromServer(res.agent);
          const index = this.agents.findIndex(x => x.id === updated.id);
          if (index !== -1) { this.agents[index] = updated; }
          this.refresh();
          this.showToast(updated.status === 'published' ? 'Agent published.' : 'Agent unpublished.', 'ok');
        },
        error: (err: HttpErrorResponse) => {
          if (this.handleAuthError(err)) { return; }
          this.showToast(this.messageFrom(err, 'We could not change the status. Please try again.'), 'error');
        }
      })
    );
  }

  // ---- Delete ----------------------------------------------------------------
  askDelete(a: Agent): void {
    if (!a.canEdit) { return; }
    this.deleteTarget = a;
  }

  cancelDelete(): void {
    if (this.deleting) { return; }
    this.deleteTarget = null;
  }

  /** POST /agents/delete { id } */
  confirmDelete(): void {
    const target = this.deleteTarget;
    if (!target || this.deleting) { return; }

    this.deleting = true;
    this.subs.add(
      this.http.post(`${API_URL}/agents/delete`, { id: target.id }, { headers: this.authHeaders() }).subscribe({
        next: () => {
          this.deleting = false;
          this.agents = this.agents.filter(a => a.id !== target.id);
          if (this.panelOpen && this.draft.id === target.id) {
            this.closePanel();
          }
          this.deleteTarget = null;
          this.refresh();
          this.showToast('Agent deleted.', 'ok');
        },
        error: (err: HttpErrorResponse) => {
          this.deleting = false;
          this.deleteTarget = null;
          if (this.handleAuthError(err)) { return; }
          this.showToast(this.messageFrom(err, 'We could not delete the agent. Please try again.'), 'error');
        }
      })
    );
  }

  // ---- Test chat ---------------------------------------------------------------
  /**
   * POST /agents/test: tries the UNSAVED draft. Nothing is stored and tools only do a dry run.
   */
  sendTest(input: HTMLInputElement): void {
    const text = (input.value || '').trim();
    if (!text || this.testThinking) { return; }

    const history = this.testMessages.slice();     // messages before this one
    this.testMessages.push({ role: 'user', text });
    input.value = '';
    this.testThinking = true;
    this.scrollTest();

    const body = {
      ...this.payload(this.draft),
      messages: history.concat([{ role: 'user', text }]).map(m => ({ role: m.role, text: m.text }))
    };

    this.cancelTest();
    this.testThinking = true;
    this.testSub = this.http.post<{ reply: string; tools: { name: string; ms: number; ok: boolean }[] }>(
      `${API_URL}/agents/test`, body, { headers: this.authHeaders() }
    ).subscribe({
      next: res => {
        this.testSub = null;
        this.testMessages.push({ role: 'agent', text: res.reply });
        this.testThinking = false;
        this.scrollTest();
      },
      error: (err: HttpErrorResponse) => {
        this.testSub = null;
        this.testThinking = false;
        if (this.handleAuthError(err)) { return; }
        this.testMessages.push({
          role: 'agent',
          text: this.messageFrom(err, 'The test could not finish. Please try again.')
        });
        this.scrollTest();
      }
    });
  }

  private cancelTest(): void {
    if (this.testSub) {
      this.testSub.unsubscribe();
      this.testSub = null;
    }
    this.testThinking = false;
  }

  private scrollTest(): void {
    window.setTimeout(() => {
      const el = this.testScroll ? this.testScroll.nativeElement : null;
      if (el) { el.scrollTop = el.scrollHeight; }
    }, 0);
  }

  // ---- Helpers --------------------------------------------------------------------
  trackById(index: number, a: Agent): string {
    return a.id;
  }

  initial(name: string): string {
    const n = (name || '').trim();
    return n ? n.charAt(0).toUpperCase() : '?';
  }

  plural(n: number, word: string): string {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
  }

  /**
   * The server answers 401 { code: "auth" } when the token is missing or expired.
   * Sends the person to the sign-in page and brings them back here afterwards.
   */
  private handleAuthError(err: HttpErrorResponse): boolean {
    if (err.status === 401 || (err.error && err.error.code === 'auth')) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('profile');
      this.router.navigate(['/account'], { queryParams: { returnUrl: this.router.url } });
      return true;
    }
    return false;
  }

  /** Turns any HTTP failure into a friendly message for the screen. */
  private messageFrom(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 0) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    if (err.error && typeof err.error.message === 'string' && err.error.message) {
      return err.error.message;
    }
    if (err.status === 429) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (err.status === 403) {
      return 'You do not have access to do this.';
    }
    if (err.status >= 500) {
      return 'Something went wrong on our side. Please try again shortly.';
    }
    return fallback;
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