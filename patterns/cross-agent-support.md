# Cross-Agent Support: A Second Agent Runtime in the Same Workspace

## Problem

Raven is built as an extension of one agent runtime (Claude Code): skills, hooks, context files and memory all use that runtime's extension points. When a second agent runtime (OpenAI's Codex CLI) is installed on the same machine and opened in the same repos, it gets nothing from that layer. An audit of the starting position found it was worse than nothing. The global instructions advertised other agent CLIs as available when neither was installed, no `AGENTS.md` existed anywhere in the repo, and none of the deny rules or hooks applied outside the first runtime. A second agent would work in the repo with no orientation and no guardrails, while the documentation claimed otherwise.

The obvious fixes are either to port everything (hooks, CLIs, memory tools) or to point the second runtime at the first one's files and call it done. Both go wrong.

## Approach

The organising rule: **the requirement transfers; the mechanism does not.** For each thing the first runtime gets, ask what requirement it serves, then find how the second runtime meets that requirement natively. Don't reimplement the first runtime's mechanism inside the second.

The second rule decides what gets built at all: **enforce mechanism, instruct judgment.** A rule about *where a write lands* can be enforced by a hook and should be. A rule about *when to read memory* is judgment, and it is delivered as instruction to whatever runtime is reading it. Designing a CLI to "enforce" something that is really judgment only produces an instruction with extra steps.

Concretely:

- **Orientation is separate from memory.** The second runtime's context file (`~/.codex/AGENTS.md`) is generated from sentinel-delimited blocks of the same source documents that feed the first runtime's global instructions, plus two runtime-specific blocks (its security posture and a nudge, below). The entry point is an orientation document written for agents that do not know the system. Memory sits behind it. An agent given only the memory index gets a page of allusions with no referent.
- **Surface a missing file instead of papering over it.** The second runtime can be configured to fall back to `CLAUDE.md` whenever `AGENTS.md` is missing. One config line would have covered every project, and every missing file would have gone unnoticed. Instead, the generated instructions ask the agent to *propose* a pointer-shaped `AGENTS.md` when a project lacks one. This is the "surface errors, don't swallow them" principle applied to configuration.
- **Let the second runtime keep its native memory.** The first design told the second agent not to use its own memory feature and to write into the shared memory directory instead. That instruction would have competed with the runtime's own harness. The better call is to leave native memory on and promote anything worth keeping into the shared store at the periodic consolidation pass, once the native format has actually been seen.
- **Session identity goes through the second runtime's own hooks.** The second runtime turned out to have a hook system of its own: a JSON config, a dozen lifecycle events, and a stdin payload using the same field names as the first (`session_id`, `transcript_path`, `cwd`, `hook_event_name`). Three hooks (session start, stop, session end) register the session with the web UI's terminal the same way the first runtime's notify hook does, tagged `agent: 'codex'`. The hook makes no permission decisions, because the second runtime has its own sandbox and approval policy.
- **Threads are the cross-agent handoff unit.** Thread-to-session links carry an agent prefix (`codex:<uuid>`; a bare UUID still means the first runtime), the session reader parses both transcript formats, and resume buttons route by agent. Continuing work across runtimes goes through shared thread state. Nothing converts one runtime's transcript into the other's.

## Implementation

The sync script renders the second runtime's global context file from the repo:

```
source docs ──(sentinel blocks)──► ~/.codex/AGENTS.md
   principles, rooting, about-raven       + codex-security.md
   (shared with the first runtime)        + codex-nudge.md (runtime-only)
```

The hook installer merges its entries into the second runtime's hook config around whatever is already there, with `--check` and `--remove` modes. The server's hook endpoint accepts an `agent` field that defaults to the first runtime, so the existing hooks needed no change. Terminal tabs show which runtime is live, with a marker for each.

Two measured corrections to the design:

- **Context-file size limits can be defaults, not ceilings.** The second runtime's context-file cap turned out to be a configurable default with no clamp in the source. At roughly 8k tokens against a context window of over a million, it was never a capability constraint, and raising it was one config line.
- **A memory CLI was designed and dropped.** Its `add` verb would have been an instruction to the second agent just as much as "write markdown into `memory/`" is, because the guard is a hook in the *first* runtime and cannot see the second's tool calls. Its `index` verb fell to the numbers: the per-machine section it would have maintained was about 400 bytes of pointers to files already in the repo. The whole design reduced to a document, a hook entry and two lints.

## Gotchas

- **Hooks are trust-gated by hash in the second runtime.** It runs no hook until a human reviews and trusts it, it skips untrusted hooks *silently*, and re-running the installer after editing a hook invalidates the trust again. A test run with the trust bypass flag confirms the hooks work. It does not confirm they will run in normal use.
- **Sessions are created lazily.** Launching the second runtime's TUI writes no transcript and fires no hook until the first prompt. The terminal marker that says "this tab runs the second agent" is therefore driven by its launch banner in the PTY output, while the session *identity* still comes only from the hook. Non-interactive runs start a session immediately, which is why the gap never showed up in scripted tests.
- **A runtime's system-injected content can look like user turns.** The second runtime files a ~25 KB plugin catalogue under the user role, which rendered as the opening user message of every session in the reader until it was added to the injected-content filter. Read a real session through a new parser before trusting it.
- **Test on a throwaway server.** Validating hooks end to end needed a second web-UI instance on another port that does *not* auto-resume the persistent coordinator session. An environment flag that skips the coordinator is what made a safe parallel instance possible.
- **Per-machine generated files need a line in the setup checklist.** The second runtime's context file lives outside the repo, is regenerable, and exists only on machines where someone ran the sync. Nothing puts it on the others unless setup does.
- **Resist porting the guard.** The second runtime exposes pre-tool-use and permission-request events, so an equivalent of away mode is technically possible. It would duplicate a layer the runtime already has, which is the mechanism transfer this design set out to avoid. Build it only if a concrete need appears.
