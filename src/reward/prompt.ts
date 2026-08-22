/**
 * Pairwise verifier prompt derived from llm-as-a-verifier at commit
 * 115de305f23ed89bc42e86e010853c40059f3f7d (MIT).
 * @module dsh-as-a-verifier/reward/prompt
 */

import type { VerifierCriterion } from '../types.ts'

export const PROMPT_VERSION = 'pairwise-a-t-v1'

const SCALE = `Rate how likely the agent correctly solved the task on a 20-point scale using letters A through T:
  A = clearly and completely succeeded with verified output (best)
  B-D = succeeded with only minor issues
  E-G = above average, mostly correct with some issues
  H-J = uncertain, leans toward success
  K-M = uncertain, leans toward failure
  N-P = below average, significant issues remain
  Q-S = failed with some partial progress
  T = clearly and completely failed (worst)`

/** Build a shared-prefix-friendly prompt with criterion-specific text at the tail. */
export function buildPairwisePrompt(
  problem: string,
  traceA: string,
  traceB: string,
  criterion: VerifierCriterion,
): string {
  return [
    'You are an expert evaluator of AI coding agents. You will see a task description and two agent trajectories, then evaluate them on ONE specific criterion, stated at the end.',
    `**Task:**\n${problem}`,
    `**Trajectory A:**\n${traceA}`,
    `**Trajectory B:**\n${traceB}`,
    `**Rating Scale:**\n${SCALE}`,
    `**Evaluation Guideline — ${criterion.name}:**\n${criterion.description}`,
    `Score each trajectory ONLY on this specific criterion ("${criterion.name}"). Ignore other aspects of the trajectory that are not relevant to it.`,
    'Reason it through first, then END your reply with exactly these two lines and nothing after them. Replace each placeholder with a single letter A-T, keeping the spaces around the letter exactly as shown:',
    '<score_A> LETTER_A_TO_T </score_A>\n<score_B> LETTER_A_TO_T </score_B>',
    'Begin your analysis now.',
  ].join('\n\n')
}
