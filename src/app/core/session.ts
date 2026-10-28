import { Router } from '@angular/router';
import { ApiError } from './models';

/** Turns any HttpErrorResponse (or fetch failure) into a clean ApiError. */
export function toApiError(e: any): ApiError {
  const body = e && e.error;
  const status = (e && e.status) || 0;
  if (body && typeof body === 'object' && body.message) {
    return { status, code: body.code || 'error', message: String(body.message) };
  }
  if (typeof body === 'string' && body.trim() && body.length < 200) {
    return { status, code: 'error', message: body.trim() }; // e.g. the rate limiter's plain-text answer
  }
  if (status === 0) {
    return { status: 0, code: 'network', message: 'Cannot reach the server. Check your connection and try again.' };
  }
  return { status, code: 'error', message: 'Something went wrong. Please try again.' };
}

/** The session is no longer valid: clear it and send the person to sign in, then back to where they were. */
export function endSession(router: Router): void {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('profile');
  if (!router.url.startsWith('/account')) {
    router.navigate(['/account'], { queryParams: { returnUrl: router.url } });
  }
}
