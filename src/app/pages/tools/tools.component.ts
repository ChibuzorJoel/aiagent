
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

interface ToolTest {
  ok: boolean;
  text: string;
  at: Date;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  abilities: string[];
  icon: string;
  sideEffects: boolean;        // true = changes or sends data, so it needs approval
  connected: boolean;
  usedBy: number;              // number of agents using it
  busy: boolean;               // connecting or disconnecting
  testing: boolean;
  lastTest: ToolTest | null;
}

interface Toast { text: string; kind: 'ok' | 'error'; }

@Component({
  selector: 'app-tools',
  templateUrl: './tools.component.html',
  styleUrls: ['./tools.component.scss']
})
export class ToolsComponent implements OnInit, OnDestroy {
  loading = true;
  tools: Tool[] = [];

  disconnectTarget: Tool | null = null;
  toast: Toast | null = null;

  private toastTimer: number | null = null;
  private loadTimer: number | null = null;
  private timers: number[] = [];
  private listSub?: Subscription;

  constructor(private api: ApiService) {}

  // ---- Session (swap for your RolesService when ready) -----------------
  // Cosmetic only: the server must check the role on every request.
  get role(): string {
    return localStorage.getItem('role') || 'member';
  }

  get canBuild(): boolean {
    return this.role === 'builder' || this.role === 'admin';
  }

  get connectedCount(): number {
    return this.tools.filter(t => t.connected).length;
  }

  // ---- Lifecycle ----------------------------------------------------------
  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.toastTimer !== null) { window.clearTimeout(this.toastTimer); }
    if (this.loadTimer !== null) { window.clearTimeout(this.loadTimer); }
    this.timers.forEach(t => window.clearTimeout(t));
    this.timers = [];
    this.listSub?.unsubscribe();
  }

  /** GET /tools/list */
  load(): void {
    this.loading = true;
    this.listSub?.unsubscribe();
    this.listSub = this.api.tools().subscribe({
      next: (r: any) => {
        this.tools = (r.tools || []).map((t: any) => this.toTool(t));
        this.loading = false;
      },
      error: (e: ApiError) => {
        this.loading = false;
        this.showToast(e.message, 'error');
      }
    });
  }

  // How each tool looks on the page (the server only knows the name and the rules)
  private readonly look: { [key: string]: { icon: string; abilities: string[] } } = {
    search_knowledge: { icon: '🔎', abilities: ['Searches all ticked documents and web pages', 'Returns the passages it used, with the source name'] },
    get_current_time: { icon: '🕒', abilities: ['Tells the agent the current date and time', 'Read-only, no side effects'] },
    send_email:       { icon: '✉️', abilities: ['Sends an e-mail on behalf of the agent', 'Asks for approval before it is sent'] },
    create_record:    { icon: '📝', abilities: ['Creates notes, enquiries and tasks', 'Asks for approval before it is saved'] }
  };

  private toTool(t: any): Tool {
    const look = this.look[t.key] || { icon: '🧩', abilities: [t.readOnly ? 'Read-only, no side effects' : 'Changes or sends data, so it asks for approval'] };
    return {
      id: t.key,
      name: t.name,
      description: t.description,
      abilities: look.abilities,
      icon: look.icon,
      sideEffects: !t.readOnly,
      connected: !!t.connected,
      usedBy: t.usedBy || 0,
      busy: false,
      testing: false,
      lastTest: null
    };
  }

  // ---- Connect ---------------------------------------------------------------
  /** POST /tools/connect { key } */
  connect(t: Tool): void {
    if (t.busy) { return; }
    t.busy = true;

    this.api.connectTool(t.id).subscribe({
      next: () => {
        t.connected = true;
        t.busy = false;
        this.showToast(t.name + ' connected.', 'ok');
      },
      error: (e: ApiError) => {
        t.busy = false;
        this.showToast(e.message, 'error');
      }
    });
  }

  // ---- Disconnect ------------------------------------------------------------
  askDisconnect(t: Tool): void {
    this.disconnectTarget = t;
  }

  cancelDisconnect(): void {
    this.disconnectTarget = null;
  }

  /** POST /tools/disconnect { key } */
  confirmDisconnect(): void {
    const t = this.disconnectTarget;
    if (!t) { return; }
    this.disconnectTarget = null;
    t.busy = true;

    this.api.disconnectTool(t.id).subscribe({
      next: () => {
        t.connected = false;
        t.busy = false;
        t.lastTest = null;
        this.showToast(t.name + ' disconnected.', 'ok');
      },
      error: (e: ApiError) => {
        t.busy = false;
        this.showToast(e.message, 'error');
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.disconnectTarget) {
      this.cancelDisconnect();
    }
  }

  // ---- Test -------------------------------------------------------------------
  /** POST /tools/test { key }: a dry run, so nothing is sent or changed. */
  test(t: Tool): void {
    if (!t.connected || t.testing || t.busy) { return; }
    t.testing = true;

    this.api.testTool(t.id).subscribe({
      next: (r: any) => {
        t.lastTest = { ok: !!r.ok, text: String(r.result || (r.ok ? 'Test passed.' : 'Test failed.')), at: new Date() };
        t.testing = false;
      },
      error: (e: ApiError) => {
        t.lastTest = { ok: false, text: e.message, at: new Date() };
        t.testing = false;
      }
    });
  }

  // ---- Helpers -----------------------------------------------------------------
  trackById(index: number, t: Tool): string {
    return t.id;
  }

  plural(n: number, word: string): string {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter(x => x !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }

  private showToast(text: string, kind: 'ok' | 'error'): void {
    if (this.toastTimer !== null) { window.clearTimeout(this.toastTimer); }
    this.toast = { text, kind };
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, 3000);
  }
}