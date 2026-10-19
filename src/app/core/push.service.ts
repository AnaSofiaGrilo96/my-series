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
  readonly enabled = signal(false);
  readonly denied = signal(typeof Notification !== 'undefined' && Notification.permission === 'denied');
  readonly busy = signal(false);

  constructor() {
    if (this.supported) this.swPush.subscription.subscribe(sub => { this.enabled.set(!!sub); if (sub) this.save(sub); });
  }

  async enable() {
    this.busy.set(true);
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
      await this.save(sub);
      this.enabled.set(true);
    } catch { this.denied.set(Notification.permission === 'denied'); }
    finally { this.busy.set(false); }
  }
  async disable() {
    this.busy.set(true);
    try {
      const sub = await firstValueFrom(this.swPush.subscription);
      if (sub) await this.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await this.swPush.unsubscribe().catch(() => {});
      this.enabled.set(false);
    } finally { this.busy.set(false); }
  }
  /** Guarda (ou renova) a subscrição no Supabase — idempotente pelo endpoint. */
  private save(sub: PushSubscription) {
    return this.sb.from('push_subscriptions').upsert({ endpoint: sub.endpoint, subscription: sub.toJSON() }, { onConflict: 'endpoint' });
  }
}
