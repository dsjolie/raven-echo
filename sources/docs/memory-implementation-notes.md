# Memory Implementation Notes

Bridging the theoretical research (docs/memory-architecture.md, memory-research-findings.md, the paper) with practical implementation constraints in Claude Code.

## CC's Architecture Constrains Memory Design

The model is **stateless** — CC client owns the `messages[]` array and sends it fresh each API call. The model cannot:
- Selectively forget or compact context mid-session
- Control what gets auto-compressed or when
- Persist anything between API calls except via tool use (writing to disk)

**Implication**: all memory operations must be tool-mediated (read/write files). There's no hidden state to exploit. The "working memory" is the context window, and the agent has zero control over it.

## Prompt Caching Economics Shape Design Choices

Anthropic API prompt caching (as of Feb 2026):
- **Exact prefix matching** via cryptographic hash — hierarchy: tools → system → messages
- Cache read = 10% of base token cost, write = 125%, default TTL = 5min (refreshed on each hit)
- Up to 4 breakpoints, 20-block lookback window
- Compaction/rewriting context **breaks the cache** — this is why CC accumulates rather than compacts

**Daniel's measured usage**: 94% of inter-prompt gaps < 5min (7,813 gaps across 144 sessions). Very cache-friendly. Per-project variation: Raven 4.7% miss rate, teaching 7-8%, paper writing 1.7%.

### Design implications

1. **Stable context is cheap, volatile context is expensive.** A well-designed memory context that stays identical across turns costs 10% per turn. Rewriting it each turn costs 125%.

2. **Memory updates should be batched, not per-turn.** If raven-reflect consolidates memory, it changes the prefix and triggers a cache write. But that's once per session, not per turn — acceptable.

3. **Recognition vocabulary (MEMORY.md) is cache-friendly by nature.** It loads once at session start (in system prompt or early message), stays identical across all turns. Perfect for caching.

4. **Retrieved detail (topic files read on demand) doesn't hurt caching.** Tool results (read file) appear as new messages at the end — they don't change the cached prefix.

5. **The "designed context" idea.** Instead of raw conversation accumulation, structure the prompt so:
   - System prompt = stable knowledge context (cached at 10%)
   - Messages = only current exchange (small, full price)
   - Clear between tasks, reload same system prompt

   This is essentially what raven-continue could evolve into — not just resuming state, but constructing a cache-optimal prompt.

## Input vs Output Token Economics

The cost asymmetry between input and output tokens is at least as important as caching for memory design:

| Token type | $/MTok (Opus 4.6) | Relative to cached input |
|---|---|---|
| Cached input (read) | $0.50 | 1× |
| Input (uncached) | $5.00 | 10× |
| Cache write | $6.25 | 12.5× |
| Output | $25.00 | 50× |
| Extended thinking | $25.00 | 50× (billed as output) |

**Output is 5× input and 50× cached input.** This means:

- 1 saved output token pays for 5 uncached input tokens or 50 cached input tokens
- Extended thinking tokens bill at the output rate — better context that reduces reasoning effort saves at the expensive rate

**Key insight: even if adding context breaks the cache, it can still be net cheaper if it reduces output.** Better input context can reduce output in several ways:
- Less re-explanation (model doesn't need to reconstruct what it already "knows")
- Fewer exploratory tool calls (model knows where things are)
- Shorter reasoning chains (less extended thinking to figure things out)
- More direct answers (less hedging, caveating, and preamble)

This argues for **generous, well-structured input context** even when caching is uncertain. The breakeven is low: 100 uncached input tokens need only save 20 output tokens to pay for themselves. With cached input, 100 tokens need to save only 2 output tokens.

## Consolidation Timing

The paper's "consolidation as dual-output" concept (producing both updated memory AND recognition traces) maps to raven-reflect. Concretely: reflect produces (1) updated topic files in `memory/`, and (2) updated recognition database entries with generated variants — see [`docs/memory-recognition-hook.md`](memory-recognition-hook.md). Key practical question: **when does consolidation happen?**

- **End of session** (current raven-reflect): user-triggered, explicit. Pro: human in the loop for quality. Con: user might forget, context may be auto-compressed by then.
- **Mid-session checkpoints**: could use CC's Stop hook (fires after every response) as a trigger. But Stop hook fires too often — need a heuristic (every N turns? when topic shifts?).
- **On context pressure**: when auto-compression is about to happen, consolidate first. Problem: no signal from CC that compression is imminent.

Current approach (explicit reflect) is fine for Phase 1. Automated consolidation is a Phase 2+ concern.

## What CC Already Provides (Don't Rebuild)

- **Auto-memory (MEMORY.md)**: CC reads this into system prompt automatically. Already cached.
- **Session summaries (v2.1.30+)**: CC auto-extracts session summaries. Understand what this covers before building on top.
- **CLAUDE.md hierarchy**: global → project → directory. Use this for stable context distribution.

## Connection to Research Patterns

| Research concept | CC implementation path |
|---|---|
| ACE delta-updates | Edit tool on memory files (not full rewrites) |
| A-MEM Zettelkasten notes | Topic files in `memory/` directory |
| Recognition-gated retrieval | `UserPromptSubmit` hook + recognition database → memory keyword injection. See [`docs/memory-recognition-hook.md`](memory-recognition-hook.md) |
| Staleness markers | Timestamps or "last confirmed" dates in memory entries |
| Observation categories | Route different types of learning to different files/formats |
| Polymorphic memory | Multiple file formats coexist, evaluated in reflect sessions |
| ENGRAM typed orchestration | Could map to skill-specific memory routing |

## Recognition Hook and Caching Economics

The recognition hook ([`docs/memory-recognition-hook.md`](memory-recognition-hook.md)) interacts with caching in a specific way:

- **The hook output changes per prompt** (different memory keywords match different prompts). This means injected content is NOT cacheable — it appears in the messages, not the system prompt prefix.
- **But it's tiny** — a handful of keywords, maybe 20-50 tokens. At uncached input rates ($5/MTok), this costs fractions of a cent per prompt. Negligible.
- **The value is in output reduction.** If memory keywords prevent the model from spending 200 tokens re-discovering something or making exploratory grep calls, the hook pays for itself 50× over (output at $25/MTok vs uncached input at $5/MTok).
- **Consolidation (reflect) updates the recognition database** — this happens once per session, no caching impact during normal use.
- **MEMORY.md stays cached.** The hook doesn't replace MEMORY.md — it extends beyond it. MEMORY.md provides baseline context at cached rates; the hook catches concepts that exceed MEMORY.md's line limit.

The hook is aligned with the "generous, well-structured input context" principle: spend a few cheap input tokens to save expensive output tokens and tool calls.

## Open Implementation Questions

1. **Where does loaded memory context go?** System prompt (cached, limited size) vs early user message (less cached, unlimited)? MEMORY.md is already in system prompt. Topic file contents would be in tool results (messages).

2. **How to handle memory that outgrows MEMORY.md?** Current file is already ~200 lines. Splitting recognition vocabulary from detail is the plan, but what's the right granularity?

3. **Should raven-continue construct a cache-optimal prompt?** Currently dumps state into a user message. Could instead write a structured system-prompt fragment that CC loads via CLAUDE.md or memory. More cache-friendly.

4. **Multi-project memory sharing.** Global CLAUDE.md is shared. Project-level memory is isolated. Cross-project insights (like "this pattern works in project A, try it in B") have no natural home except global memory.
