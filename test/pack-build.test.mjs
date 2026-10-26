import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPack, encodePack } from '../content/gams/pack.mjs';
import { embedPack } from '../content/gams/embed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const schema = await readJSON(join(root, 'content/gams/schema/bulletml.rspk.json'));
const sourcePaths = ['content/bulletml/ranger-fan.bulletml.json', 'content/bulletml/aim.bulletml.json'];
const patterns = await Promise.all(sourcePaths.map(p => readJSON(join(root, p))));
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'game3-pack-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  await cp(join(root, 'content'), join(path, 'content'), { recursive: true });
  return path;
}
async function changeJSON(root, path, change) {
  const full = join(root, path), value = await readJSON(full);
  change(value);
  await writeFile(full, JSON.stringify(value));
}

test('portable pack is deterministic RSPK v1 with one pattern vector', () => {
  const a = encodePack(schema, patterns);
  assert.deepEqual(a, encodePack(structuredClone(schema), structuredClone(patterns)));
  assert.equal(a.length, 344);
  assert.equal(a.toString('ascii', 0, 4), 'RSPK');
  assert.equal(a.readUInt16LE(4), 1);
  assert.equal(a.readUInt16LE(6), 1);
  assert.equal(a.readUInt32LE(8), 16);
  assert.equal(a.readUInt32LE(12), 328);
  assert.equal(a.readUInt32LE(16), 2);
});

test('optional manually supplied published GAMS artifact has exact byte parity', async t => {
  // Set GAMS_PACK_FIXTURE to an independently generated artifact; no Host needed.
  const path = process.env.GAMS_PACK_FIXTURE;
  if (!path) return t.skip('set GAMS_PACK_FIXTURE to a published-plugin output');
  assert.deepEqual(encodePack(schema, patterns), await readFile(path));
});

