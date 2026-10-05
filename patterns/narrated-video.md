# Narrated Video from a Storyboard

## Problem

Some things an agent system produces work better as a short video than as a page: a paper explained in four minutes, a trailer for a project, a walkthrough of a web app for colleagues who will never open it. Video is the medium an agent is worst placed to make by hand. It cannot watch or listen to the result. Editing tools assume a person dragging clips on a timeline. When a change of wording moves every later cut, a hand-timed edit falls apart.

Video also has a failure that text doesn't. A video is a *derived* artefact, and a spoken summary of a paper tends to drop the hedges and harden the claims. Nobody compares a narration with its source line by line, so a strengthened claim survives.

The generated parts fail in their own ways. Self-hosted text-to-speech sometimes returns a clip that stutters, adds words, leaks text from its voice reference, or never stops. A clip can be the right length and still say the wrong thing. The mix can drift in loudness over time while its whole-file loudness figure looks normal.

## Approach

**One storyboard is the single source.** A storyboard is a JavaScript module where each shot pairs what is *said* with what is *shown*. Everything else is derived from it: narration, timing, pictures, chapters, the player page.

**Audio first, so nothing is timed by hand.** The narration is rendered before anything else. Each shot lasts as long as its lines plus small lead, gap and tail pauses. The start time of each line is handed to the visual as a cue, so an animation can land on the word it illustrates. A rewritten line re-times its own shot and moves the later ones, with no hand-editing.

**Pictures come in two shapes.** A **still** is a 3840×2160 image that the assembler moves across with an eased camera rectangle. A **frame sequence** is rendered from a page, one screenshot per video frame. Stills cover most of a long video: figures, a live web page, a highlighted passage of a rendered manuscript. Frame sequences are for the moments that need motion, because capturing frames is slow.

**The build checks itself, and the checks fail the build.** A missing source is an error, never a placeholder. Every narration clip is transcribed and compared with its line. Every encoded segment must match its time slot. The final file's loudness is measured *per shot*, not only as a whole. A check whose failure can be overridden in the moment tends to get overridden, so these exist only as hard failures.

**Review is by stills, not by watching.** The agent cannot watch the video, and a person watching tends to miss what a contact sheet shows at a glance. The build prints a contact sheet of the whole video. A partial build of chosen shots prints each shot's first frame above its last.

**Honesty is part of the format.** Every non-card shot carries a small corner tag saying what the viewer is looking at: `FIGURE FROM THE PAPER`, `LIVE CAPTURE`, `CONCEPT ART`, `ILLUSTRATION · REAL DATA`. For a derived video, the storyboard's header comment lists the hedges the source makes and the numbers it has not verified, before any line is written. The rule is that every claim stays exactly as strong as the source left it.

### Built from instances, not from the abstract

The tool came third. First came a trailer for a browser-based game prototype in another project, then a trailer for Raven itself. Both were built with throwaway scripts and a hand-tuned cut table. Only then was a general tool written. It was made general on purpose, for papers and lectures as well as trailers, and the first video built on it was the video version of a draft paper. The Raven trailer was then rebuilt on the tool. Each instance found a defect the previous one couldn't, and most of the checks below exist because an earlier cut shipped the defect.

## Implementation

### The storyboard

```js
export default {
  name: 'paper-video',
  title: 'A draft paper, in a short video version',
  tag: 'DRAFT PAPER',                 // default corner tag on every non-card shot
  voice: 'house',                     // the self-hosted house voice, or { url, body } for another TTS
  shots: [
    { id: 'title', show: { card: 'title', title: 'The Title', sub: 'one-line framing' },
      say: ['The title, read aloud.'], min: 6.5, poster: true },

    { id: 'lineage', chapter: 'Not new',
      show: { card: 'list', kicker: 'An old architecture', items: [['First', '1968'], ['Second', '1968'], ['Third', '1979']] },
      say: ['The architecture is not new.', 'The first,', 'the second,', 'and the third have run it for decades.'] },

    { id: 'study', chapter: 'Evidence', cite: 'Author et al. 2016',
      show: { doc: '../_manuscript/index.html', find: 'Only one of the twenty' },   // highlight this passage
      say: ['Only one of the twenty got the same rank from all six assessors.'] },
  ],
};
```

A list card with as many items as narration lines reveals one item per line, so splitting a list into one line per item times the reveal exactly. A `doc` shot opens the rendered manuscript, finds the smallest block that contains the `find` text, highlights it, marks the phrase and pushes the camera in on it. If the text is not on the page, the build fails. A rendered HTML manuscript turned out to be a better picture source than a PDF. The same browser automation that films a web app can scroll to a passage and frame it.

