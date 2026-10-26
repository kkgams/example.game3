import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const own = (o, k) => Object.hasOwn(o, k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function check(ok, message) { if (!ok) throw new Error(message); }
class ValueMismatch extends Error {}
function keys(o, allowed, where) {
  check(object(o), `${where}: expected object`);
  for (const k of Object.keys(o)) check(allowed.includes(k), `${where}: unsupported field ${k}`);
}
function uint(v, max = 0xffffffff) { check(Number.isInteger(v) && v >= 0 && v <= max, 'invalid unsigned integer/ref index'); return v; }
function word(v, size = 4) { const b = Buffer.alloc(size); size === 2 ? b.writeUInt16LE(uint(v, 65535)) : b.writeUInt32LE(uint(v)); return b; }

// Deliberately a schema subset, not a replacement for plugin.respack. Wire facts:
// RSPK v1 LE slot table; structs in schema order; oneofs are 1-based u16 tags.
export function encodePack(schema, patterns) {
  keys(schema, ['package', 'odin', 'data', 'types'], 'schema');
  check(object(schema.types) && Array.isArray(schema.data) && schema.data.length === 1, 'schema requires exactly one data slot and types');
  const types = schema.types;
  const primitive = ['f64', 'u32', 'bool', 'string'];
  function definition(spec, trail = []) {
    if (typeof spec === 'string') {
      if (primitive.includes(spec)) return { type: spec };
      check(own(types, spec), `unknown schema type ${spec}`);
      check(!trail.includes(spec), `cyclic schema alias ${spec}`);
      return definition(types[spec], [...trail, spec]);
    }
    check(object(spec) && typeof spec.type === 'string', 'malformed schema definition');
    keys(spec, ['type', 'fields', 'value', 'default'], 'schema definition');
    if (![...primitive, 'enum', 'struct', 'vector', 'oneof'].includes(spec.type)) {
      check(!own(spec, 'fields') && !own(spec, 'value'), 'unsupported alias definition');
      return definition(spec.type, trail);
    }
    return spec;
  }
  // Validate all named definitions, including unused types: no silent unsupported schema.
  function validate(spec, trail = []) {
    if (typeof spec === 'string' && trail.includes(spec)) throw new Error(`recursive schema unsupported: ${spec}`);
    const next = typeof spec === 'string' ? [...trail, spec] : trail;
    const d = definition(spec);
    const allowed = d.type === 'struct' ? ['type', 'fields', 'default'] : ['vector', 'oneof', 'enum'].includes(d.type) ? ['type', 'value', 'default'] : ['type', 'default'];
    keys(d, allowed, `schema ${d.type}`);
    if (d.type === 'struct') {
      check(object(d.fields), 'struct requires fields');
      Object.values(d.fields).forEach(f => validate(f, next));
    } else if (d.type === 'vector') validate(d.value, next);
    else if (d.type === 'oneof' || d.type === 'enum') {
      check(Array.isArray(d.value) && d.value.length > 0 && d.value.every(x => typeof x === 'string') && new Set(d.value).size === d.value.length, `${d.type} requires unique named variants`);
      if (d.type === 'oneof') { check(d.value.length <= 65535, 'too many oneof variants'); d.value.forEach(v => validate(v, next)); }
    } else check(!own(d, 'value') && !own(d, 'fields'), 'unsupported primitive schema fields');
    if (own(d, 'default')) encode(spec, d.default, 0, false);
  }
  function encode(spec, value, depth = 0, useDefault = true) {
    // Only expected value mismatches participate in oneof inference. Schema or
    // implementation errors must escape, never silently select another variant.
    const check = (ok, message) => { if (!ok) throw new ValueMismatch(message); };
    check(depth < 128, 'value nesting too deep');
    if (value === undefined && useDefault && object(spec) && own(spec, 'default')) value = spec.default;
    const d = definition(spec);
    const child = (s, v) => encode(s, v, depth + 1);
    switch (d.type) {
      case 'f64': { check(typeof value === 'number' && Number.isFinite(value), 'expected finite f64'); const b = Buffer.alloc(8); b.writeDoubleLE(value); return b; }
      case 'u32': check(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'expected u32'); return word(value);
      case 'bool': check(typeof value === 'boolean', 'expected bool'); return Buffer.from([Number(value)]);
      case 'string': { check(typeof value === 'string' && value.isWellFormed(), 'expected well-formed string'); const b = Buffer.from(value, 'utf8'); return Buffer.concat([word(b.length), b]); }
      case 'enum': { const index = typeof value === 'string' ? d.value.indexOf(value) : value; check(Number.isInteger(index) && index >= 0 && index < d.value.length, 'invalid enum value'); return word(index); }
      case 'struct': {
        check(object(value), 'expected struct object');
        for (const k of Object.keys(value)) check(own(d.fields, k), `unknown struct field ${k}`);
        return Buffer.concat(Object.entries(d.fields).map(([k, s]) => {
          check(own(value, k) || (object(s) && own(s, 'default')), `missing required field: ${k}`);
          return child(s, value[k]);
        }));
      }
      case 'vector': check(Array.isArray(value), 'expected vector array'); return Buffer.concat([word(value.length), ...value.map(v => child(d.value, v))]);
      case 'oneof': {
        // Named command wrappers are explicit. Expr/Ref scalar/object forms are
        // inferred only when exactly one candidate encodes, never first-match.
        const names = object(value) ? Object.keys(value) : [];
        if (names.length === 1 && d.value.includes(names[0])) {
          const index = d.value.indexOf(names[0]);
          return Buffer.concat([word(index + 1, 2), child(names[0], value[names[0]])]);
        }
        const matches = [];
        for (let i = 0; i < d.value.length; i++) {
          try { matches.push([i, child(d.value[i], value)]); } catch (error) {
            if (!(error instanceof ValueMismatch)) throw error;
          }
        }
        check(matches.length === 1, matches.length ? 'ambiguous oneof variant' : 'unknown oneof variant');
        return Buffer.concat([word(matches[0][0] + 1, 2), matches[0][1]]);
      }
      default: throw new Error(`unsupported schema type ${d.type}`);
    }
  }
  Object.keys(types).forEach(name => validate(name));
  const slot = definition(schema.data[0]);
  check(slot.type === 'vector', 'one slot must contain a pattern vector');
  const payload = encode(schema.data[0], patterns);
  const header = Buffer.alloc(16);
  header.write('RSPK'); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 6);
  header.writeUInt32LE(16, 8); header.writeUInt32LE(uint(payload.length), 12);
  return Buffer.concat([header, payload]);
}

