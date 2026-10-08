// installEnemies(ctx): registers the Bog Bandit spawn types with ctx.entities.
//   'grunt' 'slinger' 'ironbelly' (src/game/enemies/*.js) and 'boss' (src/game/boss.js)
// and creates the shared enemy effect system. Also exposes ctx.enemies (extension):
//   ctx.enemies.fx       shockwave / prop / decal / floater helpers (fx.js)
//   ctx.enemies.list()   live bandits (+ boss) for debugging
//   ctx.enemies.boss()   the boss entity or null
import { Grunt } from './grunt.js';
import { Slinger } from './slinger.js';
import { Ironbelly } from './ironbelly.js';
import { getFx } from './fx.js';
import { getModelKit } from './model.js';
import { createBoss } from '../boss.js';

export { Grunt, Slinger, Ironbelly, createBoss };

export function installEnemies(ctx) {
  const fx = getFx(ctx);
  getModelKit(ctx);
  ctx.entities.registerType('grunt', (c, def) => new Grunt(c, def));
  ctx.entities.registerType('slinger', (c, def) => new Slinger(c, def));
  ctx.entities.registerType('ironbelly', (c, def) => new Ironbelly(c, def));
  ctx.entities.registerType('boss', (c, def) => createBoss(c, def));
  ctx.enemies = {
    fx,
    list: () => ctx.entities.list.filter((e) => e.alive && (e.tags.has('bandit') || e.tags.has('boss'))),
    boss: () => ctx.entities.list.find((e) => e.alive && e.tags.has('boss')) || null,
  };
  return ctx.enemies;
}
