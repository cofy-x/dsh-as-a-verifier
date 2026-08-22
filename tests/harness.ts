import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'

/** Mount the scaffold on real Cordis with a minimal tool registry. */
export async function createPluginHarness() {
  const ctx = new Context()
  const tools: ToolDefinition[] = []
  ctx.provide('tools', {
    register(definition: ToolDefinition) {
      tools.push(definition)
      return () => {
        const index = tools.indexOf(definition)
        if (index >= 0) tools.splice(index, 1)
      }
    },
  })
  const fiber = await ctx.plugin(plugin, {})
  return { ctx, tools, fiber }
}
