import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: '', canActivate: [authGuard], children: [
    { path: '', redirectTo: 'series', pathMatch: 'full' },
    { path: 'series', loadComponent: () => import('./pages/series/series.component').then(m => m.SeriesComponent) },
    { path: 'explorar', loadComponent: () => import('./pages/explorar/explorar.component').then(m => m.ExplorarComponent) },
    { path: 'serie/:id', loadComponent: () => import('./pages/explorar/show-detail.component').then(m => m.ShowDetailComponent) },
    { path: 'perfil', loadComponent: () => import('./pages/perfil/perfil.component').then(m => m.PerfilComponent) },
  ]},
  { path: '**', redirectTo: 'series' },
];
