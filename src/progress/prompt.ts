/**
 * Progress prompt derived from llm-as-a-verifier at commit
 * 8db8a114355a9d7fdf9a8d1d5c87f6aeebd18770 (MIT).
 * @module dsh-as-a-verifier/progress/prompt
 */

export const PROGRESS_PROMPT_VERSION = 'progress-a-t-v1'

export function formatProgressSteps(steps: readonly string[]): string {
  return steps.map((step, index) => `=== Agent Step ${index + 1} ===\n${step.trim()}\n`).join('\n')
}

/** Build the strict checkpoint prompt. Future trajectory state is absent for online calls. */
export function buildProgressPrompt(problem: string, steps: readonly string[], checkpoints: readonly number[]): string {
  const lines = [
    'You are a strict, skeptical evaluator of agent task attempts. Trust observed actions and output, never the agent\'s narration or declarations of success.',
    `**Task instruction:**\n${problem.trim()}`,
    `**Agent trajectory (${steps.length} agent steps):**\n${formatProgressSteps(steps)}`,
    `Score ${checkpoints.length} checkpoints independently. At each checkpoint, estimate whether the agent\'s CURRENT state would satisfy the task\'s hidden grader.`,
    'Use the 20-letter A..T scale: A = certainly no useful solution; B-G = partial but key work missing or broken; H-M = uncertain; N-S = likely satisfies with remaining concerns; T = essentially certain yes with directly observed verification.',
    'Effort, exploration, step count, and confident prose are not progress. Scores may plateau or decrease. Without real verification, remain skeptical.',
    'The checkpoints are:',
    ...checkpoints.map((step, index) => `Checkpoint ${index + 1} = state right after Agent Step ${step}`),
    'Output exactly these lines and nothing else:',
    ...checkpoints.map((_, index) => `<c${index + 1}>LETTER</c${index + 1}>`),
    'Each LETTER must be a single letter A through T.',
  ]
  return lines.join('\n\n')
}
