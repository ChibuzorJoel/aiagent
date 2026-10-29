
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from 'src/app/core/api.service';
import { ApiError } from 'src/app/core/models';

interface Stat {
  label: string;
  value: string | number;
  icon: string;
  tone: 'teal' | 'indigo' | 'amber' | 'green';
  route: string;
  roles?: string[];            // omitted = everyone
}

interface RecentChat { id: string; title: string; agent: string; time: string; color: string; }
interface AgentCard  { id: string; name: string; purpose: string; color: string; }
interface Announcement { title: string; text: string; date: string; }

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  loading = true;
  today = new Date();

  stats: Stat[] = [];
  recentChats: RecentChat[] = [];
  agents: AgentCard[] = [];
  announcements: Announcement[] = [];

  loadError = '';
  private userName = '';
  private sub?: Subscription;

  constructor(private router: Router, private api: ApiService) {}

  // ---- Session (swap for your RolesService when ready) --------------
  get role(): string {
    return localStorage.getItem('role') || 'member';
  }

  get firstName(): string {
    let name = this.userName;
    if (!name) {
      try { name = (JSON.parse(localStorage.getItem('profile') || '{}').name || '').trim(); } catch (e) { name = ''; }
    }
    return name ? name.split(' ')[0] : 'there';
  }

  get greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // Cost card is for builders and admins only
  get visibleStats(): Stat[] {
    return this.stats.filter(s => !s.roles || s.roles.includes(this.role));
  }

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** GET /dashboard and GET /announcements */
  load(): void {
    this.loading = true;
    this.loadError = '';
    this.sub?.unsubscribe();

    this.sub = forkJoin({
      dash: this.api.dashboard(),
      news: this.api.announcements().pipe(catchError(() => of({ announcements: [] })))
    }).subscribe({
      next: (r: any) => {
        const d = r.dash || {};
        const st = d.stats || {};
        this.userName = (d.greeting && d.greeting.name) || '';

        this.stats = [
          { label: 'Chats this week',      value: st.chatsThisWeek || 0,      icon: '💬', tone: 'teal',   route: '/conversations' },
          { label: 'Agents available',     value: st.agentsAvailable || 0,    icon: '🤖', tone: 'indigo', route: '/chat' },
          { label: 'Waiting for approval', value: st.waitingForApproval || 0, icon: '✅', tone: 'amber',  route: '/approvals' },
          { label: 'Cost this month',      value: '$' + Number(st.costThisMonth || 0).toFixed(2), icon: '💳', tone: 'green', route: '/usage', roles: ['builder', 'admin'] },
        ];

        this.recentChats = (d.recentConversations || []).map((c: any): RecentChat => ({
          id: c.id, title: c.title, agent: c.agentName, color: c.color || '#4338ca', time: this.when(new Date(c.updatedAt))
        }));

        this.agents = (d.agents || []).map((a: any): AgentCard => ({
          id: a.id, name: a.name, purpose: a.purpose || '', color: a.color || '#4338ca'
        }));

        this.announcements = ((r.news && r.news.announcements) || []).map((n: any): Announcement => ({
          title: n.title, text: n.body, date: this.when(new Date(n.createdAt))
        }));

        this.loading = false;
      },
      error: (e: ApiError) => {
        this.loading = false;
        this.loadError = e.message;
      }
    });
  }

  private when(d: Date): string {
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    if (min < 1) { return 'Just now'; }
    if (min < 60) { return min + (min === 1 ? ' minute ago' : ' minutes ago'); }
    const hrs = Math.floor(min / 60);
    if (hrs < 24) { return hrs + (hrs === 1 ? ' hour ago' : ' hours ago'); }
    const days = Math.floor(hrs / 24);
    if (days === 1) { return 'Yesterday'; }
    if (days < 7) { return days + ' days ago'; }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---- Actions -------------------------------------------------------
  go(route: string): void {
    this.router.navigate([route]);
  }

  newChat(): void {
    this.router.navigate(['/chat']);
  }

  openChat(c: RecentChat): void {
    this.router.navigate(['/chat'], { queryParams: { id: c.id } });
  }

  openAgent(a: AgentCard): void {
    this.router.navigate(['/chat'], { queryParams: { agent: a.id } });
  }
}