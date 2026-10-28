import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from 'src/app/core/api.service';
import { BadgeService } from 'src/app/core/badge.service';
import { ChatStreamService } from 'src/app/core/chat-stream.service';
import { ApiError, ChatEvent } from 'src/app/core/models';

interface AgentOption {
  id: string;
  name: string;
  purpose: string;
  color: string;
  knowledge: number;
}

interface ToolUse { name: string; seconds: number; }

interface ApprovalRequest {
  id: string;
  text: string;
  status: 'pending' | 'approved' | 'rejected';
  deciding?: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  time: Date;
  tools?: ToolUse[];
  approval?: ApprovalRequest;
  files?: string[];
  streaming?: boolean;
  failed?: boolean;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;
  @ViewChild('composer') composerRef?: ElementRef<HTMLTextAreaElement>;

  // The backend does not accept chat attachments yet, so the paperclip is hidden.
  // (Use the Knowledge page to give an agent documents.)
  readonly attachmentsEnabled = false;

  private readonly placeholder: AgentOption = { id: '', name: 'Agent', purpose: '', color: '#4338ca', knowledge: 0 };

  agents: AgentOption[] = [];       // GET /agents/list
  agentId = '';
  conversationId: string | null = null;

  messages: ChatMessage[] = [];
  draft = '';
  attachments: File[] = [];
  fileError = '';

  thinking = false;
  streaming = false;
  limitReached = false;             // set when the server answers with code "limit"
  limitMessage = '';
  loadError = '';                   // problems opening agents, a conversation or a decision

  private lastPrompt = '';
  private streamingMsg: ChatMessage | null = null;
  private pendingTools: ToolUse[] = [];

  private routeSub?: Subscription;
  private agentsSub?: Subscription;
  private convSub?: Subscription;
  private sub?: Subscription;          // the running chat stream (unsubscribing = Stop)
  private decideSub?: Subscription;

