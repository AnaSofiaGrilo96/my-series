import { Injectable, signal } from '@angular/core';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  readonly session = signal<Session | null>(null);
  readonly ready = signal(false);

  constructor() {
    this.client.auth.getSession().then(({ data }) => { this.session.set(data.session); this.ready.set(true); });
    this.client.auth.onAuthStateChange((_e, s) => this.session.set(s));
  }
  signIn(email: string, password: string) { return this.client.auth.signInWithPassword({ email, password }); }
  signOut() { return this.client.auth.signOut(); }
}
