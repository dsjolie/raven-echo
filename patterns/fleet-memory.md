# Fleet Memory: One Master Index, Projected Per Machine

## Problem

An agent runtime that carries persistent memory across conversations usually stores it in a per-user runtime directory — an index file the agent auto-loads at session start, plus topic files it can read on demand. That works fine for one machine. It falls apart the moment the same person works from several.

The symptoms arrive in this order. First, each clone accumulates its own memories, and nothing propagates: a lesson learned on the laptop is invisible from the desktop. Then the shared facts drift — the same entry, worded differently, dated differently, on three machines with no way to tell which is current. Then the machine-specific entries (this box's GPU, that box's service ports, the one clone that runs a VPN node) get mixed in with the fleet-wide ones, so any attempt to sync becomes a merge of things that *should* be shared with things that *must not* be.

The naive fix — put the whole runtime memory directory in cloud sync — fails on all three counts. It has no conflict story beyond last-write-wins, it can't reach machines that don't run the sync client, it's invisible to cloud-hosted agent runs entirely, and it flattens the shared/local distinction rather than expressing it.

## Approach

**Master the index in the repo; project it into the runtime.**

- **Master** — a canonical index file lives in the project repo, git-tracked. Git is the sync carrier: it reaches every clone, including the no-sync-client machines and the ephemeral cloud checkouts that a file-sync product never touched.
- **Runtime** — the file the agent actually auto-loads is the master's content *plus* an optional per-machine **local section**, everything below a marker line. Entries below the marker never leave the machine.
- **Topic files** stay in the repo too, one file per fact. Fleet-wide ones sit at the top level; machine-specific ones live under `memory/machines/<name>/` and are pointed at *only* by that machine's local section. They're still in git — visible to the fleet, backed up, greppable — but only one machine auto-loads them.

The critical asymmetry: **blind copy runs only in the master → runtime direction. The runtime → master direction requires judgment.**

A `pull` is mechanical — take the master, append this machine's preserved local section, write the runtime file, back up what was there. A `push` is only a shortcut for the trivially-safe case (runtime is strictly ahead of master, nothing to reconcile). Everything else goes through an agent: on drift, it decides *per entry* whether this is a fleet-relevant fact that belongs in the master, or a machine-specific one that belongs below the local marker — then pulls to converge.

That's the whole design. The script is deliberately dumb; the intelligence sits on exactly one edge, the one where a wrong decision leaks local detail into shared state or buries a shared lesson on one machine.

## Implementation

```
sync-memory-index.py status   # diff runtime's shared part against master
sync-memory-index.py pull     # master → runtime, preserving the local section
sync-memory-index.py push     # runtime's shared part → master (strictly-ahead case)
```

The runtime file looks like:

```markdown
# Project Memory

- [Some fleet-wide fact](memory/some-fact.md) — one-line hook
- [Another](memory/another.md) — hook
...

<!-- LOCAL SECTION — <machine name> — entries below never leave this machine -->

- [GPU service ports](memory/machines/thisbox/gpu-services.md) — hook
```

Three implementation details that turned out to matter:

**Derive paths from the script's own location.** The repo root and the runtime path-key are both computed from where the script resolved to, not from a constant. That's what makes one script work on every clone with no per-machine configuration — and it's the difference between a tool that ships to the fleet and a tool that gets copied and edited four times.

**Stamp the marker with the machine's friendly name**, resolved from the machine registry. The marker is the thing a human reads when they open the file and wonder why it has two halves; naming the machine in it answers the question in place.

**Back up before overwriting, and check where the backup lands.** `pull` snapshots the previous runtime file. In this system the backup was written *inside* a directory that a separate nightly mirror job treated as its own — so the mirror's orphan cleanup deleted the pull backup every night. The backup existed, was correct, and had a lifetime of a few hours. A backup written into another job's managed directory is not a backup.

## Where it runs

Two hooks, and both are needed:

1. **Nightly consolidation** — a convergence check plus judged promotion. This is what keeps drift from accumulating silently; without a scheduled check, "the index has drifted" is only discovered when someone notices a missing fact.
2. **New-clone setup** — `pull` before the agent's first run on that machine. A fresh clone with an empty runtime index will otherwise start writing its own from scratch and become the fifth divergent copy.

## Gotchas

- **The enabling decision is git-tracking the memory directory at all**, and it's a privacy decision, not a technical one. Topic files that were previously local-only now reach wherever the repo goes. Make that call explicitly and knowingly; the mechanism above is only clean because the master needs no special homing — it's just a tracked file. Exclude the genuinely bulky/derived subdirectories (session archives, runtime mirrors) rather than the content.

- **Concurrent promotions from two machines are an ordinary git merge, and that's the design working.** Two machines promoting different entries on the same day produced a push race; it resolved as a text merge. Resist the urge to build a sync protocol. Git *is* the conflict surface — the agent-mediated merge at consolidation time is what makes multi-writer tolerable, not a locking scheme.

- **A new script inherits none of the project's established conventions.** The first run of this one on a Windows clone died on a `UnicodeEncodeError` — an arrow character in an index line against a legacy console codepage — because the script hadn't picked up the internal UTF-8 wrapper every other CLI in the project already used. Convention that lives in existing files doesn't transfer to new ones; if it's load-bearing, it belongs in a shared helper or a template.

- **Machine three tells you the tooling is portable; machine four tells you nothing new.** Onboarding the third clone surfaced real gaps (a runtime directory full of untracked stray files, an index that had never pulled). The fourth surfaced none — same convention, no fix needed. That's the point at which the claim upgrades from "works on the machines we tried" to "portable", and also the point at which further onboardings stop being evidence. Note when a rollout stops teaching you things.

- **Beware the completeness claim written mid-rollout.** The commit message for the third machine called it "the last un-migrated clone" and said the regime was complete fleet-wide. It wasn't — the count in the author's head was the machines they'd been thinking about, not the roster. If a registry exists, count from the registry.
