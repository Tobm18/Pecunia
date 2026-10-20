/**
 * Mouvement « physique » à la manière d'Apple (WWDC 2018, Designing Fluid Interfaces) :
 * ressorts définis par un amortissement (damping) et une réactivité (response, en s),
 * interruptibles et repris depuis la valeur et la vitesse affichées, projection de l'élan
 * et résistance élastique aux bords.
 */

export interface SpringConfig {
  /** 1 = sans rebond (amortissement critique), < 1 = rebondit */
  damping: number;
  /** Rapidité pour atteindre la cible, en secondes (ce n'est pas une durée fixe) */
  response: number;
}

/** Valeurs de référence : sans rebond par défaut, léger rebond seulement après un geste avec élan. */
export const SPRINGS = {
  default: { damping: 1, response: 0.35 },
  sheet: { damping: 1, response: 0.3 },
  momentum: { damping: 0.8, response: 0.3 },
} satisfies Record<string, SpringConfig>;

export interface SpringState {
  value: number;
  /** unités par seconde */
  velocity: number;
}

/** Avance l'état d'un ressort de `dt` secondes vers `target` (masse 1, sous-pas fixes). */
export function stepSpring(state: SpringState, target: number, config: SpringConfig, dt: number): SpringState {
  const stiffness = (2 * Math.PI / config.response) ** 2;
  const friction = (4 * Math.PI * config.damping) / config.response;
  let { value, velocity } = state;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const accel = -stiffness * (value - target) - friction * velocity;
    velocity += accel * h; // Euler semi-implicite : stable pour ces raideurs
    value += velocity * h;
  }
  return { value, velocity };
}

/**
 * Point d'arrivée projeté d'un geste lâché à `velocity` (px/s), comme la décélération du
 * défilement. 0,998 = défilement normal, 0,99 = plus sec.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Résistance progressive au-delà d'un bord : plus on tire, moins l'élément suit. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Vitesse (unités/s) d'après un historique récent de positions horodatées (ms). */
export function velocityFrom(history: { t: number; v: number }[], windowMs = 100): number {
  if (history.length < 2) return 0;
  const last = history[history.length - 1]!;
  const first = history.find((p) => last.t - p.t <= windowMs) ?? history[0]!;
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? (last.v - first.v) / dt : 0;
}

export interface SpringAnimation {
  /** Arrête et renvoie l'état affiché (pour enchaîner sans saut ni rupture de vitesse) */
  stop(): SpringState;
  readonly state: SpringState;
}

/**
 * Anime une valeur par ressort avec requestAnimationFrame. Part de `from` et `velocity`
 * (l'état affiché au moment de l'interruption) : une nouvelle animation reprend toujours
 * là où la précédente en était.
 */
export function animateSpring(opts: {
  from: number;
  to: number;
  velocity?: number;
  config?: SpringConfig;
  /** Seuil d'arrêt, dans l'unité animée */
  restDelta?: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}): SpringAnimation {
  const { to, config = SPRINGS.default, restDelta = 0.5, onUpdate, onComplete } = opts;
  let state: SpringState = { value: opts.from, velocity: opts.velocity ?? 0 };
  let last = performance.now();
  let frame = 0;
  let done = false;

  const tick = (now: number) => {
    const dt = Math.min(0.064, (now - last) / 1000); // onglet en arrière-plan : pas de saut
    last = now;
    state = stepSpring(state, to, config, dt);
    const settled = Math.abs(state.value - to) < restDelta && Math.abs(state.velocity) < restDelta * 10;
    if (settled) {
      state = { value: to, velocity: 0 };
      onUpdate(to);
      done = true;
      onComplete?.();
      return;
    }
    onUpdate(state.value);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    stop() {
      if (!done) cancelAnimationFrame(frame);
      done = true;
      return state;
    },
    get state() {
      return state;
    },
  };
}
