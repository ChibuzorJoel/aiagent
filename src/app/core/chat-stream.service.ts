import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { API_URL } from './config';
import { ChatEvent } from './models';
import { endSession, toApiError } from './session';

/**
 * Sends a chat message and streams the agent's answer as it is written.
 * (Angular's HttpClient cannot read a streamed POST, and EventSource cannot send the token,
 *  so this uses fetch.)  Unsubscribing from the Observable IS the Stop button.
 *
 *   this.sub = this.chat.send({ agentId, text, conversationId }).subscribe({
 *     next: ev => {
 *       if (ev.event === 'start')    this.conversationId = ev.data.conversationId;
 *       if (ev.event === 'delta')    this.answer += ev.data.text;          // blinking-cursor text
 *       if (ev.event === 'tool')     this.chips.push(ev.data);             // { name, ms, ok }
 *       if (ev.event === 'approval') this.pendingApproval = ev.data;       // show Approve / Reject card
 *       if (ev.event === 'done')     this.messages.push(ev.data.message);  // final saved message
 *       if (ev.event === 'error')    this.error = ev.data.message;
 *     },
 *     error: e => this.error = e.message,    // e.code === 'limit' when a cap is reached
 *     complete: () => this.busy = false
 *   });
 *   stop() { this.sub?.unsubscribe(); this.busy = false; }
 */
@Injectable({ providedIn: 'root' })
export class ChatStreamService {
  constructor(private zone: NgZone, private router: Router) {}

  send(body: { agentId: string; text: string; conversationId?: string }): Observable<ChatEvent> {
    return new Observable<ChatEvent>(sub => {
      const ac = new AbortController();
      const emit = (fn: () => void) => this.zone.run(fn);

      const run = async () => {
        try {
          const res = await fetch(API_URL + '/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
            body: JSON.stringify(body),
            signal: ac.signal
          });

          if (!res.ok || !res.body) {
            let payload: any = null;
            try { payload = await res.json(); } catch (e) { /* not JSON */ }
            const err = toApiError({ status: res.status, error: payload });
            if (res.status === 401 && err.code === 'auth') { emit(() => endSession(this.router)); }
            emit(() => sub.error(err));
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) { break; }
            buffer += decoder.decode(value, { stream: true });

            let end: number;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);

              let event = 'message';
              let data = '';
              block.split('\n').forEach(line => {
                if (line.indexOf('event:') === 0) { event = line.slice(6).trim(); }
                else if (line.indexOf('data:') === 0) { data += line.slice(5).trim(); }
              });
              if (!data) { continue; }
              let parsed: any;
              try { parsed = JSON.parse(data); } catch (e) { continue; }
              emit(() => sub.next({ event: event as any, data: parsed }));
            }
          }
          emit(() => sub.complete());
        } catch (e) {
          if (ac.signal.aborted) { return; } // the person pressed Stop
          emit(() => sub.error(toApiError({ status: 0 })));
        }
      };
      run();

      return () => ac.abort();
    });
  }
}
