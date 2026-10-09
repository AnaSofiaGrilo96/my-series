/** Confetis em canvas, sem dependências. Usar em momentos de celebração (temporada/série completa). */
export function confetti(opts: { count?: number; duration?: number } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const count = opts.count ?? 140, duration = opts.duration ?? 1800;
  const c = document.createElement('canvas');
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '100' });
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!; ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#ffd400', '#4cc24a', '#8e44ff', '#ff6b6b', '#4da3ff', '#ffffff'];
  const R = (a: number, b: number) => a + Math.random() * (b - a);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + R(-40, 40), y: innerHeight * 0.55,
    vx: R(-9, 9), vy: R(-16, -6), g: R(.25, .45), w: R(6, 11), h: R(4, 8),
    rot: R(0, Math.PI * 2), vr: R(-.25, .25), color: colors[Math.floor(R(0, colors.length))],
  }));
  const t0 = performance.now();
  const frame = (t: number) => {
    const k = (t - t0) / duration;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = k < .7 ? 1 : 1 - (k - .7) / .3;
    for (const p of parts) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
  (navigator as any).vibrate?.([30, 40, 30]);
}

/** Pequena vibração de confirmação (Android). */
export function tap() { (navigator as any).vibrate?.(12); }
