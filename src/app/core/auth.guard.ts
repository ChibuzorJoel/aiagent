import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Role } from './models';

/**
 * Use in the routes:  { path: 'agents', component: ..., canActivate: [AuthGuard], data: { roles: ['builder', 'admin'] } }
 * (Cosmetic only. The server checks the role on every request.)
 */
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    if (!localStorage.getItem('token')) {
      return this.router.createUrlTree(['/account'], { queryParams: { returnUrl: state.url } });
    }
    const roles = route.data['roles'] as Role[] | undefined;
    const r = localStorage.getItem('role');
    const role: Role = r === 'admin' || r === 'builder' ? r : 'member';
    if (roles && roles.indexOf(role) === -1) {
      return this.router.createUrlTree(['/home']);
    }
    return true;
  }
}
