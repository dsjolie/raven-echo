# Principles

Design rules applied across the project. Each one exists because something went wrong without it.

## Understand Before You Fix

When something doesn't work, stop and check your assumptions before reaching for a solution. A workaround that bypasses a misunderstood problem creates two problems — the original one is still there, and now you have a workaround whose behavior you don't fully control.

**In practice:** When a Python script called from Node.js returned garbled characters, the temptation was to add encoding conversion at the Node layer. The actual problem was that Windows uses cp1252 by default for subprocess stdout, not UTF-8. Setting `PYTHONUTF8=1` in the subprocess environment fixed it at the source. The Node-side workaround would have masked the real issue and broken on any non-Latin characters.

## Surface Errors, Don't Swallow Them

Don't silently catch errors and add fallbacks. An error you hide is an error you'll hit again in a worse context. Fallbacks are for cases where the failure mode is understood and expected — not for surprises.

**In practice:** When copying scripts for sharing, if a script contains hardcoded paths, the temptation is to auto-sanitize — replace the paths with variables. Instead, the system surfaces it as an error: "this script has specifics on lines 12 and 34, fix it at source." Auto-sanitizing hides the fact that the script wasn't properly parameterized. Similarly, the guard system returns guidance messages rather than silently blocking commands — the agent sees *why* a pattern was rejected and can adjust its approach.

## Prefer Simplicity

Write the least code that solves the actual problem. Robustness over cleverness. Premature optimization and premature generalization are the root of all evil.

**In practice:** The task overview cache is three variables and two functions — a timestamp, a cached value, and a TTL. Not a cache class, not a generic memoizer, not an LRU. The guard system's mode state is a single text file containing one word (`default`, `away`, or `off`) — read fresh on every hook invocation. No database, no IPC, no daemon. The simplest thing that works is usually the right thing.

## Push Back, Don't Placate

An AI assistant that agrees with everything isn't being helpful — it's being compliant. Challenge unsupported claims, flag logical gaps, question assumptions. Distinguish between what's empirically grounded and what's assertion.

**In practice:** When a subagent reported that a paper used the term "conflict resolution" instead of "selective forgetting," the lead agent should have noticed that conflicting web sources existed and escalated rather than applying the change. The original text was correct; the "correction" introduced an error. A presumption of correctness for existing text — requiring clear evidence before changing — would have caught this.

## Don't Be Defensive

If new evidence, tools, or ideas make the current approach obsolete, let go. Don't cling to sunk costs — whether that's code, architecture, or a research direction. The goal is to do the right thing, not to justify what's already been done.

**In practice:** The project started as a custom agent framework before pivoting to "extend Claude Code instead." This meant discarding early architecture work, but the resulting system is simpler, more maintainable, and benefits from CC's ongoing development. Protecting the sunk cost would have produced an inferior system.

## Synthesize, Don't Summarize

Focus on novel connections and coherence over exhaustive coverage. Each piece should stand on its own while connecting to the whole. Be evidence-based: support claims with research and concrete examples.

**In practice:** Research documents in the project don't just list what each paper says. They identify patterns across papers — like the convergence of multiple memory systems (ACE, ENGRAM, HiMem) on two-tier architectures with slow consolidation and fast retrieval, independently of each other. The synthesis is the value, not the individual summaries.
