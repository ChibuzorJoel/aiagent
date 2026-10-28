import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { API_URL } from './config';
import { Role, SessionUser } from './models';
import { toApiError } from './session';

const failWith = (e: any) => new Observable<never>(sub => sub.error(toApiError(e)));

/**
 * One place for every backend call. Each method returns an Observable.
 * Errors arrive as ApiError { status, code, message }, so a page only needs:
 *   this.api.agents().subscribe({ next: r => ..., error: e => this.error = e.message });
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  get signedIn(): boolean { return !!localStorage.getItem('token'); }
  get token(): string { return localStorage.getItem('token') || ''; }
  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  // ---- Generic helpers -------------------------------------------------
  get<T = any>(path: string, params: Record<string, any> = {}): Observable<T> {
    let p = new HttpParams();
    Object.keys(params).forEach(k => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') { p = p.set(k, String(v)); }
    });
    return this.http.get<T>(API_URL + path, { params: p }).pipe(catchError(failWith));
  }

  /** body can be a plain object or a FormData (file upload). */
  post<T = any>(path: string, body: any = {}): Observable<T> {
    return this.http.post<T>(API_URL + path, body).pipe(catchError(failWith));
  }

  // ---- Account -----------------------------------------------------------
  me() { return this.get<SessionUser>('/auth/me'); }
  updateProfile(name: string, phone: string) { return this.post<SessionUser>('/auth/profile', { name, phone }); }

  // ---- Home --------------------------------------------------------------
  dashboard() { return this.get('/dashboard'); }
  announcements() { return this.get('/announcements'); }

  // ---- Agents --------------------------------------------------------------
  agents(params: { q?: string; status?: string } = {}) { return this.get('/agents/list', params); }
  agent(id: string) { return this.get('/agents/get', { id }); }
  createAgent(body: any) { return this.post('/agents/create', body); }
  updateAgent(body: any) { return this.post('/agents/update', body); }          // body includes id
  publishAgent(id: string, published = true) { return this.post('/agents/publish', { id, published }); }
  deleteAgent(id: string) { return this.post('/agents/delete', { id }); }

  // ---- Knowledge -------------------------------------------------------------
  knowledge(params: { q?: string; status?: string; page?: number } = {}) { return this.get('/knowledge/list', params); }
  addKnowledgeFile(file: File) { const f = new FormData(); f.append('file', file); return this.post('/knowledge/add', f); }
  addKnowledgeUrl(url: string) { return this.post('/knowledge/add', { url }); }
  reindexKnowledge(id: string) { return this.post('/knowledge/reindex', { id }); }
  deleteKnowledge(id: string) { return this.post('/knowledge/delete', { id }); }

  // ---- Tools -------------------------------------------------------------------
  tools() { return this.get('/tools/list'); }
  connectTool(key: string) { return this.post('/tools/connect', { key }); }
  disconnectTool(key: string) { return this.post('/tools/disconnect', { key }); }
  testTool(key: string) { return this.post('/tools/test', { key }); }

  // ---- Conversations / History -----------------------------------------------------
  conversations(params: { q?: string; agentId?: string; page?: number } = {}) { return this.get('/conversations/list', params); }
  conversation(id: string) { return this.get('/conversations/get', { id }); }
  renameConversation(id: string, title: string) { return this.post('/conversations/rename', { id, title }); }
  deleteConversation(id: string) { return this.post('/conversations/delete', { id }); }

  // ---- Approvals -----------------------------------------------------------------------
  approvals(tab: 'pending' | 'history' = 'pending', page = 1) { return this.get('/approvals/list', { tab, page }); }
  decideApproval(id: string, decision: 'approve' | 'reject', reason = '') { return this.post('/approvals/decide', { id, decision, reason }); }

  // ---- Runs and usage ---------------------------------------------------------------------
  runs(params: { status?: string; agentId?: string; page?: number } = {}) { return this.get('/runs/list', params); }
  run(id: string) { return this.get('/runs/get', { id }); }
  usage(days: 7 | 30 | 90 = 30) { return this.get('/usage/summary', { days }); }

  // ---- Admin ----------------------------------------------------------------------------------
  users(params: { q?: string; role?: string; page?: number } = {}) { return this.get('/users/list', params); }
  createUser(body: { email: string; name?: string; role: Role }) { return this.post('/users/create', body); }
  updateUser(body: { id: string; name?: string; role?: Role; active?: boolean }) { return this.post('/users/update', body); }
  limits() { return this.get('/limits/get'); }
  saveLimits(body: any) { return this.post('/limits/save', body); }
  audit(params: { person?: string; action?: string; from?: string; to?: string; limit?: number } = {}) { return this.get('/audit/list', params); }
}
