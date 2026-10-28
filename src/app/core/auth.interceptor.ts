import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { API_URL } from './config';
import { endSession } from './session';

/** Adds the session token to every call to our backend, and handles an expired session in one place. */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private router: Router) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const isApi = req.url.startsWith(API_URL);
    const token = localStorage.getItem('token');
    const request = isApi && token ? req.clone({ setHeaders: { Authorization: 'Bearer ' + token } }) : req;

    return next.handle(request).pipe(
      catchError((err: HttpErrorResponse) => {
        const body: any = err.error;
        if (isApi && err.status === 401 && body && body.code === 'auth') {
          endSession(this.router);
        }
        throw err; // the page still gets the error, so it can stop its spinner
      })
    );
  }
}
