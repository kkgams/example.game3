import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileMap, buildMap } from '../content/maps/build.mjs';

const compiler = fileURLToPath(new URL('../content/maps/build.mjs', import.meta.url));
const arena = JSON.parse(await readFile(new URL('../content/maps/arena.tilemap.json', import.meta.url), 'utf8'));
const world = JSON.parse(await readFile(new URL('../content/maps/world.tilemap.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const cell = (map, x, y) => map.collision[map.height - 1 - y][x];
function setCell(map, x, y, value) { map.collision[map.height - 1 - y][x] = value; }
function generatedCells(header) {
  const array = header.match(/static const uint8_t sim_authored_collision\[\] = \{([\s\S]*?)\};/);
  assert.ok(array);
  return array[1].match(/\d+/g).map(Number);
}
function emptyMap(width, height) {
  return { version: 1, width, height, tileSize: 16, origin: { x: 0, y: 0 }, spawn: { x: 40, y: 40 },
    collision: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
      +(x === 0 || y === 0 || x === width - 1 || y === height - 1))) };
}
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'game3-map-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const input = join(path, 'map.json'), output = join(path, 'nested/map.h');
  await writeFile(input, JSON.stringify(arena));
  return { input, output };
}
const cli = args => spawnSync(process.execPath, [compiler, ...args], { encoding: 'utf8' });

test('arena preserves original dimensions, world coordinates, border and central block', () => {
  assert.deepEqual({ ...arena, collision: undefined }, { version: 1, width: 16, height: 10, tileSize: 16,
    origin: { x: -128, y: -80 }, spawn: { x: -80, y: 0 }, collision: undefined });
  for (let y = 0; y < 10; ++y) for (let x = 0; x < 16; ++x)
    assert.equal(cell(arena, x, y), +(x === 0 || x === 15 || y === 0 || y === 9 ||
      (x >= 7 && x <= 8 && y >= 4 && y <= 5)));
  assert.doesNotThrow(() => compileMap(arena));
});

test('world expands to 32x24, retaining central block with sparse walls and broad lanes', () => {
  assert.equal(world.width, 32); assert.equal(world.height, 24);
  assert.deepEqual(world.origin, { x: -256, y: -192 }); assert.deepEqual(world.spawn, arena.spawn);
  for (const y of [11, 12]) for (const x of [15, 16]) assert.equal(cell(world, x, y), 1);
  const walls = world.collision.flat().filter(v => v === 1).length - (2 * world.width + 2 * world.height - 4);
  assert.ok(walls > 4 && walls < 70);
  for (let y = 1; y < world.height - 1; ++y) for (let x = 1; x < world.width - 1; ++x)
    if (x <= 3 || x >= world.width - 4 || y <= 3 || y >= world.height - 4)
      assert.equal(cell(world, x, y), 0, 'three-tile-wide outer lanes');
  assert.doesNotThrow(() => compileMap(world));
});

