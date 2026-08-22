import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { createPluginHarness } from './harness.ts'

describe('dsh-as-a-verifier scaffold', () => {
  it('preserves the function-plugin namespace through Loader unwrapping', () => {
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('dsh-as-a-verifier')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('mounts and disposes the scaffold', async () => {
    const harness = await createPluginHarness()
    expect(harness.tools).toEqual([])
    await harness.fiber.dispose()
  })
})