### Timing follows the narration

```js
let t = 0;
for (const s of shots) {
  s.clips = [];
  for (const line of [].concat(s.say ?? [])) s.clips.push(await speak(line));   // checked clips (below)
  let at = s.lead ?? 0.4;
  s.cues = s.clips.map((c) => { const cue = at; at += c.duration + (s.gap ?? 0.35); return cue; });
  s.dur = Math.max(s.min ?? 0, at - (s.gap ?? 0.35) + (s.tail ?? 0.6));
  s.start = t; t += s.dur;
}
```

### Scenes as pure functions of time

A custom scene is any HTML page that defines `window.render = (t) => key` and sets `window.sceneReady = true`. The capture loop sets frame *i* to `render(i / 30)`, then takes a screenshot. Because `render` is a pure function of `t`, the motion is perfectly smooth however slow the machine is. The page never sees wall-clock time. The return value is a key describing the visible state, such as rounded opacities. When two consecutive frames return the same key, the second is copied rather than captured, which makes static stretches nearly free. The page also receives the shot's length and its cue times, so an animation can start on its word.

The illustrations got more convincing when they were drawn from **real data** instead of invented shapes. The Raven trailer used the wiki's actual link graph, the real overnight schedule and the failure log's real entry headings.

For filming somebody else's animated page, which the tool doesn't own, the first trailer used a **clock shim** injected before the page's own scripts run. It takes over `requestAnimationFrame` and `performance.now`, and each video frame advances a fake clock by exactly 1/30 s and runs the queued callbacks once:

```js
// injected with Page.addScriptToEvaluateOnNewDocument
const realNow = performance.now.bind(performance), realRaf = requestAnimationFrame;
let stepping = false, fake = realNow() + 1000, queue = [];   // start ahead: no frame sees time run backwards
performance.now = () => (stepping ? fake : realNow());
requestAnimationFrame = (cb) => (stepping ? queue.push(cb) : realRaf(cb));
window.__clock = {
  on() { stepping = true; },
  step(ms) { fake += ms; const q = queue; queue = []; q.forEach((cb) => cb(fake)); },
  off() { stepping = false; queue.forEach(realRaf); queue = []; },
};
```

The shim cannot slow down anything a *server* moves, because the server's clock keeps running between frames, and stepped shots of server-driven motion play back far too fast. Those shots used real-time screencast capture, with each frame's timestamp kept and the frames resampled to a constant rate at assembly. It is less smooth, but true to time.

### Stills and camera moves

Stills are captured at device scale factor 2 (3840×2160) and moved at 1920×1080, so a zoom of up to 2× stays sharp. A camera move goes between two rectangles given as fractions of the still, eased with smoothstep. Live page captures mask IP and email addresses by walking the DOM's text nodes first. Canvas content, such as a terminal emulator, is not covered by that walk and has to be checked by eye.

### Narration clips are accepted, not assumed

```js
async function accept(clip, line) {
  const words = line.split(/\s+/).length;
  if (clip.duration > 2 * (words / 2.5 + 1.5)) return reject('runaway');   // ~2.5 words/s, generous margin
  const heard = await transcribe(clip);                  // a local recogniser, small model, on the CPU
  const { added, dropped, substituted } = alignWords(line, heard);   // longest common subsequence
  return added <= 0 && dropped <= 1 && substituted <= Math.max(1, Math.round(words * 0.15));
}
// a rejected clip is retried at other sampling temperatures (output is deterministic per temperature);
// if every temperature fails, the build stops and names the line, to be reworded or split
```

Substitutions pass on purpose: a recogniser mishears names and writes digits where the script has words, and that is not a synthesis defect. Before comparing, numbers are normalised to words ("118" against "a hundred and eighteen"). Added words never pass, because added words are what stutters, loops and reference leaks look like. Clips are cached by a hash of the voice configuration and the text. A clip cached before the transcript check existed is checked on its next use, and is thrown away if it fails.

### The mix: slots, not a mixer

The clips never overlap, so the narration track is built by **concatenation**. Each clip becomes a WAV "slot" that runs exactly from its cue to the next cue: the clip, then silence. The slots are joined end to end, which is sample-exact. Each clip is first gain-matched to a common loudness, because separate TTS requests land up to 3.5 LU apart. A quiet synthesised pad goes under the voice, ducked by a sidechain compressor. The mix is then normalised in two linear passes, measuring first and then applying, so there is no pumping. The last check measures each spoken shot's integrated loudness in the *final file* and fails the build if the shots differ by more than 3 LU.