const nodeScripts = {
  'content/gams/nodes/bulletml-slots-json.lua': '4b909de6d32663a5840347e243925159b26d8c44de1ca3468d09181908e06bba',
  'content/gams/nodes/build-bulletml-respack.lua': '1bc2ed5254dc286dc8d1605ac3fa1ffe297f78fef80d428f81c560eb9d29ff4d',
};
const port = (id, name, srcNodeId, srcOutputId) => ({ id, name, srcNodeId, srcOutputId });
const out = name => [{ id: 1, name, value: null }];
// This is a known-project packaging adapter, NOT a Lua/Nodegraph interpreter.
// Hashes here guard unsupported custom transformations, not dependency updates.
export async function readPackConfig({ root = process.cwd(), output } = {}) {
  root = resolve(root);
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const graph = await json('content/gams/graphs/bulletml.ng.json');
  check(Array.isArray(graph) && graph.length === 5, 'unsupported graph topology');
  const expected = [
    { id: 1, kind: 4, inputs: [], outputs: [{ id: 1, name: 'paths' }] },
    { id: 2, kind: 2, codePath: Object.keys(nodeScripts)[0], inputs: [port(1, 'paths', 1, 1)], outputs: out('slots_json') },
    { id: 3, kind: 4, inputs: [], outputs: [{ id: 1, name: 'schemaPath' }, { id: 2, name: 'outputPath' }] },
    { id: 4, kind: 2, codePath: Object.keys(nodeScripts)[1], inputs: [port(1, 'schemaPath', 3, 1), port(2, 'slotsJson', 2, 1), port(3, 'outputPath', 3, 2)], outputs: out('path') },
    { id: 5, kind: 1, inputs: [port(1, 'path', 4, 1)], outputs: [] },
  ];
  for (const e of expected) {
    const found = graph.filter(n => n.id === e.id);
    check(found.length === 1, 'duplicate/missing graph node');
    const n = found[0];
    keys(n, ['id', 'kind', 'name', 'x', 'y', 'inputs', 'outputs', ...(e.codePath ? ['codePath'] : [])], 'graph node');
    const shape = structuredClone(n);
    delete shape.name; delete shape.x; delete shape.y;
    if (e.kind === 4) {
      check(Array.isArray(shape.outputs), 'invalid Value outputs');
      for (const p of shape.outputs) {
        check(typeof p.value === 'string' && typeof p.name === 'string', 'Value requires JSON literal and label');
        delete p.value;
        // Released Nodegraph clears Value port labels when editing them. Values
        // are wired by stable numeric IDs, not these cosmetic names.
        const expectedPort = e.outputs.find(port => port.id === p.id);
        check(expectedPort !== undefined, 'unsupported Value port ID');
        p.name = expectedPort.name;
      }
    }
    // Compare structurally, independent of object property insertion order.
    const stable = v => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : Array.isArray(v) ? v.map(stable) : v;
    check(JSON.stringify(stable(shape)) === JSON.stringify(stable(e)), `unsupported graph topology at node ${e.id}`);
  }
  for (const [path, hash] of Object.entries(nodeScripts)) {
    check(createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') === hash, `unsupported customized Lua node: ${path}`);
  }
  const value = (id, index) => JSON.parse(graph.find(n => n.id === id).outputs[index].value);
  const paths = value(1, 0), schemaPath = value(3, 0), graphOutput = value(3, 1);
  check(Array.isArray(paths) && paths.length > 0 && paths.every(p => typeof p === 'string' && /^content\/bulletml\/[^/\\]+\.bulletml\.json$/.test(p)), 'invalid pattern source paths');
  check(typeof schemaPath === 'string' && /^content\/gams\/schema\/[^/\\]+\.rspk\.json$/.test(schemaPath), 'invalid schema path');
  function destination(path) {
    check(typeof path === 'string' && /^build\.nosync\/.+\.rspk$/.test(path) && path.split('/').every(p => p !== '.' && p !== '..' && p !== '') && !path.includes('\\'), 'output must be .rspk under build.nosync/');
    return resolve(root, path);
  }
  const ranger = 'content/bulletml/ranger-fan.bulletml.json';
  check(paths[0] === ranger && paths.filter(p => p === ranger).length === 1, 'ranger source must occur exactly once at pattern index 0');
  destination(graphOutput); // Validate graph even if caller overrides destination.
  check(graphOutput === 'build.nosync/content/bulletml.rspk', 'game graph output must be build.nosync/content/bulletml.rspk');
  const target = destination(output === undefined ? graphOutput : output);
  return { root, paths, schemaPath, target };
}

export async function buildPack(options = {}) {
  const { root, paths, schemaPath, target } = await readPackConfig(options);
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const patterns = await Promise.all(paths.map(json));
  for (const p of patterns) check(object(p) && Array.isArray(p.actions) && p.actions.length > 0 && Array.isArray(p.bullets) && Array.isArray(p.fires), 'pattern requires actions, bullets and fires arrays');
  const bytes = encodePack(await json(schemaPath), patterns);
  if (!options.checkOnly) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return { output: target, bytes, patterns: patterns.length, sources: paths, schema: schemaPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.length === 3 && process.argv[2] === '--check';
  check(process.argv.length === 2 || checkOnly, 'usage: node content/gams/pack.mjs [--check]');
  const result = await buildPack({ checkOnly });
  if (!checkOnly) console.log(`Built ${result.patterns} patterns (${result.bytes.length} bytes): ${result.output}`);
}
