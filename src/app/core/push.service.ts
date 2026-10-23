import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { SupabaseService } from './supabase.service';

/** Notificações push de lançamentos: a subscrição deste dispositivo fica em `push_subscriptions`; quem envia é a Edge Function `notify-releases`. */
@Injectable({ providedIn: 'root' })
export class PushService {
  private swPush = inject(SwPush);
  private sb = inject(SupabaseService).client;

  /** O browser suporta push e o service worker está ativo (em `ng serve` está desligado → false). */
  readonly supported = this.swPush.isEnabled && typeof Notification !== 'undefined' && !!environment.vapidPublicKey;
  /** Subscrito no browser **e** guardado no Supabase (só assim a Edge Function sabe deste dispositivo). */
  readonly enabled = signal(false);
  readonly denied = signal(typeof Notification !== 'undefined' && Notification.permission === 'denied');
  readonly busy = signal(false);
  /** Mensagem do último erro (gravar/apagar no Supabase, ou pedido de subscrição falhado); null = tudo bem. */
  readonly error = signal<string | null>(null);

  constructor() {
    // Ao abrir a app, uma subscrição existente é reenviada (upsert) — se falhar, o cartão no Perfil mostra o erro e volta a oferecer "Ativar"
    if (this.supported) this.swPush.subscription.subscribe(sub => { if (sub) this.save(sub).then(ok => this.enabled.set(ok)); else this.enabled.set(false); });
  }

  async enable() {
    this.busy.set(true); this.error.set(null);
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
      this.enabled.set(await this.save(sub));
    } catch (err) {
      this.denied.set(Notification.permission === 'denied');
      if (!this.denied()) this.error.set(`Não foi possível subscrever: ${msg(err)}`);
    } finally { this.busy.set(false); }
  }
  async disable() {
    this.busy.set(true); this.error.set(null);
    try {
      const sub = await firstValueFrom(this.swPush.subscription);
      if (sub) {
        const { error } = await this.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        if (error) { this.error.set(`Não foi possível apagar a subscrição: ${error.message}`); return; }
      }
      await this.swPush.unsubscribe().catch(() => {});
      this.enabled.set(false);
    } finally { this.busy.set(false); }
  }
  /** Guarda (ou renova) a subscrição no Supabase — idempotente pelo endpoint. Devolve false (e preenche `error`) se a gravação falhar. */
  private async save(sub: PushSubscription): Promise<boolean> {
    const { error } = await this.sb.from('push_subscriptions').upsert({ endpoint: sub.endpoint, subscription: sub.toJSON() }, { onConflict: 'endpoint' });
    if (error) { console.error('push_subscriptions', error); this.error.set(`Subscrição não guardada no Supabase: ${error.message}`); return false; }
    this.error.set(null);
    return true;
  }
}

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);
