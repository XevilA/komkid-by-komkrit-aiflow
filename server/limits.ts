import type { Request, Response, NextFunction } from 'express';

/** Small fixed-window limiter keyed by client address (proxy-aware via Express `trust proxy`). */
export function createLimiter(opts: { max: number; windowMs: number; message: string }) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastSweep > opts.windowMs) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= opts.windowMs)) hits.delete(k);
      }
      lastSweep = now;
    }
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const recent = (hits.get(key) || []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((opts.windowMs - (now - recent[0])) / 1000)));
      res.status(429).json({ error: opts.message });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
