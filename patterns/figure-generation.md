# Figure Generation: The Caption Is the Artifact

## Problem

Academic papers need figures — structural diagrams of methods and systems, and conceptual/pictorial figures for arguments, covers, and posters. An agent can drive an image model, but naive prompt-and-pray doesn't converge: each regeneration is a fresh roll of the dice, feedback like "add the missing connecting element" has no reliable way to land, and the result isn't reproducible six months later when a reviewer asks for a tweak. Worse, most self-hosted diffusion stacks (ours included) have **no inpainting or img2img** — you cannot edit pixels, only regenerate.

## Approach

The reference point is the PaperBanana architecture (arXiv:2601.23265) — Retriever / Planner / Stylist / Visualizer / Critic as separate agents. We collapsed it into **phases of one agent session** (a skill, not a framework — no subagents), and split the Visualizer into **two lanes chosen by figure type**:

- **Structural diagrams → SVG code.** Method pipelines, architectures, anything needing precise geometry and small text. The critic edits *code*, convergence is fast, output is infinitely scalable, and the editable source lands in the repo beside the rendered PNG. (Dense data plots are a third thing: plotting code, neither lane.)
- **Pictorial figures → structured JSON captions.** Conceptual art, covers, posters — rendered by a caption-trained image model (an open-weight model trained exclusively on structured JSON captions with explicit elements, bounding boxes, and dedicated text fields; plain-text prompts are its low-quality path).

The load-bearing idea in the pictorial lane: **the caption is the artifact, the image is disposable.** Combined with seed-as-ID (same caption + same seed → identical image), iteration becomes *surgical caption edits at a fixed seed* — approximately structure-preserving, so "fix the missing element" edits one caption field and re-renders while the rest of the scene stays put. The critic is the same agent session reading the rendered PNG in its own context against a checklist (fidelity to the caption, per-element presence, connectivity) — no external vision-model calls. Generate-and-select across a handful of seeds and style presets, then iterate on the winner.

What lands in the paper's `figures/` directory is the PNG **plus** its caption JSON and a provenance note (seed, accepted deviations, license flags). The figure can be regenerated, and edits months later start from the real source. When true regional edits are needed despite no inpainting: same-seed renders stay spatially aligned, so raster compositing *within a style family* works — cut a region from variant A into variant B, and keep the compose script beside the figure so even the composite is reproducible.

**Keep the model warm across the loop.** The GPU server loads on demand and unloads after idle minutes (the machine has a day job); a cold load costs minutes. The iteration loop would pay it repeatedly, so the server exposes a keep-loaded lease — `POST /hold {seconds, preload}` at loop start (preload overlaps with caption writing), iterate warm at seconds per render, release when done.

## Implementation

A caption edit round, concretely:

```
v1 render (seed 1): metaphor reads, but the connecting track is missing
→ edit ONLY the caption's background field to name the connecting structure
→ re-render, same seed
v2: connecting track present, scene otherwise stable → accept
```

The critic pass runs per variant, not just per round — one seed silently dropped a specified figure (a person) from a two-person scene while other seeds kept it. A per-variant element sweep against the caption's element list catches this class.

## Gotchas

- **Single-element caption edits can still drift other elements at the same seed.** "Approximately structure-preserving" is approximate. Re-check the whole element list after every edit, not just the edited element.
- **Pose and action clauses may be satisfied with unrequested props.** Asked for a climbing figure heading up-and-over, the model added a ladder — physically satisfying the clause, fatally breaking the metaphor. When a prop would break the figure's meaning, write an explicit no-prop guard into the caption.
- **Some clauses are unwinnable: canonical-orientation priors beat instructions.** "The blueprint faces the examiner, not the viewer" never landed across variants — models render iconic objects in their canonical orientation, and pushing harder deleted adjacent elements as collateral. Recognize a losing clause after two or three rounds, accept the deviation, and *record it* in the figure's provenance note instead of burning rounds.
- **The critic has a known blind spot for fine-grained connectivity** (which arrows join which boxes). That's exactly where the SVG lane wins — connectivity is explicit in code. If a figure is mostly connectivity, it's a structural figure, even if a pictorial render would look nicer.
- **Check the model's license before a figure ships.** Open-weight image models are frequently non-commercial/research-only. Flag it in the figure's provenance README at generation time, when the fact is in front of you — not at submission time, when it isn't.
