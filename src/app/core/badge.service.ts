import { Injectable } from '@angular/core';
import { timer } from 'rxjs';
import { ApiService } from './api.service';

/**
 * Keeps the red count on the "Approvals" menu item up to date.
 * Injecting it once (in NavComponent's constructor) is enough: it checks every 60 seconds.
 * Call refresh() right after a person approves or rejects something, or signs in.
 */
@Injectable({ providedIn: 'root' })
export class BadgeService {
  constructor(private api: ApiService) {
    timer(0, 60000).subscribe(() => this.refresh());
  }

  refresh(): void {
    if (!this.api.signedIn) { this.publish(0); return; }
    this.api.get('/approvals/list', { tab: 'pending', pageSize: 1 }).subscribe({
      next: (r: any) => this.publish(r && r.pendingCount),
      error: () => { /* keep the old number; the interceptor handles an expired session */ }
    });
  }

  private publish(n: number): void {
    window.dispatchEvent(new CustomEvent('approvals-count', { detail: n || 0 }));
  }
}
