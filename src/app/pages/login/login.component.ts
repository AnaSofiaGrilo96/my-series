import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="login">
      <h1>MySeries</h1>
      <p>Entra para ver as tuas séries.</p>
      <input type="email" placeholder="Email" [(ngModel)]="email" autocomplete="username" />
      <input type="password" placeholder="Palavra-passe" [(ngModel)]="password" autocomplete="current-password" (keyup.enter)="submit()" />
      @if (error()) { <div class="err">{{ error() }}</div> }
      <button class="btn" (click)="submit()" [disabled]="busy()">Entrar</button>
    </div>
  `,
  styles: [`
    .login { min-height: 100dvh; display: flex; flex-direction: column; justify-content: center; gap: 12px; padding: 32px 24px; background: var(--accent); color: var(--on-accent); }
    h1 { font-size: 44px; } p { margin: 0 0 12px; font-weight: 600; }
    input { padding: 14px 16px; border-radius: 12px; border: 0; background: #fff; color: #111; }
    .err { color: #b00020; font-weight: 700; font-size: 14px; }
    .btn { background: #111; color: #fff; margin-top: 8px; }
  `],
})
export class LoginComponent {
  private sb = inject(SupabaseService);
  private router = inject(Router);
  email = ''; password = '';
  busy = signal(false); error = signal('');

  async submit() {
    this.busy.set(true); this.error.set('');
    const { error } = await this.sb.signIn(this.email, this.password);
    this.busy.set(false);
    if (error) { this.error.set('Email ou palavra-passe incorretos.'); return; }
    this.router.navigateByUrl('/series');
  }
}
