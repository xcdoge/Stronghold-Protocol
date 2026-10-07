#!/usr/bin/env node
// How far an enemy's animations move its body, read from the extracted Spine models.
//
// Why this exists: a player report about a dying drone "dropping at the end" needed to know whether any of the official
// death animations itself has vertical motion (it does not — see docs/research/13). Keyframe walking is not enough:
// @pixi-spine/runtime-3.8 stores timeline frames as packed numeric arrays, so a `frames[i].y` walk silently reports zero
// motion. This tool instead PLAYS each clip — Skeleton + AnimationState stepped at 30 Hz, apply + updateWorldTransform —
// and samples the root's y and every bone's worldY, which is what the client draws.
//
// Output: per clip category (Die / Idle / Move / Attack / …) the largest root (whole-body) displacement and the largest
// single-bone travel, in tiles (skeleton units × modelScale / 320, the conversion docs/research/12 uses).
//
// Usage (from the repo root, with node_modules installed — it imports the project's @pixi-spine):
//   node tools/local-extract/enemy_animation_motion.mjs                       # every enemy: summary + the Die clips
//   node tools/local-extract/enemy_animation_motion.mjs --only-fly            # the FLY enemies only
//   node tools/local-extract/enemy_animation_motion.mjs --keys enemy_1112_emppnt,enemy_1005_yokai
//   node tools/local-extract/enemy_animation_motion.mjs --clip Die --json out.json
//   node tools/local-extract/enemy_animation_motion.mjs --assets D:\Games\Stronghold-Protocol
//
// The models must be on disk: `node tools/fetch-assets.mjs` (or the local client's own extraction) puts them in
// public/assets. data/assets.json + data/enemies.json supply the paths, modelScale and the FLY/WALK motion.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
const base = opt.assets ? resolve(String(opt.assets)) : ROOT;
const keys = typeof opt.keys === 'string' ? new Set(opt.keys.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const onlyFly = opt['only-fly'] === true;
const clipFilter = typeof opt.clip === 'string' ? opt.clip.toLowerCase() : null;

const require = createRequire(join(ROOT, 'package.json'));
const spine = require('@pixi-spine/runtime-3.8');

const assets = JSON.parse(readFileSync(join(base, 'data/assets.json'), 'utf8'));
const enemies = JSON.parse(readFileSync(join(base, 'data/enemies.json'), 'utf8'));

/** The record's own client def: the nested object that carries `motion` (and usually `modelScale`). */
function findDef(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (typeof o.motion === 'string') return o;
  for (const v of Object.values(o)) { const f = findDef(v, depth + 1); if (f) return f; }
  return null;
}

const reader = new spine.SkeletonBinary({
  newRegionAttachment: (s, n) => new spine.RegionAttachment(n),
  newMeshAttachment: (s, n) => new spine.MeshAttachment(n),
  newBoundingBoxAttachment: (s, n) => new spine.BoundingBoxAttachment(n),
  newPathAttachment: (s, n) => new spine.PathAttachment(n),
  newPointAttachment: (s, n) => new spine.PointAttachment(n),
  newClippingAttachment: (s, n) => new spine.ClippingAttachment(n),
});

/** Play one clip and report the root's and the bones' vertical travel (skeleton units). */
function play(data, name, dur) {
  const skel = new spine.Skeleton(data);
  const state = new spine.AnimationState(new spine.AnimationStateData(data));
  skel.setToSetupPose();
  state.setAnimation(0, name, false);
  const dt = 1 / 30;
  let rootMin = Infinity, rootMax = -Infinity, boneMin = Infinity, boneMax = -Infinity, frames = 0;
  for (let t = 0; t <= dur + 1e-6; t += dt) {
    state.update(dt);
    state.apply(skel);
    skel.updateWorldTransform();
    rootMin = Math.min(rootMin, skel.y); rootMax = Math.max(rootMax, skel.y);
    for (const b of skel.bones) { boneMin = Math.min(boneMin, b.worldY); boneMax = Math.max(boneMax, b.worldY); }
    frames++;
  }
  return { root: rootMax - rootMin, bone: boneMax - boneMin, frames };
}

const CATEGORY = [
  ['Die', /die|dead|death/i], ['Idle', /^idle$|^default$/i], ['Move', /move|walk|run/i],
  ['Attack', /attack|atk/i], ['Skill', /skill/i], ['Start', /start|born|spawn|appear/i],
];

const rows = [];
let missing = 0, unreadable = 0;
for (const [key, a] of Object.entries(assets.enemies || {})) {
  if (keys && !keys.has(key)) continue;
  const sp = a && a.spine;
  const rec = enemies[key] || {};
  const def = findDef(rec) || rec;
  if (onlyFly && def.motion !== 'FLY') continue;
  const name = rec.name || def.name || key;
  if (!sp || !sp.skel) { rows.push({ key, name, fly: def.motion === 'FLY', k: def.modelScale ?? 1, missing: true }); missing++; continue; }
  const skelPath = join(base, 'public', String(sp.skel).replace(/^\//, ''));
  if (!existsSync(skelPath)) { rows.push({ key, name, fly: def.motion === 'FLY', k: def.modelScale ?? 1, missing: true }); missing++; continue; }
  let data;
  try { data = reader.readSkeletonData(new Uint8Array(readFileSync(skelPath))); }
  catch { rows.push({ key, name, fly: def.motion === 'FLY', k: def.modelScale ?? 1, unreadable: true }); unreadable++; continue; }
  const k = def.modelScale ?? 1;
  const tiles = (u) => (u * k / 320);
  const clips = [];
  for (const anim of data.animations) {
    if (clipFilter && anim.name.toLowerCase() !== clipFilter) continue;
    const cat = (CATEGORY.find(([, re]) => re.test(anim.name)) || ['Other'])[0];
    const s = play(data, anim.name, Math.min(anim.duration, 20));
    clips.push({ clip: anim.name, cat, dur: anim.duration, rootTiles: tiles(s.root), boneTiles: tiles(s.bone) });
  }
  rows.push({ key, name, fly: def.motion === 'FLY', motion: def.motion, k, clips });
}

const f3 = (x) => x.toFixed(3);
const hit = rows.filter((r) => r.clips);
console.log(`${hit.length} enemies read${missing ? `, ${missing} without a .skel on disk` : ''}${unreadable ? `, ${unreadable} unreadable` : ''}`
  + `${onlyFly ? ' (FLY only)' : ''} — units: tiles = skeleton units × modelScale / 320\n`);

const cats = new Map();
for (const r of hit) {
  for (const c of r.clips) {
    const cur = cats.get(c.cat) || { n: 0, root: 0, rootOf: '', bone: 0, boneOf: '', dur: 0 };
    cur.n++;
    if (c.rootTiles > cur.root) { cur.root = c.rootTiles; cur.rootOf = `${r.name}/${c.clip}`; }
    if (c.boneTiles > cur.bone) { cur.bone = c.boneTiles; cur.boneOf = `${r.name}/${c.clip}`; }
    if (c.dur > cur.dur) cur.dur = c.dur;
    cats.set(c.cat, cur);
  }
}
console.log('=== per category: largest whole-body (root) travel vs largest single bone ===');
for (const [cat, s] of [...cats].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${cat.padEnd(7)} ${String(s.n).padStart(4)} clips | root ${f3(s.root)} tiles (${s.rootOf || '—'}) | bone ${f3(s.bone)} tiles (${s.boneOf}) | longest ${s.dur.toFixed(2)}s`);
}

const dies = hit.filter((r) => r.clips.some((c) => c.cat === 'Die'));
const withRoot = dies.filter((r) => r.clips.filter((c) => c.cat === 'Die').some((c) => c.rootTiles > 0.01));
console.log(`\n=== Die clips whose body actually moves (root > 0.01 tiles): ${withRoot.length} / ${dies.length} ===`);
for (const r of withRoot.slice(0, 20)) {
  const c = r.clips.find((x) => x.cat === 'Die' && x.rootTiles > 0.01);
  console.log(`  ${r.name.padEnd(24)} ${f3(c.rootTiles)} tiles (${c.clip}, ${c.dur.toFixed(2)}s)`);
}
console.log('\n=== Die durations (longest first) ===');
for (const r of dies.map((r) => ({ ...r, d: r.clips.find((c) => c.cat === 'Die') })).sort((a, b) => b.d.dur - a.d.dur).slice(0, 12)) {
  console.log(`  ${r.name.padEnd(24)} ${r.d.dur.toFixed(2)}s  root ${f3(r.d.rootTiles)}  bone ${f3(r.d.boneTiles)}`);
}
if (onlyFly || keys) {
  console.log('\n=== FLY enemies ===');
  for (const r of hit.filter((x) => x.fly)) {
    const d = r.clips.find((c) => c.cat === 'Die');
    console.log(`  ${r.name.padEnd(24)} Die=${d ? d.dur.toFixed(2) + 's' : '（none）'}  root ${d ? f3(d.rootTiles) : '—'}  bone ${d ? f3(d.boneTiles) : '—'}`);
  }
}

if (typeof opt.json === 'string') {
  writeFileSync(resolve(String(opt.json)), JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${opt.json} (${rows.length} enemies)`);
}
