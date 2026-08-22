/** Model-facing verifier_select tool. @module dsh-as-a-verifier/tools */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { VerifierServiceApi } from './types.ts'

/** Register the canonical best-of-N verifier tool on the scoped registry. */
export function registerVerifierTool(ctx: Context, verifier: VerifierServiceApi): void {
  const unregister = ctx.tools.register(defineTool({
    name: 'verifier_select',
    description: 'Select and rank the strongest candidate answer or agent trajectory using fine-grained DeepSeek logprob rewards and a probabilistic pivot tournament.',
    parameters: {
      problem: {
        type: 'string',
        required: true,
        description: 'The task or problem every candidate attempted.',
      },
      candidates: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Candidate answers or complete agent trajectories to compare.',
      },
      criteria: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            description: { type: 'string', required: true },
          },
        },
        description: 'Independent criteria; criterion text should describe observable evidence.',
      },
      n_evaluations: {
        type: 'integer',
        description: 'Repeated verifier calls per criterion and comparison; constrained by deployment policy.',
      },
      pivots: {
        type: 'integer',
        description: 'PPT pivot count; constrained by deployment policy and clamped to candidate count.',
      },
      seed: {
        type: 'integer',
        description: 'Deterministic tournament graph seed.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selectedIndex: { type: 'integer', required: true },
          best: { type: 'string', required: true },
          ranking: { type: 'array', items: { type: 'integer' }, required: true },
          scores: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
          comparisonCount: { type: 'integer', required: true },
          verifierCalls: { type: 'integer', required: true },
          criteria: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
          usage: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              calls: { type: 'integer', required: true },
              inputTokens: { type: 'integer', required: true },
              cachedInputTokens: { type: 'integer', required: true },
              uncachedInputTokens: { type: 'integer', required: true },
              outputTokens: { type: 'integer', required: true },
              reasoningTokens: { type: 'integer', required: true },
              cacheHitRate: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      title: 'Verify and select candidate',
      kind: 'execute',
      rawInput: args.problem,
    }),
    presentResult: () => ({ card: 'generic', title: 'Candidate verification complete' }),
    execute: async (args, exec) => {
      const result = await verifier.select({
        problem: args.problem,
        candidates: args.candidates,
        criteria: args.criteria,
        ...(args.n_evaluations === undefined ? {} : { nEvaluations: args.n_evaluations }),
        ...(args.pivots === undefined ? {} : { pivots: args.pivots }),
        ...(args.seed === undefined ? {} : { seed: args.seed }),
        signal: exec.signal,
      })
      return {
        ...result,
        ranking: [...result.ranking],
        scores: result.scores.map(score => ({ ...score })),
        criteria: result.criteria.map(criterion => ({ ...criterion })),
        usage: { ...result.usage },
      }
    },
  }))
  ctx.effect(() => unregister, 'dsh-as-a-verifier: verifier_select')
}