test('isolated graph build and both CLIs need only Node', async t => {
  const path = await fixture(t);
  const result = await buildPack({ root: path });
  assert.equal(result.output, join(path, 'build.nosync/content/bulletml.rspk'));
  assert.equal(result.patterns, 2);
  assert.deepEqual(await readFile(result.output), encodePack(schema, patterns));
  // This is how the released editor persists an edited Value node: output
  // labels become empty; topology/IDs and literal values are unchanged.
  await changeJSON(path, 'content/gams/graphs/bulletml.ng.json', graph => {
    for (const node of graph.filter(node => node.kind === 4)) {
      node.x += 10; node.name += ' edited';
      for (const port of node.outputs) port.name = '';
    }
  });
  const run = spawnSync(process.execPath, [join(root, 'content/gams/pack.mjs')], { cwd: path, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const output = join(path, 'build.nosync/content/bulletml-pack.h');
  const embed = spawnSync(process.execPath, [join(root, 'content/gams/embed.mjs'), result.output, output], { cwd: path, encoding: 'utf8' });
  assert.equal(embed.status, 0, embed.stderr);
  assert.equal(await readFile(output, 'utf8'), embedPack(result.bytes));
  const overridden = await buildPack({ root: path, output: 'build.nosync/custom/pack.rspk' });
  assert.deepEqual(overridden.bytes, result.bytes);
  await assert.rejects(buildPack({ root: path, output: '../escaped.rspk' }), /output/);
});

test('each source cadence/spread edit changes pack and embedded bytes', async t => {
  const path = await fixture(t);
  const initial = await buildPack({ root: path });
  for (const source of sourcePaths) {
    await changeJSON(path, source, p => { p.actions[1].find(c => Object.hasOwn(c, 'wait')).wait += 7; });
    const changed = await buildPack({ root: path });
    assert.notDeepEqual(changed.bytes, initial.bytes);
    assert.notEqual(embedPack(changed.bytes), embedPack(initial.bytes));
    await cp(join(root, source), join(path, source));
  }
  await changeJSON(path, sourcePaths[0], p => { p.actions[1][1].fireRef.params[0] = -25; });
  assert.notDeepEqual((await buildPack({ root: path })).bytes, initial.bytes);
});

test('defaults are byte-identical to explicit fields', () => {
  const explicit = structuredClone(patterns);
  explicit[1].bullets[0].actionRefs = [];
  assert.deepEqual(encodePack(schema, explicit), encodePack(schema, patterns));
  const omitted = structuredClone(patterns), expanded = structuredClone(patterns);
  omitted[0].bullets[0] = {};
  expanded[0].bullets[0] = { direction: { type: 'absolute', value: 0 }, speed: { type: 'absolute', value: 1 }, actionRefs: [] };
  assert.deepEqual(encodePack(schema, omitted), encodePack(schema, expanded));
});

test('all command variants and nested Expr/Ref representations encode', () => {
  const p = structuredClone(patterns[0]);
  p.actions[1] = [
    { fireRef: { RefWithParams: { ref: 0, params: [{ ExprNumber: 3 }, { ExprString: '$1' }] } } },
    { actionRef: { RefIndex: 0 } }, { wait: '1+$rand' },
    { repeat: { times: 3, actionRef: { ref: 0 } } }, { vanish: true },
    { changeDirection: { direction: { type: 'relative', value: 10 }, term: 3 } },
    { changeSpeed: { speed: { type: 'sequence', value: 1 }, term: '$1' } },
    { accel: { term: 4 } },
  ];
  const bytes = encodePack(schema, [p]);
  assert.ok(bytes.length > 200);
  assert.equal(bytes.readUInt32LE(16), 1);
  const synthetic = { data: ['Items'], types: { Items: { type: 'vector', value: 'Item' }, Alias: 'f64', Item: { type: 'struct', fields: { n: 'Alias', s: 'string', u: 'u32', b: 'bool', e: { type: 'enum', value: ['a', 'b'] } } } } };
  const out = encodePack(synthetic, [{ n: 1.5, s: 'é', u: 0xffffffff, b: false, e: 'b' }]);
  const expected = Buffer.alloc(27);
  expected.writeUInt32LE(1); expected.writeDoubleLE(1.5, 4); expected.writeUInt32LE(2, 12);
  expected.write('é', 16, 'utf8'); expected.writeUInt32LE(0xffffffff, 18); expected[22] = 0; expected.writeUInt32LE(1, 23);
  assert.deepEqual(out.subarray(16), expected);
});

test('malformed pattern primitives, fields and variants fail loudly', () => {
  for (const value of [NaN, Infinity, -Infinity, null, true]) {
    const p = structuredClone(patterns); p[0].actions[1][0].wait = value;
    assert.throws(() => encodePack(schema, p), /oneof/);
  }
  for (const ref of [-1, 0x100000000, 1.2, '0', null]) {
    const p = structuredClone(patterns); p[0].fires[0].bulletRef = ref;
    assert.throws(() => encodePack(schema, p), /oneof/);
  }
  for (const change of [p => delete p[0].type, p => { p[0].type = 'unknown'; }, p => { p[0].bullets = {}; }, p => { p[0].extra = 1; }, p => { p[0].actions[0][0] = { unsupported: 1 }; }, p => { p[0].actions[0][0] = { wait: 1, vanish: true }; }, p => { p[0].actions[0][0] = { vanish: 1 }; }]) {
    const p = structuredClone(patterns); change(p); assert.throws(() => encodePack(schema, p));
  }
});

test('unsupported/ambiguous schema is rejected even in unused definitions', () => {
  for (const definition of [{ type: 'bytes' }, { type: 'array', len: 1, value: 'f64' }, 'missing', { type: 'enum', value: ['x', 'x'] }, { type: 'oneof', value: [] }, { type: 'vector' }]) {
    const s = structuredClone(schema); s.types.Bad = definition;
    assert.throws(() => encodePack(s, patterns));
  }
  const s = { data: ['Items'], types: { Items: { type: 'vector', value: 'Choice' }, A: 'f64', B: 'f64', Choice: { type: 'oneof', value: ['A', 'B'] } } };
  assert.throws(() => encodePack(s, [4]), /ambiguous/);
  assert.doesNotThrow(() => encodePack(s, [{ B: 4 }]));
  const cycle = structuredClone(schema); cycle.types.Bad = 'Bad';
  assert.throws(() => encodePack(cycle, patterns), /cyclic/);
});

test('graph changes and transformed/customized Lua are not silently interpreted', async t => {
  const path = await fixture(t);
  const graphPath = 'content/gams/graphs/bulletml.ng.json';
  for (const change of [g => g.push(g[0]), g => { g[1].inputs[0].srcNodeId = 3; }, g => { g[1].codePath = 'custom.lua'; }, g => { g[0].outputs[0].value = 'transform(paths)'; }, g => { g[2].outputs[1].value = '"../escape.rspk"'; }, g => { g[2].outputs[1].value = '"build.nosync/other.rspk"'; }, g => { g[0].outputs[0].value = '["../escape.json"]'; }, g => { g[2].outputs[0].value = '"other.json"'; }, g => { g[0].id = 2; }, g => { g[4].transform = 'custom'; }, g => { g[0].outputs[0].value = JSON.stringify([...sourcePaths].reverse()); }, g => { g[0].outputs[0].value = JSON.stringify([sourcePaths[0], sourcePaths[0]]); }]) {
    await cp(join(root, graphPath), join(path, graphPath));
    await changeJSON(path, graphPath, change);
    await assert.rejects(buildPack({ root: path }));
  }
  await cp(join(root, graphPath), join(path, graphPath));
  await changeJSON(path, graphPath, g => { g[0].outputs[0].value = JSON.stringify([...sourcePaths].reverse()); });
  const input = join(path, 'manual.rspk');
  await writeFile(input, encodePack(schema, patterns));
  const cli = spawnSync(process.execPath, [join(root, 'content/gams/embed.mjs'), input, join(path, 'bad.h')], { cwd: path, encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /ranger source/);
  await assert.rejects(access(join(path, 'bad.h')));
  await cp(join(root, graphPath), join(path, graphPath));
  const lua = join(path, 'content/gams/nodes/bulletml-slots-json.lua');
  await writeFile(lua, `${await readFile(lua, 'utf8')}\n-- custom transformation\n`);
  await assert.rejects(buildPack({ root: path }), /customized Lua/);
});

test('missing source/malformed JSON fails without creating output', async t => {
  const path = await fixture(t);
  await writeFile(join(path, sourcePaths[0]), '{broken');
  await assert.rejects(buildPack({ root: path }), SyntaxError);
  await assert.rejects(access(join(path, 'build.nosync/content/bulletml.rspk')));
  await rm(join(path, sourcePaths[0]));
  await assert.rejects(buildPack({ root: path }), /ENOENT/);
});

test('embedded header is stable, byte-exact and rejects invalid pack headers', () => {
  const bytes = encodePack(schema, patterns), header = embedPack(bytes);
  assert.equal(header, embedPack(bytes));
  assert.match(header, /static const unsigned char sim_bulletml_pack_bytes\[\]/);
  assert.ok(!header.includes(root));
  assert.deepEqual(Buffer.from([...header.matchAll(/0x([0-9a-f]{2})/g)].map(m => parseInt(m[1], 16))), bytes);
  for (const offset of [0, 4, 6, 8, 12]) { const bad = Buffer.from(bytes); bad[offset] ^= 1; assert.throws(() => embedPack(bad), /invalid RSPK/); }
  assert.throws(() => embedPack(bytes.subarray(0, 12)), /invalid RSPK/);
});

test('Make incrementally embeds source edits, preserves a newer GAMS pack and never hides missing inputs behind stale output', async t => {
  const project = await fixture(t);
  await cp(join(root, 'Makefile'), join(project, 'Makefile'));
  await mkdir(join(project, 'game/web/wasm-include'), {recursive:true});
  const target = 'build.nosync/content/bulletml-pack.h';
  const pack = join(project, 'build.nosync/content/bulletml.rspk');
  const header = join(project, target);
  const make = () => spawnSync('make', ['--no-print-directory', target], {cwd:project, encoding:'utf8'});
  let result = make(); assert.equal(result.status, 0, result.stderr);
  const initialHeader = await readFile(header, 'utf8'), firstTime = (await stat(header)).mtimeMs;
  result = make(); assert.equal(result.status, 0, result.stderr);
  assert.equal((await stat(header)).mtimeMs, firstTime, 'no-op check does not rewrite output');
  assert.doesNotMatch(result.stdout, /node content\/gams\/pack\.mjs\s*\n/);
  await changeJSON(project, sourcePaths[0], p => { p.actions[1][1].fireRef.params[0] = -25; });
  result = make(); assert.equal(result.status, 0, result.stderr);
  assert.notEqual(await readFile(header, 'utf8'), initialHeader, 'JSON edit repacks and re-embeds');
  // Simulate a just-built GAMS artifact with another valid authored spread.
  const gamsPatterns = await Promise.all(sourcePaths.map(p => readJSON(join(project, p))));
  gamsPatterns[0].actions[1][1].fireRef.params[0] = -35;
  const gamsBytes = encodePack(schema, gamsPatterns);
  await writeFile(pack, gamsBytes);
  result = make(); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(pack), gamsBytes, 'do not replace a newer pack with portable fallback');
  assert.equal(await readFile(header, 'utf8'), embedPack(gamsBytes));
  const lastHeader = await readFile(header, 'utf8');
  await rm(join(project, sourcePaths[1]));
  result = make(); assert.notEqual(result.status, 0, 'deleted required input fails even with a newer valid pack');
  assert.match(result.stderr, /ENOENT/);
  assert.equal(await readFile(header, 'utf8'), lastHeader);
  await cp(join(root, sourcePaths[1]), join(project, sourcePaths[1]));
  await writeFile(join(project, sourcePaths[0]), '{broken');
  result = make(); assert.notEqual(result.status, 0, 'malformed input cannot silently fall back');
  assert.equal(await readFile(header, 'utf8'), lastHeader);
});
