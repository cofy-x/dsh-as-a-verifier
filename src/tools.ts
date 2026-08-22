/** Model-facing verifier_select tool. @module dsh-as-a-verifier/tools */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { VerifierServiceApi } from './types.ts'

/** Register the canonical verifier tools on the scoped registry. */
export function registerVerifierTools(ctx: Context, verifier: VerifierServiceApi): void {
  const unregisterSelect = ctx.tools.register(defineTool({
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
  const unregisterTrack = ctx.tools.register(defineTool({
    name: 'verifier_track',
    description: 'Score progress at selected checkpoints of one agent trajectory using strict DeepSeek A-T logprob expectations.',
    parameters: {
      problem: { type: 'string', required: true, description: 'The task the agent is attempting.' },
      steps: {
        type: 'array', required: true, items: { type: 'string' },
        description: 'Ordered agent steps, each containing the action and its observed output.',
      },
      checkpoint_steps: {
        type: 'array', items: { type: 'integer' },
        description: 'Optional strictly increasing 1-based step numbers to score.',
      },
      n_evaluations: {
        type: 'integer', description: 'Independent verifier repeats, constrained by deployment policy.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          steps: { type: 'array', items: { type: 'integer' }, required: true },
          scores: { type: 'array', items: { type: 'number' }, required: true },
          perEvaluationScores: {
            type: 'array', required: true, items: { type: 'array', items: { type: 'number' } },
          },
          final: { type: 'number', required: true },
          verifierCalls: { type: 'integer', required: true },
          usage: {
            type: 'object', required: true, additionalProperties: false,
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
    presentCall: args => ({ card: 'generic', title: 'Track trajectory progress', kind: 'execute', rawInput: args.problem }),
    presentResult: () => ({ card: 'generic', title: 'Progress tracking complete' }),
    execute: async (args, exec) => {
      const result = await verifier.track({
        problem: args.problem,
        steps: args.steps,
        ...(args.checkpoint_steps === undefined ? {} : { checkpointSteps: args.checkpoint_steps }),
        ...(args.n_evaluations === undefined ? {} : { nEvaluations: args.n_evaluations }),
        signal: exec.signal,
      })
      return {
        ...result,
        steps: [...result.steps],
        scores: [...result.scores],
        perEvaluationScores: result.perEvaluationScores.map(scores => [...scores]),
        usage: { ...result.usage },
      }
    },
  }))
  ctx.effect(() => () => {
    unregisterTrack()
    unregisterSelect()
  }, 'dsh-as-a-verifier: verifier tools')
}