### Output

The output is a folder holding the mp4, a poster frame and a player page with chapter links. The folder is registered as a static on the local web server (see [service-registry.md](service-registry.md)), so a video is one URL away on any device on the private network, phones included. Videos and work files stay out of git. Work files go outside the synced tree, because a frame sequence runs to gigabytes.

## Gotchas

**Never lay narration with `amix` on ffmpeg 4.2.** The first paper video jumped about 12 dB at 2:22 and dropped back two seconds later. The raw clips measured normal. The bug was in the mix: delayed clips mixed with `amix` and boosted with `volume=n`, a recipe copied from the first trailer. In that version `amix` divides by the number of inputs *still active*, so the mix got louder as earlier clips ended. The whole-file loudness figure, which was checked, cannot see drift over time. A human ear caught it. Building the track from slots removed the cause, and the per-shot spread check means the next drift of this kind fails the build instead of reaching the ear.

**Length checks miss most TTS defects.** Clips that passed a duration check said "a frozen, a frozen, a frozen, a frozen, a frozen, a frozen documented…", added a stray "About,", or read "Shared, about six minutes, shared…", where "about six minutes" came from the voice reference's own transcript. Only a transcript comparison catches these. About one short line in four failed at the default temperature. The root cause turned out to be a voice reference whose transcript did not match its audio, and fixing it removed the failures (see [audio-pipeline.md](audio-pipeline.md)). The transcript check stays anyway, because the next voice will fail in its own way.

**"No recogniser on this machine" was a claim made before its one cheap check.** The first trailer shipped without any transcript check because `command -v whisper` found nothing. A Python recogniser had been installed in the project's virtual environment the whole time, with models cached. The trailer went out with a stuttered clip ("Claude code code") that a transcript would have caught. Before saying a tool is unavailable, look where the project keeps its tools, not just on `PATH`.

**Aim camera moves by looking at the still, never from memory of the layout.** In the second Raven trailer, five moves on UI stills had been set from memory of where things were. They zoomed onto empty terminal space, a page margin and the wrong columns. The review sheet then showed one mid-shot frame per shot, which hid where each move *ended*. The fix is to put a grid over the still, choose the rectangle that holds what the narration is talking about, and check the last frame. The partial-build sheet now shows each shot's first frame above its last.

**Placeholders ship.** The first trailer's build drew a labelled card for any missing source, so that a rough cut would still play. Two "final" encodes went out with `[ sea — not made yet ]` at 1:40, and only a contact sheet caught it. A missing source is now an error.

**Every defect found in review was found on a contact sheet, not by watching.** One frame every 5 or 10 seconds, tiled into a single image, shows a whole cut at once. Watching invites attention to drift with the narration.

**Capturing is a playtest.** Filming the game prototype showed characters standing "at home" drawn inside their house walls, with only their marker icons visible. Every earlier acceptance run had missed it, because those runs read state rather than pixels. Budget time to fix what the camera finds, and to capture again afterwards.

**Check the narration's own claims last, against the source.** The first Raven trailer ended with "made in an afternoon", and the work had run past midnight. Re-reading the final lines against the source is the last step before publishing, after the wording has stopped changing.

**ffmpeg details that cost time.** `zoompan` rounds its crop offset to whole pixels, so a slow pan creeps and snaps back every few frames. Upscaling the still before `zoompan` makes each rounding step a fraction of an output pixel. Use `drawtext` with `textfile=` rather than inline `text=` to stay out of quoting trouble with colons and apostrophes. Copy the font file next to the work files and give a relative path, which avoids escaping a Windows drive colon.

**Frame capture runs at about seven frames a second.** An hour of animation would take hours to capture. Long videos should be mostly stills and cards, with scenes only where motion carries meaning.

**Not checked: how the narration sounds.** The transcript check says the right words were spoken, not that they were spoken well. Pace, emphasis and timbre still need a human to listen to the finished video.

## Related

- [audio-pipeline.md](audio-pipeline.md) — the self-hosted voice the narration uses, and the reference-pair fix.
- [figure-generation.md](figure-generation.md) — generated stills for concept shots, and the same honest-labelling instinct.
- [clarity-pass.md](clarity-pass.md) — the other derived-text process where claims must stay exactly as strong as the source.
- [instrument-trust.md](instrument-trust.md) — why a whole-file average says nothing about drift.
