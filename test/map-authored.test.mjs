import assert from 'node:assert/strict'
import test from 'node:test'
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {buildMap} from '../content/maps/build.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const zig = process.env.ZIG || 'zig'
const sources = ['test/map-authored.c','game/sim.c','game/map.c','game/patterns.c','game/bulletml/bulletml.c','game/bulletml/pack.c']

test('a JSON collision edit changes actual native and WASM movement with identical C', async t => {
  await mkdir(path.join(root,'build.nosync'),{recursive:true})
  const folder = await mkdtemp(path.join(root,'build.nosync/map-authored-'))
  t.after(() => rm(folder,{recursive:true,force:true}))
  const original = JSON.parse(await readFile(path.join(root,'content/maps/world.tilemap.json'),'utf8'))
  for (const edited of [false,true]) {
    const project = path.join(folder,edited ? 'edited' : 'baseline')
    await mkdir(project,{recursive:true})
    const map = structuredClone(original)
    if (edited) map.collision[map.height-1-2][4] = 1
    const input = path.join(project,'world.tilemap.json')
    await writeFile(input,JSON.stringify(map))
    await buildMap({input,output:path.join(project,'world-map.h')})
    await copyFile(path.join(root,'build.nosync/content/bulletml-pack.h'),path.join(project,'bulletml-pack.h'))
    const includes = [`-I${project}`,'-Igame']
    const native = path.join(project,'probe')
    execFileSync(zig,['cc',...sources,...includes,'-std=c11','-Wall','-Wextra','-Werror','-o',native],{cwd:root,encoding:'utf8'})
    const actual = Number(execFileSync(native,[],{encoding:'utf8'}))
    const expected = map.origin.x + (edited ? 4 : map.width-1)*map.tileSize - 5
    assert.equal(actual,expected,edited ? 'authored wall blocks sweep' : 'walkable corridor extends beyond old screen')
    const wasm = path.join(project,'probe.wasm')
    execFileSync(zig,['build-exe',...sources,...includes,'-Igame/web/wasm-include','-target','wasm32-freestanding','-fno-entry','-rdynamic','-O','ReleaseSafe',`-femit-bin=${wasm}`],{cwd:root,encoding:'utf8'})
    const {instance} = await WebAssembly.instantiate(await readFile(wasm),{})
    assert.equal(instance.exports.map_authored_probe(),actual,'native/WASM authored collision parity')
    assert.equal(instance.exports.map_authored_probe(),actual,'reset keeps immutable map valid')
  }
})
