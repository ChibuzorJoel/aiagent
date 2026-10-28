
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import {
  HttpClientModule,
  HTTP_INTERCEPTORS
} from '@angular/common/http';

import { AuthInterceptor } from './core/auth.interceptor';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { NavComponent } from './layout/nav/nav.component';
import { HomeComponent } from './pages/home/home.component';
import { ChatComponent } from './pages/chat/chat.component';
import { AgentsComponent } from './pages/agents/agents.component';
import { ConversationsComponent } from './pages/conversations/conversations.component';
import { KnowledgeComponent } from './pages/knowledge/knowledge.component';
import { ToolsComponent } from './pages/tools/tools.component';
import { AccountComponent } from './pages/account/account.component';
import { ApprovalsComponent } from './pages/approvals/approvals.component';
import { RunsComponent } from './pages/runs/runs.component';
import { UsageComponent } from './pages/usage/usage.component';

import { UsersComponent } from './admin/users/users.component';
import { LimitsComponent } from './admin/limits/limits.component';
import { AuditComponent } from './admin/audit/audit.component';

@NgModule({
  declarations: [
    AppComponent,
    NavComponent,
    HomeComponent,
    ChatComponent,
    AgentsComponent,
    ConversationsComponent,
    KnowledgeComponent,
    ToolsComponent,
    AccountComponent,
    ApprovalsComponent,
    RunsComponent,
    UsageComponent,
    UsersComponent,
    LimitsComponent,
    AuditComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule
  ],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
