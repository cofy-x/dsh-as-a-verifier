import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as VerifierPlugin from '../src/index.ts'

const TestTools = {
  name: 'test-tools',
  apply(ctx: Context) {
    const definitions: ToolDefinition[] = []
    ctx.provide('tools', {
      register(definition: ToolDefinition) {
        definitions.push(definition)
        return () => { definitions.splice(definitions.indexOf(definition), 1) }
      },
      schemas: () => definitions,
    })
  },
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function boot(profile: 'Web' | 'Headless'): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), `dsh-verifier-${profile.toLowerCase()}-`))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    `# ${profile} profile fixture after applying cordis.patch.yml`,
    '- name: test-tools',
    '- id: dsh-as-a-verifier',
    '  name: dsh-as-a-verifier',
    '  config:',
    '    cacheEnabled: false',
    `    dataDir: ${JSON.stringify(join(root, 'data'))}`,
    '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-tools', TestTools],
    ['dsh-as-a-verifier', VerifierPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('Web and Headless bundle composition', () => {
  it.each(['Web', 'Headless'] as const)('boots the patched %s profile through real Loader and Tools', async profile => {
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch.match(/id: dsh-as-a-verifier/gu)).toHaveLength(1)
    expect(patch).not.toContain('dsh-as-a-verifier/invariant')
    const ctx = await boot(profile)
    expect(ctx.get('verifier')).toBeDefined()
    expect(ctx.tools.schemas().find(tool => tool.name === 'verifier_select')).toBeDefined()
  })
})
