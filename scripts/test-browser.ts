import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {fixtureCases, fixtureName} from '../test/helpers.ts'

const fixtures: string[] = []
for (const fixture of fixtureCases) {
  for (const known of [false, true]) {
    fixtures.push((await Bun.file(`test/fixtures/${fixtureName(fixture)}-${known ? 'known' : 'unknown'}.zst`).bytes()).toHex())
  }
}
await Bun.write('temp/browser-entry.ts', `import {checkBrowser} from '../scripts/browser-check.ts'\ncheckBrowser(${JSON.stringify(fixtures)})\n`)
const build = await Bun.build({entrypoints: ['temp/browser-entry.ts'], target: 'browser', minify: true})
if (!build.success) throw new Error(build.logs.join('\n'))
const js = await build.outputs[0].text()
const html = resolve('temp/browser-check.html')
await Bun.write(html, `<!doctype html><meta charset="utf-8"><body><script type="module">${js}</script></body>`)
const windowsChrome = process.platform === 'win32' && await Bun.file('C:/Program Files/Google/Chrome/Application/chrome.exe').exists()
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : undefined
const chrome = Bun.env.CHROMIUM ?? Bun.env.CHROMIUM_BIN ?? Bun.which('chromium') ?? Bun.which('google-chrome') ?? windowsChrome
if (!chrome) throw new Error('Install Chromium or set CHROMIUM to its executable path.')
const result = Bun.spawnSync([
  chrome, '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--dump-dom', pathToFileURL(html).href,
], {stdout: 'pipe', stderr: 'pipe', timeout: 60000})
const stdout = new TextDecoder().decode(result.stdout)
if (result.exitCode !== 0 || !stdout.includes('data-result="passed"')) {
  console.error(stdout, new TextDecoder().decode(result.stderr))
  throw new Error('Chromium decoder checks failed.')
}
console.log(stdout.match(/<body[^>]*>([^<]+)/)?.[1])
