
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';

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
  }

  /**
   * Replace the body with the real call: GET /tool/list
   * Always set this.loading = false (also on error). On { code: 'auth' } go to /account.
   */
  load(): void {
    this.loading = true;
    this.loadTimer = window.setTimeout(() => {
      this.loadTimer = null;
      this.tools = this.seed();
      this.loading = false;
    }, 500);
  }

  // Same ids and names as the Agents page (t1 to t4). usedBy matches the sample agents there.
  private seed(): Tool[] {
    return [
      {
        id: 't1', name: 'Search the knowledge base', icon: '🔎', sideEffects: false,
        description: 'Finds answers inside the documents an agent is allowed to read.',
        abilities: ['Searches all ticked documents and web pages', 'Returns the passages it used, with the source name'],
        connected: true, usedBy: 2, busy: false, testing: false, lastTest: null
      },
      {
        id: 't2', name: 'Read the database', icon: '🗄️', sideEffects: false,
        description: 'Looks up records. It can only read, never change anything.',
        abilities: ['Reads enquiries, customers and orders', 'Read-only access'],
        connected: true, usedBy: 1, busy: false, testing: false, lastTest: null
      },
      {
        id: 't3', name: 'Send e-mail', icon: '✉️', sideEffects: true,
        description: 'Sends a message to a person outside the system.',
        abilities: ['Sends an e-mail on behalf of the agent', 'Always shows you the message before it is sent'],
        connected: true, usedBy: 2, busy: false, testing: false, lastTest: null
      },
      {
        id: 't4', name: 'Create a record', icon: '📝', sideEffects: true,
        description: 'Adds a new record to the database.',
        abilities: ['Creates enquiries, notes and tasks', 'Shows the new record before it is saved'],
        connected: false, usedBy: 0, busy: false, testing: false, lastTest: null
      },
    ];
  }

  // ---- Connect ---------------------------------------------------------------
  /** Replace the simulation with POST /tool/connect { id } */
  connect(t: Tool): void {
    if (t.busy) { return; }
    t.busy = true;

    this.later(() => {
      t.connected = true;
      t.busy = false;
      this.showToast(t.name + ' connected.', 'ok');
    }, 700);
  }

  // ---- Disconnect ------------------------------------------------------------
  askDisconnect(t: Tool): void {
    this.disconnectTarget = t;
  }

  cancelDisconnect(): void {
    this.disconnectTarget = null;
  }

  /** Replace the simulation with POST /tool/disconnect { id } */
  confirmDisconnect(): void {
    const t = this.disconnectTarget;
    if (!t) { return; }
    this.disconnectTarget = null;
    t.busy = true;

    this.later(() => {
      t.connected = false;
      t.busy = false;
      t.lastTest = null;
      this.showToast(t.name + ' disconnected.', 'ok');
    }, 500);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.disconnectTarget) {
      this.cancelDisconnect();
    }
  }

  // ---- Test -------------------------------------------------------------------
  /**
   * Replace the simulation with POST /tool/test { id } and show the result it returns.
   * Tools with side effects must run as a dry run on the server, so testing never
   * sends or changes anything. On error set lastTest = { ok: false, text: <message>, at: new Date() }.
   */
  test(t: Tool): void {
    if (!t.connected || t.testing || t.busy) { return; }
    t.testing = true;

    this.later(() => {
      t.lastTest = this.mockResult(t);
      t.testing = false;
    }, 1100);
  }

  private mockResult(t: Tool): ToolTest {
    const at = new Date();
    switch (t.id) {
      case 't1': return { ok: true, at, text: 'Found 3 matching passages across 4 documents (0.9 s).' };
      case 't2': return { ok: true, at, text: 'Connected. Read 12 records from the enquiries table (read-only).' };
      case 't3': return { ok: true, at, text: 'Test message prepared. Nothing was sent.' };
      default:   return { ok: true, at, text: 'Dry run passed. No record was created.' };
    }
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