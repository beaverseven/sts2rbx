// Score + combo (pickups area).
//
//   import { installScore } from './game/score.js';
//   boot({ install: [installAudio, installScore, installUI, installEnemies, installPickups, ...] })
//
// installScore(ctx) replaces the core stub with the real ctx.score. It listens to
//   enemy:killed, pickup:glowcap, pickup:berry, cage:freed, boss:start, boss:phase, boss:defeated,
//   player:hurt (drains the combo), player:died (death counter), level:complete (stops the clock)
// and emits
//   score:award  { points, base, multiplier, position, reason, chain, total, type? }
//   combo:update { chain, multiplier, timeLeft, timeMax }   on every change + ~10 Hz while draining
//   combo:end    { chain, total, score, reason }            total = points earned by that chain
//
// Rules (ARCHITECTURE.md "Scoring and combo"): every scoring event within COMBO_WINDOW s of the
// previous one extends the chain and refills the timer; the multiplier comes from the chain length
// (including the event being scored) and multiplies the points as they are awarded.
import * as THREE from 'three';

/** Base points per scoring event. */
export const POINTS = Object.freeze({
  glowcap: 50, berry: 25, cage: 500,
  grunt: 200, slinger: 250, ironbelly: 400,
  bossPhase: 2000, boss: 5000,
});

/** Seconds a chain survives without a new scoring event. */
export const COMBO_WINDOW = 3.0;

/** [minimum chain, multiplier], highest first. 1-4 x1, 5-9 x2, 10-19 x3, 20-34 x4, 35-49 x5, 50+ x6. */
export const MULTIPLIER_STEPS = Object.freeze([[50, 6], [35, 5], [20, 4], [10, 3], [5, 2], [1, 1]]);

/** Rank thresholds as fractions of maxPossible(), highest first. */
export const RANKS = Object.freeze([['Glowing', 0.95], ['Gold', 0.8], ['Silver', 0.6], ['Bronze', 0.35]]);

/**
 * Average multiplier an expert run sustains. Glowcap trails come in groups of 4-8, often next to
 * bandits and cages, so a skilled player chains 8-20 events at a time: the average multiplier over
 * a chain is 1.5 (chain 8), 1.7 (chain 10), 2.4 (chain 20); the boss's 9000 points mostly land at
 * x1-x2. 1.8 means: Glowing (95 %) = everything collected at a ~1.7x average (expert),
 * Gold (80 %) = everything at ~1.45x, Silver (60 %) = most things with some chaining,
 * Bronze (35 %) = a casual finish.
 */
export const COMBO_FACTOR = 1.8;

/** Boss points available in a fight: phases 2 and 3 + the defeat. */
const BOSS_TOTAL = 2 * POINTS.bossPhase + POINTS.boss;

const UPDATE_INTERVAL = 0.1; // s between throttled combo:update events while the timer drains
const SCAN_INTERVAL = 0.5;   // s between enemy registry scans (for maxPossible)

/** Multiplier for a chain length. */
export function multiplierFor(chain) {
  for (let i = 0; i < MULTIPLIER_STEPS.length; i++) if (chain >= MULTIPLIER_STEPS[i][0]) return MULTIPLIER_STEPS[i][1];
  return 1;
}

/**
 * Rank from a score and the level's estimated maximum.
 * 'Glowing' >= 95 %, 'Gold' >= 80 %, 'Silver' >= 60 %, otherwise 'Bronze' (the 35 % Bronze
 * threshold is reported by rankInfo().qualified; finishing the level always earns at least Bronze).
 */
export function computeRank(total, maxPossible) {
  const ratio = maxPossible > 0 ? total / maxPossible : 0;
  for (let i = 0; i < RANKS.length - 1; i++) if (ratio >= RANKS[i][1]) return RANKS[i][0];
  return 'Bronze';
}

export function installScore(ctx) {
  const score = createScore(ctx);
  ctx.score = score;
  return score;
}

