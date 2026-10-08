// createContext() -> ctx, the single object passed to every system.
// boot() fills in renderer/scene/camera/input/physics/... ; this file only defines
// the shape, the state machine helper and the silent stubs for areas that are
// installed later (audio, score, hud, menus, level).
import * as THREE from 'three';
import { createEvents } from './events.js';

export const FIXED_DT = 1 / 60;
export const STATES = ['boot', 'title', 'playing', 'paused', 'dead', 'results'];

export function createContext() {
  const ctx = {
    THREE,
    renderer: null, scene: null, camera: null,
    gfx: null,                // core extension: renderer module (quality, sky, lights, render())
    events: createEvents(),
    input: null, physics: null, entities: null, particles: null, materials: null,
    projectiles: null,        // core: ctx.projectiles (contract section "Projectiles")
    audio: createAudioStub(),
    player: null, cameraRig: null,
    score: createScoreStub(), hud: createHudStub(), menus: createMenusStub(), level: createLevelStub(),
    time: { now: 0, dt: FIXED_DT, frame: 0, real: 0 }, // now/frame: simulation; real: wall-clock seconds since boot
    state: 'boot',
    settings: { sensitivity: 1, invertY: false, master: 0.8, music: 0.6, sfx: 0.9, quality: 'high' },
    flags: {},
    systems: [],              // core extension, see addSystem()

    /** Change game state and emit game:state { state, prev }. No-op if unchanged. */
    setState(state) {
      const prev = ctx.state;
      if (prev === state) return;
      ctx.state = state;
      ctx.events.emit('game:state', { state, prev });
    },

    /** True while the fixed-step simulation runs (playing, dead). */
    get simulating() { return ctx.state === 'playing' || ctx.state === 'dead'; },

    /**
     * Register a per-step/per-frame system (core extension).
     *   sys.update?(dt, ctx)  every fixed step while simulating (after entities, player, projectiles)
     *   sys.frame?(realDt, ctx) every rendered frame in every state (menus, HUD animation, shaders)
     *   sys.order (number, default 0) lower runs first
     * Returns a function that removes the system.
     */
    addSystem(sys) {
      sys.order = sys.order ?? 0;
      ctx.systems.push(sys);
      ctx.systems.sort((a, b) => a.order - b.order);
      return () => {
        const i = ctx.systems.indexOf(sys);
        if (i >= 0) ctx.systems.splice(i, 1);
      };
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Silent stubs. Each real area replaces the whole object (ctx.audio = ...).
// They expose the contract method names so callers never need null checks.

export function createAudioStub() {
  return {
    isStub: true,
    unlock() {},
    play(_name, _opts) {},
    music(_track) {},
    setVolumes(_v) {},
  };
}

export function createScoreStub() {
  // Fields core reads for __game.state(): points, chain, multiplier.
  return {
    isStub: true,
    points: 0, chain: 0, multiplier: 1, timeLeft: 0,
    reset() { this.points = 0; this.chain = 0; this.multiplier = 1; this.timeLeft = 0; },
  };
}

export function createHudStub() {
  return {
    isStub: true,
    toast(_text, _sec) {},
    showBossBar(_on) {},
  };
}

export function createMenusStub() {
  return {
    isStub: true,
    show(_name, _data) {},
    hide() {},
  };
}

export function createLevelStub() {
  // Shape of a level object returned by boot({ buildLevel }) — see docs/core.md.
  return {
    isStub: true,
    name: 'none',
    spawn: { position: [0, 2, 0], yaw: 0 },
    checkpoints: [],   // [{ id, position:[x,y,z], yaw }] in progression order
    zone: null,        // current zone id (level area updates it)
    update(_dt, _ctx) {},
    frame(_realDt, _ctx) {},
  };
}
