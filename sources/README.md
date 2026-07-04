# sources/ — documents cited by the Raven system paper

Verbatim copies of the design documents quoted in the paper **"Raven: A Synchronized
Environment over a Moving Agent Runtime"** (Sjölie & Raven, 2026). The paper cites
these by their paths in the private Raven repository; this directory makes those
citations publicly resolvable. Paths below mirror the private repo.

Copied verbatim on **2026-07-04**. These are point-in-time snapshots taken when the
paper was finalised — the private originals keep evolving (the paper would call
that drift).

| Copy | Quoted in the paper for |
|---|---|
| `CLAUDE.md` | the founding "extends Claude Code … not a competing agent framework" decision |
| `docs/vision.md` | the "extend, don't replace" elaboration |
| `docs/principles.md` | the operating discipline, incl. the reading principle |
| `docs/synchronization-as-knowledge-work.md` | the synchronisation frame and its cost logic |
| `docs/memory-recognition-hook.md` | the recognition-before-retrieval design |
| `docs/memory-implementation-notes.md` | the stateless-substrate constraint |
| `docs/research/landscape-2026.md` | the "don't build" landscape conclusions |

The rest of this repository (architecture, patterns, solutions, history) is the
**echo** — a continuously regenerated public extract of the same system, written
fresh from the source rather than copied. Paper and echo are meant to complement
each other: the paper is the argued, versioned account; the echo is the living
tour.

Two deviations from strict verbatim, both deliberate and marked:

- **One quoted document is not mirrored.** The paper also quotes one clause from
  `knowledge/topics/presence-and-trust.md`, a research note whose later sections
  contain unpublished publication plans. Its ideas are public in essay form on the
  author's blog ("Presence Was Always Trust", SynchronizedNotes); the note itself
  stays private.
- **One redaction.** `docs/vision.md` had a single machine-local path replaced with
  the placeholder `<raven-repo>` (marked inline at the top of the file). Everything
  else, including the author's own usage statistics in
  `docs/memory-implementation-notes.md`, is verbatim.