test('header reverses authored rows once, without transposition or input mutation', () => {
  const map = clone(arena); setCell(map, 2, 2, 1); setCell(map, 11, 7, 1);
  const before = clone(map), header = compileMap(map), cells = generatedCells(header);
  assert.deepEqual(map, before); assert.deepEqual(cells, [...map.collision].reverse().flat());
  assert.equal(cells[2 * map.width + 2], 1); assert.equal(cells[7 * map.width + 11], 1);
  assert.equal(cells[7 * map.width + 2], 0);
  assert.match(header, /#include "map.h"/); assert.match(header, /static const sim_map sim_authored_map =/);
  for (const field of ['width', 'height', 'tile_size', 'origin_x', 'origin_y', 'spawn_x', 'spawn_y', 'collision'])
    assert.ok(header.includes(`.${field} = `), field);
});

test('compilation is deterministic and independent of key order and machine paths', () => {
  const header = compileMap(arena);
  assert.equal(compileMap(clone(arena)), header);
  assert.equal(compileMap(Object.fromEntries(Object.entries(arena).reverse())), header);
  assert.ok(header.endsWith('\n')); assert.ok(!header.includes(fileURLToPath(new URL('..', import.meta.url))));
  assert.notEqual(compileMap(world), header);
});

test('dimensions accept inclusive bounds 8..64, reject noninteger or out-of-range values', () => {
  for (const width of [8, 64]) for (const height of [8, 64])
    assert.doesNotThrow(() => compileMap(emptyMap(width, height)));
  for (const name of ['width', 'height']) for (const value of [7, 65, 8.5, '16', true, null, NaN, Infinity]) {
    const map = clone(arena); map[name] = value; assert.throws(() => compileMap(map), /integer from 8 to 64/);
  }
});

test('strict root/point schemas require explicit fields and finite numeric coordinates', () => {
  for (const value of [null, [], 1, 'map', true]) assert.throws(() => compileMap(value), /object/);
  for (const field of Object.keys(arena)) {
    const map = clone(arena); delete map[field]; assert.throws(() => compileMap(map), /exactly/);
  }
  const extra = clone(arena); extra.name = 'arena'; assert.throws(() => compileMap(extra), /exactly/);
  for (const field of ['origin', 'spawn']) {
    for (const value of [null, [], { x: 0 }, { x: 0, y: 0, z: 0 }]) {
      const map = clone(arena); map[field] = value; assert.throws(() => compileMap(map));
    }
    for (const axis of ['x', 'y']) for (const value of [true, null, '0', NaN, Infinity, -Infinity, 32769, -32769, 1e100]) {
      const map = clone(arena); map[field][axis] = value; assert.throws(() => compileMap(map), /finite number/);
    }
  }
  for (const [field, values] of [['version', [0, 2, '1', true]], ['tileSize', [8, 32, '16', true]]])
    for (const value of values) { const map = clone(arena); map[field] = value; assert.throws(() => compileMap(map)); }
});

test('collision matrix requires exact rows and binary numbers, never booleans or holes', () => {
  for (const change of [m => { m.collision = {}; }, m => m.collision.pop(), m => m.collision.push(m.collision[0]),
    m => { m.collision[2] = null; }, m => m.collision[2].pop(), m => m.collision[2].push(0),
    m => { delete m.collision[2][2]; }]) {
    const map = clone(arena); change(map); assert.throws(() => compileMap(map), /collision/);
  }
  for (const value of [true, false, '0', '1', null, -1, 2, 0.5, NaN, Infinity]) {
    const map = clone(arena); map.collision[2][2] = value; assert.throws(() => compileMap(map), /number 0 or 1/);
  }
});

test('outer walls are sealed and all free cells must be cardinally connected', () => {
  for (const [x, y] of [[0, 3], [15, 3], [3, 0], [3, 9], [0, 0]]) {
    const map = clone(arena); setCell(map, x, y, 0); assert.throws(() => compileMap(map), /sealed outer walls/);
  }
  const divided = clone(arena);
  for (let y = 1; y < divided.height - 1; ++y) setCell(divided, 5, y, 1);
  assert.throws(() => compileMap(divided), /connected/);
  const diagonal = emptyMap(8, 8);
  for (const [x, y] of [[1, 2], [2, 1]]) setCell(diagonal, x, y, 1);
  assert.throws(() => compileMap(diagonal), /connected/);
  const solid = clone(arena); solid.collision.forEach(row => row.fill(1));
  assert.throws(() => compileMap(solid), /walkable cells/);
});

test('at least eight useful free inner-perimeter cells are required', () => {
  function limited(count) {
    const map = emptyMap(10, 10);
    for (let y = 1; y <= 8; ++y) for (let x = 1; x <= 8; ++x)
      if (x === 1 || x === 8 || y === 1 || y === 8) setCell(map, x, y, 1);
    for (let x = 1; x <= Math.min(count, 6); ++x) setCell(map, x + 1, 1, 0);
    if (count > 6) setCell(map, 1, 2, 0);
    if (count > 7) setCell(map, 1, 3, 0);
    return map;
  }
  assert.throws(() => compileMap(limited(7)), /at least 8/);
  assert.doesNotThrow(() => compileMap(limited(8)));
});

test('spawn uses world coordinates and its full 10x10 AABB must fit free space', () => {
  for (const spawn of [{ x: -128, y: 0 }, { x: 0, y: 0 }, { x: -1000, y: 0 },
    { x: -17, y: 0 }, { x: -80, y: -62 }, { x: -80, y: 62 }, { x: 115, y: 0 }]) {
    const map = clone(arena); map.spawn = spawn; assert.throws(() => compileMap(map), /AABB/);
  }
  const touching = clone(arena); touching.spawn = { x: -21, y: 0 };
  assert.doesNotThrow(() => compileMap(touching));
  touching.spawn.x += 0.001; assert.throws(() => compileMap(touching), /AABB/);
  const shifted = clone(arena);
  shifted.origin.x += 0.25; shifted.origin.y -= 0.5; shifted.spawn.x += 0.25; shifted.spawn.y -= 0.5;
  assert.match(compileMap(shifted), /\.origin_x = -127.75, \.origin_y = -80.5/);
});

test('buildMap writes stable headers, creates directories and preserves no-op mtime', async t => {
  const { input, output } = await fixture(t), expected = compileMap(arena);
  assert.equal(await buildMap({ input, output }), expected); assert.equal(await readFile(output, 'utf8'), expected);
  const old = new Date('2001-01-01T00:00:00Z'); await utimes(output, old, old);
  const before = (await stat(output)).mtimeMs;
  assert.equal(await buildMap({ input, output }), expected); assert.equal((await stat(output)).mtimeMs, before);
  await writeFile(input, JSON.stringify(world)); await buildMap({ input, output });
  assert.equal(await readFile(output, 'utf8'), compileMap(world));
});

test('check mode validates without creating or changing output, even a stale header', async t => {
  const { input, output } = await fixture(t);
  assert.equal(await buildMap({ input, output, checkOnly: true }), compileMap(arena));
  await assert.rejects(access(output), /ENOENT/);
  assert.equal(cli([input, output, '--check']).status, 0); await assert.rejects(access(output), /ENOENT/);
  await buildMap({ input, output }); await writeFile(output, 'intentionally stale');
  assert.equal(cli([input, output, '--check']).status, 0);
  assert.equal(await readFile(output, 'utf8'), 'intentionally stale');
});

test('failed CLI input/arguments never overwrite a valid generated header', async t => {
  const { input, output } = await fixture(t);
  const initial = cli([input, output]); assert.equal(initial.status, 0, initial.stderr);
  const expected = await readFile(output, 'utf8');
  for (const args of [[], [input], [input, output, '--unknown'], [input, output, '--check', 'extra'], ['--check', output]])
    assert.notEqual(cli(args).status, 0);
  for (const source of ['{broken', JSON.stringify({ ...arena, width: 7 }), JSON.stringify({ ...arena, spawn: { x: 0, y: 0 } })]) {
    await writeFile(input, source);
    for (const suffix of [[], ['--check']]) {
      const result = cli([input, output, ...suffix]); assert.notEqual(result.status, 0); assert.ok(result.stderr.length > 0);
      assert.equal(await readFile(output, 'utf8'), expected);
    }
    await assert.rejects(buildMap({ input, output }));
  }
  await rm(input); assert.notEqual(cli([input, output]).status, 0);
  assert.equal(await readFile(output, 'utf8'), expected);
});