  private readonly maxFiles = 5;
  private readonly maxBytes = 10 * 1024 * 1024;
  private readonly allowedExt = ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private chat: ChatStreamService,
    private badge: BadgeService
  ) {}

  // ---- Getters ---------------------------------------------------------
  get currentAgent(): AgentOption {
    return this.agents.find(a => a.id === this.agentId) || this.agents[0] || this.placeholder;
  }

  get busy(): boolean {
    return this.thinking || this.streaming;
  }

  get canSend(): boolean {
    return !this.busy && !this.limitReached && !!this.agentId && this.draft.trim().length > 0;
  }

  get canSeeUsage(): boolean {
    const r = localStorage.getItem('role');
    return r === 'builder' || r === 'admin';
  }

  get suggestions(): string[] {
    return [
      "Summarise last week's enquiries",
      'Draft an email to a customer',
      'What can you help me with?'
    ];
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // GET /agents/list (members see published agents; builders also see their own drafts)
    this.agentsSub = this.api.agents().subscribe({
      next: (r: any) => {
        this.agents = (r.agents || []).map((a: any) => ({
          id: a.id, name: a.name, purpose: a.purpose || '', color: a.color || '#4338ca', knowledge: a.knowledgeCount || 0
        }));
        if (!this.agents.length) { this.loadError = 'No agents are available yet. Ask a builder to publish one.'; }
        if (!this.agentId && this.agents.length) { this.agentId = this.agents[0].id; }
        this.listenToRoute();
      },
      error: (e: ApiError) => {
        this.loadError = e.message;
        this.listenToRoute();
      }
    });
  }

  ngOnDestroy(): void {
    this.agentsSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.convSub?.unsubscribe();
    this.sub?.unsubscribe();       // also stops a running answer on the server
    this.decideSub?.unsubscribe();
  }

  // Home links here with ?agent=<id> or ?id=<conversationId>
  private listenToRoute(): void {
    this.routeSub?.unsubscribe();
    this.routeSub = this.route.queryParamMap.subscribe(params => {
      const agent = params.get('agent');
      if (agent && !this.busy && this.agents.some(a => a.id === agent)) {
        this.agentId = agent;
      }
      const id = params.get('id');
      if (id && id !== this.conversationId) {
        this.loadConversation(id);
      }
    });
  }

  // ---- Conversation ----------------------------------------------------
  /** GET /conversations/get?id=... */
  private loadConversation(id: string): void {
    this.resetChat();
    this.conversationId = id;

    this.convSub = this.api.conversation(id).subscribe({
      next: (r: any) => {
        const c = r.conversation;
        if (!this.agents.some(a => a.id === c.agentId)) {
          // e.g. a conversation with an agent that has since been unpublished
          this.agents = [...this.agents, { id: c.agentId, name: c.agentName, purpose: '', color: '#4338ca', knowledge: 0 }];
        }
        this.agentId = c.agentId;

        this.messages = (r.messages || []).map((m: any) => this.toMessage(m));

        // A run that is still waiting for a decision comes back as an approval card
        (r.pendingApprovals || []).forEach((a: any) => {
          this.messages.push({
            id: this.uid(), role: 'agent', time: new Date(),
            text: 'I need your approval before I continue.',
            approval: { id: a.id, text: a.description, status: 'pending' }
          });
        });
        this.scrollToBottom();
      },
      error: (e: ApiError) => {
        this.conversationId = null;
        this.loadError = e.message;
      }
    });
  }

  private toMessage(m: any): ChatMessage {
    const tools: ToolUse[] = (m.tools || []).map((t: any) => ({ name: t.name, seconds: (t.ms || 0) / 1000 }));
    return {
      id: m.id || this.uid(),
      role: m.role === 'user' ? 'user' : 'agent',
      text: m.text,
      time: new Date(m.createdAt || Date.now()),
      tools: tools.length ? tools : undefined
    };
  }

  newChat(): void {
    this.resetChat();
    this.router.navigate(['/chat'], { queryParams: this.agentId ? { agent: this.agentId } : {} });
  }

  onAgentChange(id: string): void {
    if (this.busy || !this.agents.some(a => a.id === id)) { return; }
    this.agentId = id;
    this.resetChat();
    this.router.navigate(['/chat'], { queryParams: { agent: id } });
  }

  private resetChat(): void {
    this.sub?.unsubscribe();
    this.decideSub?.unsubscribe();
    this.convSub?.unsubscribe();
    this.thinking = false;
    this.streaming = false;
    this.streamingMsg = null;
    this.pendingTools = [];
    this.messages = [];
    this.conversationId = null;
    this.lastPrompt = '';
    this.attachments = [];
    this.fileError = '';
    this.loadError = '';
    this.clearComposer();
  }

  // ---- Composer --------------------------------------------------------
  onInput(el: HTMLTextAreaElement): void {
    this.draft = el.value;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (this.canSend) { this.send(); }
    }
  }

  send(): void {
    this.sendText(this.draft);
  }

  sendText(raw: string): void {
    const text = (raw || '').trim();
    if (!text || this.busy || this.limitReached || !this.agentId) { return; }

    this.messages.push({
      id: this.uid(),
      role: 'user',
      text,
      time: new Date(),
      files: this.attachments.map(f => f.name)
    });

    this.lastPrompt = text;
    this.attachments = [];
    this.fileError = '';
    this.loadError = '';
    this.clearComposer();
    this.runAgent(text);
  }

  private clearComposer(): void {
    this.draft = '';
    const el = this.composerRef ? this.composerRef.nativeElement : null;
    if (el) {
      el.value = '';
      el.style.height = 'auto';
    }
  }

  // ---- Attachments (hidden while attachmentsEnabled is false) -----------
  onFiles(input: HTMLInputElement): void {
    this.fileError = '';
    const picked = input.files ? Array.from(input.files) : [];

    for (const f of picked) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (this.attachments.length >= this.maxFiles) {
        this.fileError = 'You can attach up to ' + this.maxFiles + ' files.';
        break;
      }
      if (this.allowedExt.indexOf(ext) === -1) {
        this.fileError = f.name + ' is not an allowed file type.';
        continue;
      }
      if (f.size > this.maxBytes) {
        this.fileError = f.name + ' is larger than 10 MB.';
        continue;
      }
      this.attachments.push(f);
    }
    input.value = '';   // lets the same file be picked again
  }

  removeFile(index: number): void {
    this.attachments.splice(index, 1);
    this.fileError = '';
  }

  // ---- Running the agent: POST /chat/send (streamed) ---------------------
  private runAgent(prompt: string): void {
    this.thinking = true;
    this.pendingTools = [];
    this.streamingMsg = null;
    this.scrollToBottom();

    this.sub = this.chat
      .send({ agentId: this.agentId, text: prompt, conversationId: this.conversationId || undefined })
      .subscribe({
        next: ev => this.onEvent(ev),
        error: (e: ApiError) => this.onStreamError(e),
        complete: () => this.onStreamEnd()
      });
  }

  private onEvent(ev: ChatEvent): void {
    switch (ev.event) {
      case 'start':
        this.conversationId = ev.data.conversationId;
        if (!this.route.snapshot.queryParamMap.get('id')) {
          // put the conversation in the address so a refresh reopens it
          this.router.navigate(['/chat'], { queryParams: { id: this.conversationId }, replaceUrl: true });
        }
        break;

      case 'thinking':
        this.thinking = true;
        break;

      case 'delta':
        this.appendDelta(ev.data.text);
        break;

      case 'tool':
        this.pendingTools.push({ name: ev.data.name, seconds: (ev.data.ms || 0) / 1000 });
        break;

      case 'approval':
        this.showApproval(ev.data);
        break;

      case 'done':
        this.finishAnswer(ev.data.message);
        break;

      case 'error':
        this.failLast();
        break;
    }
  }

  private appendDelta(text: string): void {
    this.thinking = false;
    this.streaming = true;
    if (!this.streamingMsg) {
      this.streamingMsg = { id: this.uid(), role: 'agent', text: '', time: new Date(), streaming: true };
      this.messages.push(this.streamingMsg);
    }
    this.streamingMsg.text += text;
    this.scrollToBottom();
  }

  /** The agent wants to do something with side effects and is waiting for a yes or no. */
  private showApproval(a: any): void {
    this.thinking = false;
    this.streaming = false;

    let msg = this.streamingMsg;
    if (!msg) {
      msg = { id: this.uid(), role: 'agent', text: 'I need your approval before I continue.', time: new Date() };
      this.messages.push(msg);
    }
    msg.streaming = false;
    if (this.pendingTools.length) { msg.tools = this.pendingTools.slice(); }
    msg.approval = { id: a.id, text: a.description, status: 'pending' };

    this.streamingMsg = null;
    this.badge.refresh();
    this.scrollToBottom();
  }

  private finishAnswer(m: any): void {
    this.thinking = false;
    this.streaming = false;
    const done = this.toMessage({ ...m, role: 'assistant' });

    if (this.streamingMsg) {
      this.streamingMsg.text = done.text;                 // the saved text is the final one
      this.streamingMsg.tools = done.tools;
      this.streamingMsg.streaming = false;
    } else {
      this.messages.push(done);
    }
    this.streamingMsg = null;
    this.scrollToBottom();
  }

  private onStreamEnd(): void {
    this.thinking = false;
    this.streaming = false;
    if (this.streamingMsg) {
      this.streamingMsg.streaming = false;
      this.streamingMsg = null;
    }
    this.sub = undefined;
  }

  private onStreamError(e: ApiError): void {
    this.thinking = false;
    this.streaming = false;
    this.dropEmptyStreamingMsg();
    this.sub = undefined;

    if (e.code === 'auth') { return; }                   // already sent to the sign-in page
    if (e.code === 'limit') {
      this.limitReached = true;
      this.limitMessage = e.message;
      return;
    }
    this.failLast(e.message);
  }

  stop(): void {
    this.sub?.unsubscribe();            // closes the connection, which cancels the run on the server
    this.decideSub?.unsubscribe();
    this.sub = undefined;
    this.thinking = false;
    this.streaming = false;
    if (this.streamingMsg) { this.streamingMsg.streaming = false; }
    this.dropEmptyStreamingMsg();
    this.streamingMsg = null;
  }

  private dropEmptyStreamingMsg(): void {
    const m = this.streamingMsg;
    if (m && !m.text.trim()) {
      this.messages = this.messages.filter(x => x.id !== m.id);
    }
    this.streamingMsg = null;
  }

  private failLast(text = 'Sorry, I could not finish that answer.'): void {
    this.thinking = false;
    this.streaming = false;
    this.messages.push({ id: this.uid(), role: 'agent', text, time: new Date(), failed: true });
    this.scrollToBottom();
  }

  retry(): void {
    if (this.busy || !this.lastPrompt) { return; }
    // remove the failed message, keep the user's message, and ask again
    this.messages = this.messages.filter(m => !m.failed);
    this.runAgent(this.lastPrompt);
  }

  // ---- Approvals: POST /approvals/decide ---------------------------------
  decide(m: ChatMessage, approved: boolean): void {
    const ap = m.approval;
    if (!ap || ap.status !== 'pending' || ap.deciding) { return; }

    ap.deciding = true;
    this.thinking = true;         // the agent carries on after the decision
    this.loadError = '';
    this.scrollToBottom();

    this.decideSub = this.api.decideApproval(ap.id, approved ? 'approve' : 'reject').subscribe({
      next: (r: any) => {
        ap.deciding = false;
        this.thinking = false;
        ap.status = r.approval && r.approval.status === 'approved' ? 'approved' : 'rejected';
        this.badge.refresh();

        if (r.error) {
          this.failLast(r.error);
        } else if (r.message) {
          this.messages.push(this.toMessage({ ...r.message, role: 'assistant' }));
        } else if (r.status === 'failed') {
          this.failLast('The agent could not continue after that decision.');
        }

        if (r.nextApproval) {            // the agent may ask for another approval
          this.messages.push({
            id: this.uid(), role: 'agent', time: new Date(),
            text: 'I need one more approval before I continue.',
            approval: { id: r.nextApproval.id, text: r.nextApproval.description, status: 'pending' }
          });
        }
        this.scrollToBottom();
      },
      error: (e: ApiError) => {
        ap.deciding = false;
        this.thinking = false;
        this.loadError = e.message;
      }
    });
  }

  // ---- Helpers ---------------------------------------------------------
  trackById(index: number, m: ChatMessage): string {
    return m.id;
  }

  private scrollToBottom(): void {
    window.setTimeout(() => {
      const el = this.scroller ? this.scroller.nativeElement : null;
      if (el) { el.scrollTop = el.scrollHeight; }
    }, 0);
  }

  private uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}