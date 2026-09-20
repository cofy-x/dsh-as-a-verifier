import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  argument,
  assertGitHubRepository,
  assertPnpmVersion,
  dshVersion as DSH_VERSION,
  packageName as PACKAGE_NAME,
  repository as DEFAULT_REPOSITORY,
  run,
} from './project.mjs'

const ref = argument('--ref')
const REPOSITORY = assertGitHubRepository(argument('--repository', { required: false }) ?? DEFAULT_REPOSITORY)
if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('profile smoke ref must be an exact commit SHA')
assertPnpmVersion()

const workspace = mkdtempSync(join(tmpdir(), 'dsh-verifier-profile-smoke-'))
const launcher = join(workspace, 'launcher')
const home = join(workspace, 'home')
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: '1',
  DEEPSEEK_API_KEY: '',
}

try {
  mkdirSync(launcher)
  writeFileSync(join(launcher, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@11.7.0' }, null, 2))
  writeFileSync(join(launcher, 'pnpm-workspace.yaml'), [
    'packages:',
    "  - '.'",
    'allowBuilds:',
    `  '@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}': true`,
    "  '@google/genai@1.52.0': true",
    "  'koffi@3.3.1': true",
    "  'node-pty@1.2.0-beta.15': true",
    "  'protobufjs@7.6.6': true",
    '',
  ].join('\n'))
  run('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh@${DSH_VERSION}`], { cwd: launcher, env, timeout: 120_000 })
  const require = createRequire(join(launcher, 'smoke.cjs'))
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== DSH_VERSION) throw new Error(`installed DSH ${manifest.version}, expected ${DSH_VERSION}`)
  const bin = join(dirname(manifestPath), manifest.bin.dsh)

  for (const profile of ['web', 'headless']) {
    run(process.execPath, [bin, '--profile', profile, '--dump-config'], { cwd: workspace, env, timeout: 120_000 })
    const profileDir = join(home, 'profiles', profile)
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), [
      'packages:',
      "  - '.'",
      'allowBuilds:',
      `  '${PACKAGE_NAME}@https://codeload.github.com/${REPOSITORY}/tar.gz/${ref}': true`,
      '',
    ].join('\n'))
    run(process.execPath, [bin, 'plugin', '--profile', profile, 'add', '--save-exact', `github:${REPOSITORY}#${ref}`], { cwd: workspace, env, timeout: 120_000 })
    const lockfile = readFileSync(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
    if (!lockfile.includes(`codeload.github.com/${REPOSITORY}/tar.gz/${ref}`)) {
      throw new Error(`${profile} profile lockfile omitted the exact provider commit`)
    }
    const dump = run(process.execPath, [bin, '--profile', profile, '--dump-config'], { cwd: workspace, env, timeout: 120_000 })
    const rows = dump.match(/id: dsh-as-a-verifier\b/g) ?? []
    if (rows.length !== 1) throw new Error(`${profile} profile contains ${rows.length} dsh-as-a-verifier rows`)
    const help = run(process.execPath, [bin, '--profile', profile, '--help'], { cwd: workspace, env, timeout: 120_000 })
    if (!help.includes(`dsh --profile ${profile}`)) throw new Error(`${profile} profile did not reach its app help`)
  }
  console.log(`${PACKAGE_NAME} profile smoke passed on DSH ${DSH_VERSION} for ${ref}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