function createScore(ctx) {
  const { events } = ctx;
  const items = new Map();          // kind -> Set(key) of registered collectables (glowcap, cage, ...)
  const enemyReg = new Map();       // entity -> { points, killed }
  const typeOverride = Object.create(null);
  let drainAcc = 0, scanAcc = 0;
  let bossSeen = false;
  let bossPhaseAwarded = 1;          // highest boss phase already paid for (phase 1 is the fight start)
  let levelBase = 0;                 // pinned base points of the whole level (integration), 0 = estimate

  const itemSet = (kind) => {
    let s = items.get(kind);
    if (!s) { s = new Set(); items.set(kind, s); }
    return s;
  };

  const score = {
    isStub: false,
    POINTS, COMBO_WINDOW,
    // --- live state (core's __game.state() reads points / chain / multiplier / timeLeft)
    points: 0,
    get total() { return score.points; },
    chain: 0,
    multiplier: 1,
    timeLeft: 0,
    timeMax: COMBO_WINDOW,
    comboPoints: 0,       // points earned by the running chain
    bestChain: 0,
    // --- counters
    glowcaps: 0,
    get glowcapsTotal() { return itemSet('glowcap').size; },
    cagesFreed: 0,
    get cagesTotal() { return itemSet('cage').size; },
    kills: 0,
    killsByType: {},
    berries: 0,
    deaths: 0,
    elapsed: 0,           // seconds spent in ctx.state === 'playing'
    bossDefeated: false,
    completed: false,     // set on level:complete (stops the clock and further awards)

    multiplierFor,
    computeRank,

    /**
     * Award `base` points (multiplied by the combo). Extends/starts the chain.
     * reason: 'glowcap' | 'berry' | 'cage' | 'enemy' | 'bossPhase' | 'boss' | any string.
     * Returns the points actually added.
     */
    award(base, reason = 'misc', position = null, extra = null) {
      if (!(base > 0) || score.completed) return 0;
      if (score.chain > 0 && score.timeLeft > 0) score.chain++;
      else { score.chain = 1; score.comboPoints = 0; }
      score.multiplier = multiplierFor(score.chain);
      const pts = Math.round(base * score.multiplier);
      score.points += pts;
      score.comboPoints += pts;
      score.timeLeft = score.timeMax;
      drainAcc = 0;
      if (score.chain > score.bestChain) score.bestChain = score.chain;
      const payload = {
        points: pts, base, multiplier: score.multiplier,
        position: position ? new THREE.Vector3(position.x, position.y, position.z) : null,
        reason, chain: score.chain, total: score.points,
      };
      if (extra) Object.assign(payload, extra);
      events.emit('score:award', payload);
      emitUpdate();
      return pts;
    },

    /** End the running chain now (reason: 'hurt' | 'died' | 'timeout' | 'reset' | ...). */
    breakCombo(reason = 'manual') {
      if (score.chain <= 0) return false;
      endCombo(reason);
      return true;
    },

    /** Pickups register every collectable once (deduped by key, so level re-spawns do not double count). */
    registerItem(kind, key) { itemSet(kind).add(key); },
    itemTotal(kind) { return itemSet(kind).size; },

    /** Override the points for an enemy:killed type (e.g. sandbox dummies). null removes the override. */
    setTypePoints(type, pts) {
      if (pts === null || pts === undefined) delete typeOverride[type];
      else typeOverride[type] = pts;
    },

    /**
     * Estimated maximum score of the level from the registered totals: every glowcap, cage,
     * enemy spawned so far (incl. arena waves / boss minions once they appear) and the boss,
     * times COMBO_FACTOR. Berries are excluded (they can only be taken when hurt).
     */
    maxPossible() {
      // integration pins the whole level's base (every glowcap, cage, enemy incl. arena waves, boss):
      // the maximum then no longer drifts as waves and boss minions appear
      if (levelBase > 0) return Math.max(Math.round(levelBase * COMBO_FACTOR), score.points, 1);
      scanEnemies();
      let base = score.glowcapsTotal * POINTS.glowcap + score.cagesTotal * POINTS.cage;
      for (const rec of enemyReg.values()) base += rec.points;
      if (bossSeen) base += BOSS_TOTAL;
      return Math.max(Math.round(base * COMBO_FACTOR), score.points, 1);
    },

    /** Pin the level's base points (before COMBO_FACTOR); 0 returns to the running estimate. */
    setLevelBase(base) { levelBase = base > 0 ? base : 0; },
    get levelBase() { return levelBase; },

    /** { rank, ratio, qualified (>= Bronze threshold), next, nextAt (points for the next rank) } */
    rankInfo(total = score.points, max = score.maxPossible()) {
      const ratio = max > 0 ? total / max : 0;
      const rank = computeRank(total, max);
      let next = null, nextAt = null;
      for (let i = RANKS.length - 1; i >= 0; i--) {
        if (ratio < RANKS[i][1] && RANKS[i][0] !== 'Bronze') { next = RANKS[i][0]; nextAt = Math.ceil(RANKS[i][1] * max); break; }
      }
      return { rank, ratio, qualified: ratio >= RANKS[RANKS.length - 1][1], next, nextAt, maxPossible: max };
    },

    /** Plain JSON-safe copy of every counter (used for level:complete stats and the results screen). */
    snapshot() {
      return {
        total: score.points,
        points: score.points,
        chain: score.chain,
        multiplier: score.multiplier,
        bestChain: score.bestChain,
        glowcaps: score.glowcaps,
        glowcapsTotal: score.glowcapsTotal,
        cagesFreed: score.cagesFreed,
        cagesTotal: score.cagesTotal,
        kills: score.kills,
        killsByType: { ...score.killsByType },
        berries: score.berries,
        deaths: score.deaths,
        elapsed: Math.round(score.elapsed * 100) / 100,
        bossDefeated: score.bossDefeated,
        maxPossible: score.maxPossible(),
      };
    },

    /** Hot reload (integration): take the counters back from a snapshot(); the world itself is fresh. */
    restore(snap) {
      if (!snap || typeof snap !== 'object') return;
      const n = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
      score.points = Math.round(n(snap.total ?? snap.points));
      score.bestChain = n(snap.bestChain); score.glowcaps = n(snap.glowcaps); score.cagesFreed = n(snap.cagesFreed);
      score.kills = n(snap.kills); score.berries = n(snap.berries); score.deaths = n(snap.deaths); score.elapsed = n(snap.elapsed);
      score.killsByType = {};
      if (snap.killsByType && typeof snap.killsByType === 'object') for (const k of Object.keys(snap.killsByType)) score.killsByType[k] = n(snap.killsByType[k]);
      score.chain = 0; score.multiplier = 1; score.timeLeft = 0; score.comboPoints = 0;
      emitUpdate();
    },

    /** New run: zero every counter (registered item totals are kept; they describe the level). */
    reset() {
      score.points = 0; score.chain = 0; score.multiplier = 1; score.timeLeft = 0; score.comboPoints = 0;
      score.bestChain = 0; score.glowcaps = 0; score.cagesFreed = 0; score.kills = 0; score.killsByType = {};
      score.berries = 0; score.deaths = 0; score.elapsed = 0; score.bossDefeated = false; score.completed = false;
      bossPhaseAwarded = 1;
      for (const [e, rec] of enemyReg) if (rec.killed || !e.alive) enemyReg.delete(e);
      emitUpdate();
    },
  };

  function emitUpdate() {
    events.emit('combo:update', { chain: score.chain, multiplier: score.multiplier, timeLeft: Math.max(0, score.timeLeft), timeMax: score.timeMax });
  }

  function endCombo(reason) {
    const chain = score.chain, total = score.comboPoints;
    score.chain = 0; score.multiplier = 1; score.timeLeft = 0; score.comboPoints = 0;
    emitUpdate();
    events.emit('combo:end', { chain, total, score: score.points, reason });
  }

  function scanEnemies() {
    const list = ctx.entities ? ctx.entities.list : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || !e.tags) continue;
        if (e.tags.has('boss')) { bossSeen = true; continue; }
        if (!(e.tags.has('enemy') || e.tags.has('bandit')) || enemyReg.has(e)) continue;
        const pts = pointsForType(e.type, typeof e.points === 'number' ? e.points : undefined);
        if (pts > 0) enemyReg.set(e, { points: pts, killed: false });
      }
    }
    // despawned without being killed (level reset, boss minions poofing): no longer obtainable
    for (const [e, rec] of enemyReg) if (!rec.killed && !e.alive) enemyReg.delete(e);
  }

  function pointsForType(type, given) {
    if (type in typeOverride) return typeOverride[type];
    if (typeof given === 'number') return given;
    return POINTS[type] ?? 0;
  }

  // --- listeners -------------------------------------------------------------
  events.on('enemy:killed', (p) => {
    if (!p) return;
    const base = pointsForType(p.type, p.points);
    if (p.entity) {
      const rec = enemyReg.get(p.entity);
      if (rec) { rec.killed = true; rec.points = Math.max(rec.points, base); }
      else if (base > 0) enemyReg.set(p.entity, { points: base, killed: true });
    }
    if (!(base > 0)) return; // dummies and other 0-point kills are not scoring events
    score.kills++;
    score.killsByType[p.type] = (score.killsByType[p.type] || 0) + 1;
    score.award(base, 'enemy', p.position || (p.entity && p.entity.position) || null, { type: p.type });
  });

  events.on('pickup:glowcap', (p) => {
    score.glowcaps++;
    score.award(p && typeof p.points === 'number' ? p.points : POINTS.glowcap, 'glowcap', p && p.position);
  });

  events.on('pickup:berry', (p) => {
    score.berries++;
    score.award(POINTS.berry, 'berry', p && p.position);
  });

  events.on('cage:freed', (p) => {
    score.cagesFreed++;
    score.award(p && typeof p.points === 'number' ? p.points : POINTS.cage, 'cage', p && p.position);
  });

  const bossPosition = () => {
    const b = ctx.enemies && ctx.enemies.boss ? ctx.enemies.boss() : null;
    return b ? b.position : null;
  };
  events.on('boss:start', () => { bossSeen = true; });
  events.on('boss:phase', (p) => {
    bossSeen = true;
    const phase = p && p.phase ? p.phase : 0;
    // phase 1 fires at the start of the fight; phases 2 and 3 mean the previous phase was beaten
    if (phase >= 2 && phase > bossPhaseAwarded) {
      bossPhaseAwarded = phase;
      score.award(POINTS.bossPhase, 'bossPhase', bossPosition(), { phase });
    }
  });
  events.on('boss:defeated', (p) => {
    bossSeen = true;
    if (score.bossDefeated) return;
    score.bossDefeated = true;
    score.award(POINTS.boss, 'boss', (p && p.position) || bossPosition());
  });

  events.on('player:hurt', () => { if (score.chain > 0) endCombo('hurt'); });
  events.on('player:died', () => {
    score.deaths++;
    if (score.chain > 0) endCombo('died');
  });
  events.on('level:complete', () => { score.completed = true; });

  // --- per-step system: play clock, combo timer, enemy registry --------------------
  ctx.addSystem({
    order: 50,
    update(dt) {
      const playing = ctx.state === 'playing';
      if (playing && !score.completed) score.elapsed += dt;
      if (score.chain > 0 && playing) {
        score.timeLeft -= dt;
        if (score.timeLeft <= 0) { score.timeLeft = 0; endCombo('timeout'); }
        else if ((drainAcc += dt) >= UPDATE_INTERVAL) { drainAcc = 0; emitUpdate(); }
      }
      if ((scanAcc += dt) >= SCAN_INTERVAL) { scanAcc = 0; scanEnemies(); }
    },
  });

  return score;
}
