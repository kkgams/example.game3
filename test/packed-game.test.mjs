import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPack } from '../content/gams/pack.mjs'
import { embedPack } from '../content/gams/embed.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const zig = process.env.ZIG || 'zig'
const sources = ['test/packed-game.c','game/sim.c','game/patterns.c','game/bulletml/bulletml.c','game/bulletml/pack.c']

test('authored spread/cadence/speed edits reach the same real native and WASM simulation without C changes', async t => {
  const build = path.join(root,'build.nosync')
  await mkdir(build,{recursive:true})
  const folder = await mkdtemp(path.join(build,'packed-game-'))
  t.after(() => rm(folder,{recursive:true,force:true}))
  async function run(name, edited) {
    const project = path.join(folder,name)
    await cp(path.join(root,'content'),path.join(project,'content'),{recursive:true})
    if (edited) {
      const source = path.join(project,'content/bulletml/ranger-fan.bulletml.json')
      const pattern = JSON.parse(await readFile(source,'utf8'))
      pattern.actions[1][0].wait = 12
      pattern.actions[1][1].fireRef.params = [-25]
      pattern.actions[1][3].fireRef.params = [25]
      for (const entry of [pattern.bullets[0],pattern.fires[0]]) entry.speed.value = 80/60
      await writeFile(source,JSON.stringify(pattern))
    }
    const packed = await buildPack({root:project})
    if (process.env.GAMS_INTEGRATION === '1') {
      // Optional real-publisher parity: same edited sources -> actual GAMS Lua
      // graph -> published respack component -> these native/WASM game builds.
      await copyFile(path.join(root,'gams.json'),path.join(project,'gams.json'))
      await cp(path.join(root,'ng'),path.join(project,'ng'),{recursive:true})
      const configuredHost = process.env.GAMS_HOST_BIN
      assert.ok(configuredHost === undefined || configuredHost.trim().length > 0)
      execFileSync(process.execPath,[path.join(project,'content/gams/build.mjs')],{
        cwd:project,encoding:'utf8',
        env:{...process.env,
          GAMS_HOST_BIN:path.resolve(root,configuredHost ?? 'tools/gams.app/Contents/MacOS/gams'),
          GAMS_MODULES_DIR:process.env.GAMS_MODULES_DIR ?? path.join(root,'gams_modules')},
      })
      const actualGams = await readFile(packed.output)
      assert.deepEqual(actualGams,packed.bytes,`${name}: published GAMS/portable byte parity`)
      packed.bytes = actualGams // Embed the real GAMS result, not a fallback copy.
    }
    const includes = path.join(project,'build.nosync/content')
    await writeFile(path.join(includes,'bulletml-pack.h'),embedPack(packed.bytes))
    const native = path.join(project,'probe')
    execFileSync(zig,['cc',...sources,'-Igame',`-I${includes}`,'-std=c11','-Wall','-Wextra','-Werror','-o',native],{cwd:root,encoding:'utf8'})
    const expected = JSON.parse(execFileSync(native,[],{encoding:'utf8'}))
    const wasm = path.join(project,'probe.wasm')
    execFileSync(zig,['build-exe',...sources,'-Igame',`-I${includes}`,'-Igame/web/wasm-include','-target','wasm32-freestanding','-fno-entry','-rdynamic','-O','ReleaseSafe',`-femit-bin=${wasm}`],{cwd:root,encoding:'utf8'})
    const {instance} = await WebAssembly.instantiate(await readFile(wasm),{})
    const e = instance.exports
    e.probe()
    const actual = [e.probe_ticks(),e.probe_count()]
    for(let i=0;i<3;i++) actual.push(e.probe_velocity(i,0),e.probe_velocity(i,1))
    assert.deepEqual(actual.slice(0,2),expected.slice(0,2),`${name}: native/WASM tick and shot counts`)
    // The existing world adapter normalizes velocities in float32. Native and
    // WASM sqrt/FMA lowering can differ by one ulp (observed at 80 px/s), unlike
    // the exact packed bytes/VM timeline. Compare within a few float32 ulps.
    for(let i=2;i<actual.length;i++) {
      const tolerance = 4 * 2**-23 * Math.max(1,Math.abs(actual[i]),Math.abs(expected[i]))
      assert.ok(Math.abs(actual[i]-expected[i])<=tolerance,`${name}: native/WASM velocity ${i}: ${actual[i]} vs ${expected[i]}`)
    }
    e.probe() // Retry/reinitialization must preserve valid owned content pointers.
    assert.equal(e.probe_ticks(),actual[0])
    return actual
  }
  const original = await run('baseline',false), changed = await run('authored-edit',true)
  assert.deepEqual(original.slice(0,2),[64,3])
  assert.deepEqual(changed.slice(0,2),[28,3])
  assert.ok(Math.abs(changed[2]) > Math.abs(original[2])*2,'wider authored fan reaches simulation velocities')
  for(const [sample,speed] of [[original,52],[changed,80]]) {
    for(let i=2;i<sample.length;i+=2) assert.ok(Math.abs(Math.hypot(sample[i],sample[i+1])-speed)<.0001)
    assert.ok(Math.abs(sample[4])<.0001,'center shot remains aimed at the player')
  }
})
