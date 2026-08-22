/** Empty invariant companion for dsh-as-a-verifier. @module dsh-as-a-verifier/invariant */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-as-a-verifier/invariant'

/**
 * No runtime invariant: the MVP has request/response operations but owns no
 * long-lived event or mutable-data relationship that an invariant can judge.
 */
export function apply(_ctx: Context): void {}
