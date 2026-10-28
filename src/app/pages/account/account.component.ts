import { Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

type Role = 'member' | 'builder' | 'admin';
type Step = 'email' | 'code' | 'time';

interface Profile {
  name: string;
  email: string;
  phone: string;
}

interface QuickLink {
  label: string;
  icon: string;
  route: string;
}

/** Shape returned by POST /auth/verify-code */
interface VerifyResponse {
  token: string;
  role: Role;
  user: { id: string; name: string; email: string; phone?: string };
}

/** Shape returned by GET /auth/me and POST /auth/profile */
interface MeResponse {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
}

// Base URL of the API (matches PORT in the backend .env). Move this to
// environment.ts (environment.apiUrl) when you have one.
const API_URL = 'https://aiagent-rnhq.onrender.com';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss']
})
export class AccountComponent implements OnInit, OnDestroy {
  // Set to false if your sign-in does not have the date-and-time step.
  readonly requireDateTime = true;

  step: Step = 'email';
  email = '';
  busy = false;
  loadingProfile = false;
  error = '';
  info = '';
  saved = false;
  resendIn = 0;

  profile: Profile = { name: '', email: '', phone: '' };

  readonly quickLinks: QuickLink[] = [
    { label: 'Home',      icon: '🏠', route: '/home' },
    { label: 'Chat',      icon: '💬', route: '/chat' },
    { label: 'History',   icon: '🕘', route: '/conversations' },
    { label: 'Approvals', icon: '✅', route: '/approvals' },
  ];

  private subs = new Subscription();
  private resendTimer: number | null = null;
  private returnUrl = '/home';

  /**
   * The session returned by the server is held here until the date-and-time
   * step is passed, so nobody is "signed in" before every step is complete.
   */
  private pending: VerifyResponse | null = null;

