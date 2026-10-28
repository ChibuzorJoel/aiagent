import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { ChatComponent } from './pages/chat/chat.component';
import { AgentsComponent } from './pages/agents/agents.component';
import { KnowledgeComponent } from './pages/knowledge/knowledge.component';
import { ToolsComponent } from './pages/tools/tools.component';
import { ConversationsComponent } from './pages/conversations/conversations.component';
import { AccountComponent } from './pages/account/account.component';
import { ApprovalsComponent } from './pages/approvals/approvals.component';
import { RunsComponent } from './pages/runs/runs.component';
import { UsageComponent } from './pages/usage/usage.component';
import { UsersComponent } from './admin/users/users.component';
import { LimitsComponent } from './admin/limits/limits.component';
import { AuditComponent } from './admin/audit/audit.component';

const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'chat', component: ChatComponent },
  { path: 'agents', component: AgentsComponent },
  { path: 'knowledge', component: KnowledgeComponent },
  { path: 'tools', component: ToolsComponent },
  { path: 'conversations', component: ConversationsComponent },
  { path: 'account', component: AccountComponent },
  { path: 'approvals', component: ApprovalsComponent },
  { path: 'runs', component: RunsComponent },
  { path: 'usage', component: UsageComponent },
  { path: 'users', component: UsersComponent },
  { path: 'limits', component: LimitsComponent },
  { path: 'audit', component: AuditComponent },
  { path: '**', redirectTo: 'home' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
