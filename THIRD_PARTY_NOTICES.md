# Third-Party Notices

## llm-as-a-verifier

Upstream project: `llm-as-a-verifier`

Upstream source: `https://github.com/llm-as-a-verifier/llm-as-a-verifier`

Pinned source revision: `115de305f23ed89bc42e86e010853c40059f3f7d`

This project derives and natively ports to TypeScript the pairwise evaluation prompt structure, the A–T fine-grained token-logprob reward, A/B slot swapping, Bradley–Terry soft-win aggregation, Probabilistic Pivot Tournament, and the A–T trajectory progress prompt/decoder from that revision. Derived source modules carry a source header. The port intentionally uses a stable JavaScript PRNG and does not claim byte-for-byte agreement with Python `random` permutations.

The upstream work is provided under the following MIT License:

```text
MIT License

Copyright (c) 2026 llm-as-a-verifier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