  constructor(
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  // ---- Getters (read localStorage each time, so the nav's Logout updates this page too) ----
  get signedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  get role(): Role {
    const r = localStorage.getItem('role');
    return r === 'admin' || r === 'builder' ? r : 'member';
  }

  get initials(): string {
    const source = (this.profile.name || this.profile.email || '?').trim();
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    const letters = (parts[0] ? parts[0].charAt(0) : '?') + (parts[1] ? parts[1].charAt(0) : '');
    return letters.toUpperCase();
  }

  // ---- Lifecycle -------------------------------------------------------
  ngOnInit(): void {
    // The app sends people here with ?returnUrl=/chat when the server answers with code "auth".
    const back = this.route.snapshot.queryParamMap.get('returnUrl');
    if (back && back.charAt(0) === '/' && back.charAt(1) !== '/') {
      this.returnUrl = back;
    }

    if (this.signedIn) {
      this.loadProfile();
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.stopResendTimer();
  }

  // ---- Step 1: e-mail --------------------------------------------------
  onEmail(event: Event, raw: string): void {
    event.preventDefault();
    if (this.busy) { return; }
    this.clearMessages();

    const value = (raw || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      this.error = 'Please enter a valid e-mail address.';
      return;
    }

    this.email = value;
    this.requestCode(false);
  }

  /** POST /auth/request-code { email } */
  private requestCode(isResend: boolean): void {
    this.busy = true;
    this.subs.add(
      this.http.post(`${API_URL}/auth/request-code`, { email: this.email }).subscribe({
        next: () => {
          this.busy = false;
          this.step = 'code';
          this.info = isResend ? 'A new code has been sent.' : '';
          this.startResendTimer();
        },
        error: (err: HttpErrorResponse) => {
          this.busy = false;
          this.error = this.messageFrom(err, 'We could not send the code. Please try again.');
        }
      })
    );
  }

  resend(): void {
    if (this.busy || this.resendIn > 0) { return; }
    this.clearMessages();
    this.requestCode(true);
  }

  backToEmail(): void {
    if (this.busy) { return; }
    this.clearMessages();
    this.stopResendTimer();
    this.resendIn = 0;
    this.pending = null;
    this.step = 'email';
  }

  // ---- Step 2: one-time code -------------------------------------------
  onCode(event: Event, raw: string): void {
    event.preventDefault();
    if (this.busy) { return; }
    this.clearMessages();

    const code = (raw || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      this.error = 'Enter the 6-digit code from your e-mail.';
      return;
    }

    this.verifyCode(code);
  }

  /** POST /auth/verify-code { email, code } */
  private verifyCode(code: string): void {
    this.busy = true;
    this.subs.add(
      this.http.post<VerifyResponse>(`${API_URL}/auth/verify-code`, { email: this.email, code }).subscribe({
        next: res => {
          this.busy = false;

          if (!res || !res.token) {
            this.error = 'Sign-in failed. Please try again.';
            return;
          }

          this.stopResendTimer();
          this.resendIn = 0;
          this.pending = res;

          if (this.requireDateTime) {
            this.step = 'time';
          } else {
            this.finishSignIn();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.busy = false;
          this.error = this.messageFrom(err, 'That code is not correct. Please try again.');

          // After too many wrong tries the code is gone: let the person request a new one.
          if (err.status === 429 || (err.error && err.error.code === 'too_many')) {
            this.resendIn = 0;
          }
        }
      })
    );
  }

  // ---- Step 3: date and time check -------------------------------------
  onTime(event: Event, raw: string): void {
    event.preventDefault();
    if (this.busy) { return; }
    this.clearMessages();

    if (!raw) {
      this.error = 'Please enter the current date and time.';
      return;
    }

    const entered = new Date(raw).getTime();     // datetime-local is read as local time
    if (isNaN(entered)) {
      this.error = 'That date and time is not valid.';
      return;
    }

    const diffMinutes = Math.abs(Date.now() - entered) / 60000;
    if (diffMinutes > 5) {
      this.error = 'That does not match the current date and time. Please check and try again.';
      return;
    }

    this.finishSignIn();
  }

  /** Saves the real session returned by the server. */
  private finishSignIn(): void {
    const session = this.pending;
    if (!session) {
      this.step = 'email';
      this.error = 'Your session could not be started. Please sign in again.';
      return;
    }

    localStorage.setItem('token', session.token);
    localStorage.setItem('role', session.role);
    localStorage.setItem('profile', JSON.stringify({
      name: session.user.name || '',
      email: session.user.email || this.email,
      phone: session.user.phone || ''
    }));

    this.pending = null;
    this.profile = {
      name: session.user.name || '',
      email: session.user.email || this.email,
      phone: session.user.phone || ''
    };
    this.step = 'email';
    this.clearMessages();

    // Go back to where the person was heading. Remove these lines to stay on the profile card.
    if (this.returnUrl !== '/home') {
      this.router.navigateByUrl(this.returnUrl);
    }
  }

  // ---- Profile ---------------------------------------------------------
  /** GET /auth/me */
  private loadProfile(): void {
    // Show what we already have straight away, then refresh from the server.
    let cached: Partial<Profile> = {};
    try {
      cached = JSON.parse(localStorage.getItem('profile') || '{}') || {};
    } catch {
      cached = {};
    }
    this.profile = {
      name: cached.name || '',
      email: cached.email || this.email,
      phone: cached.phone || ''
    };

    this.loadingProfile = true;
    this.subs.add(
      this.http.get<MeResponse>(`${API_URL}/auth/me`, { headers: this.authHeaders() }).subscribe({
        next: me => {
          this.loadingProfile = false;
          this.profile = { name: me.name || '', email: me.email || '', phone: me.phone || '' };
          localStorage.setItem('role', me.role);
          localStorage.setItem('profile', JSON.stringify(this.profile));
        },
        error: (err: HttpErrorResponse) => {
          this.loadingProfile = false;
          if (this.handleAuthError(err)) { return; }
          this.error = this.messageFrom(err, 'We could not load your profile. Please refresh the page.');
        }
      })
    );
  }

  /** POST /auth/profile { name, phone } */
  saveProfile(event: Event, rawName: string, rawPhone: string): void {
    event.preventDefault();
    if (this.busy) { return; }
    this.clearMessages();

    const name = (rawName || '').trim();
    const phone = (rawPhone || '').trim();

    if (!name) {
      this.error = 'Please enter your name.';
      return;
    }
    if (phone && !/^\+?[0-9\s-]{7,15}$/.test(phone)) {
      this.error = 'Please enter a valid phone number.';
      return;
    }

    this.busy = true;
    this.subs.add(
      this.http.post<MeResponse>(`${API_URL}/auth/profile`, { name, phone }, { headers: this.authHeaders() }).subscribe({
        next: me => {
          this.busy = false;
          this.profile = { name: me.name || name, email: me.email || this.profile.email, phone: me.phone || '' };
          localStorage.setItem('profile', JSON.stringify(this.profile));
          this.saved = true;
        },
        error: (err: HttpErrorResponse) => {
          this.busy = false;
          if (this.handleAuthError(err)) { return; }
          this.error = this.messageFrom(err, 'We could not save your changes. Please try again.');
        }
      })
    );
  }

  // ---- Logout ----------------------------------------------------------
  logout(): void {
    this.clearSession();
    this.email = '';
    this.step = 'email';
    this.clearMessages();
    // Already on /account, so the sign-in card appears because signedIn is now false.
  }

  // ---- Helpers ---------------------------------------------------------
  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
  }

  private clearSession(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('profile');
    this.profile = { name: '', email: '', phone: '' };
    this.pending = null;
  }

  /**
   * The server answers { code: "auth" } with status 401 when the token is missing,
   * expired or the account was deactivated. Returns true when it handled that case.
   */
  private handleAuthError(err: HttpErrorResponse): boolean {
    if (err.status === 401 || (err.error && err.error.code === 'auth')) {
      this.clearSession();
      this.step = 'email';
      this.clearMessages();
      this.error = (err.error && err.error.message) || 'Your session has expired. Please sign in again.';
      return true;
    }
    return false;
  }

  /** Turns any HTTP failure into a friendly message for the screen. */
  private messageFrom(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 0) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    if (err.status === 429) {
      return (err.error && err.error.message) || 'Too many attempts. Please wait a few minutes and try again.';
    }
    if (err.error && typeof err.error.message === 'string' && err.error.message) {
      return err.error.message;
    }
    if (err.status >= 500) {
      return 'Something went wrong on our side. Please try again shortly.';
    }
    return fallback;
  }

  private clearMessages(): void {
    this.error = '';
    this.info = '';
    this.saved = false;
  }

  private startResendTimer(): void {
    this.stopResendTimer();
    this.resendIn = 30;
    this.resendTimer = window.setInterval(() => {
      this.resendIn--;
      if (this.resendIn <= 0) { this.stopResendTimer(); }
    }, 1000);
  }

  private stopResendTimer(): void {
    if (this.resendTimer !== null) {
      window.clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }
}