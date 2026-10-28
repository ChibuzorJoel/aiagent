
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

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
export class HomeComponent implements OnInit {
  loading = true;
  today = new Date();

  stats: Stat[] = [];
  recentChats: RecentChat[] = [];
  agents: AgentCard[] = [];
  announcements: Announcement[] = [];

  constructor(private router: Router) {}

  // ---- Session (swap for your RolesService when ready) --------------
  get role(): string {
    return localStorage.getItem('role') || 'member';
  }

  get firstName(): string {
    const name = (localStorage.getItem('name') || '').trim();
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

  /**
   * Replace the body of this method with your real calls, e.g.
   *   GET /dashboard      -> stats, recentChats, agents
   *   GET /announcements  -> announcements
   * Then set this.loading = false when they finish (also on error).
   */
  load(): void {
    this.loading = true;

    setTimeout(() => {
      this.stats = [
        { label: 'Chats this week',      value: 12,      icon: '💬', tone: 'teal',   route: '/conversations' },
        { label: 'Agents available',     value: 3,       icon: '🤖', tone: 'indigo', route: '/chat' },
        { label: 'Waiting for approval', value: 2,       icon: '✅', tone: 'amber',  route: '/approvals' },
        { label: 'Cost this month',      value: '$14.20', icon: '💳', tone: 'green',  route: '/usage', roles: ['builder', 'admin'] },
      ];

      this.recentChats = [
        { id: 'c1', title: "Summarise last week's enquiries", agent: 'Sales Assistant', time: '2 hours ago', color: '#14b8a6' },
        { id: 'c2', title: 'Draft a reply to the supplier',  agent: 'Office Helper',   time: 'Yesterday',   color: '#4338ca' },
        { id: 'c3', title: 'Find the leave policy',          agent: 'HR Guide',        time: 'Mon',         color: '#0f766e' },
      ];

      this.agents = [
        { id: 'a1', name: 'Sales Assistant', purpose: 'Answers questions about enquiries and leads.', color: '#14b8a6' },
        { id: 'a2', name: 'Office Helper',   purpose: 'Drafts messages and summarises documents.',   color: '#4338ca' },
        { id: 'a3', name: 'HR Guide',        purpose: 'Finds policies and answers staff questions.', color: '#0f766e' },
      ];

      this.announcements = [
        { title: 'Welcome to the workspace', text: 'Chat with an agent or ask a builder to create one for your team.', date: 'Today' },
        { title: 'Approvals are on',         text: 'Actions that send or change data will ask for your yes or no first.', date: 'This week' },
      ];

      this.loading = false;
    }, 600);
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