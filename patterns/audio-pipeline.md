# Audio Pipeline: Markdown to Listenable Audio

## Problem

Agent-generated reports and research documents are written to be read, not heard. Feeding raw markdown into a text-to-speech engine produces unusable output: heading markers, code fences, bold notation, and link syntax all get read aloud verbatim. Acronyms are spelled out when they should be expanded. Table rows are recited in sequence when the listener needs the headline insight. Long sentences that work on a screen are exhausting by ear.

The naive approach — strip obvious markdown noise, then call TTS — is an improvement, but still falls short. The document structure itself assumes a reader who can scan, skip, and re-read. Spoken audio needs a different shape: shorter sentences, explicit transitions, narrated tables, pause hints at logical boundaries.

This creates a text-to-audio pipeline problem with two distinct failure modes: (1) the synthesis engine is poor quality, and (2) the input is in the wrong form. Most builders focus on engine selection. This pipeline is built around a different hypothesis.

## Approach

**Central thesis: the normalization/rewrite pass matters more than the TTS engine.** Engine quality is a secondary variable. The primary variable is whether the input has been transformed from written-prose form to spoken-prose form before synthesis. A weak engine reading spoken-prose outperforms a strong engine reading raw markdown.

This thesis has since resolved — in an unexpected direction. The planned in-pipeline `--rewrite` flag was dropped: the rewrite lives *upstream*. The capable model that authored the document writes the spoken-prose version (`.spoken.md`) as part of producing it, with full context about what the document means; the pipeline then just synthesizes. A rewrite pass bolted inside the pipeline would re-derive, with less context, what the author already knew. The engine also moved from a paid API to a self-hosted TTS server on a spare machine — which flipped the economics (rendering became free, so listening versions are generated liberally rather than rationed) and moved chunking server-side (one merged output file instead of client-side parts).

The practical corollary: the work to put in the pipeline is transformation work — collapsing code blocks to prose descriptions, expanding acronyms on first use, breaking compound sentences, narrating "the key finding from this table is…" instead of reading rows. The TTS call is near-commodity once the input is right.

The pipeline is:

```
source document (.md / .txt / stdin)
  → strip frontmatter, headings, fences, inline markdown
  → [rewrite to spoken-prose form — currently hand-done as .spoken.md;
     automated LLM pass is the pending step]
  → chunk on paragraph boundaries (8,500-char budget per API call)
  → TTS API with steering instructions (voice, pacing, tone)
  → content-hashed cache lookup (skip synthesis if text+params unchanged)
  → publish to audio/<stem>__<voice>[.partNN].<ext>
  → register source document with reader panel
```

Content-hashed caching makes the pipeline idempotent on unchanged content: the cache key is `sha256(model + voice + instructions + format + text)`. Re-running the same document costs zero API calls if nothing changed. The synthesized files in the cache are canonical; the published files in `audio/` are copies that can be regenerated from the cache.

## Implementation

### Stripping (scripts/raven-listen.py)

The strip pass removes YAML frontmatter, horizontal rules, heading lines, inline bold/italic markers, code fences, and markdown link syntax. It preserves paragraph structure and blank-line spacing, which the chunker needs. The heuristic is conservative — TTS handles many inline patterns tolerably; the goal is eliminating the things that are definitely wrong (heading markers, fenced code, URL syntax), not sanitizing everything.

### Chunking

TTS APIs impose per-call input limits (the pipeline targets ~8,500 chars, which stays safely under the token cap with margin). Long documents auto-chunk on paragraph boundaries using a greedy packing strategy: pack paragraphs until the next one would exceed the budget, then start a new chunk. Sentence-level splitting is a fallback for unusually long single paragraphs.

Multi-part output uses zero-padded naming (`<stem>__<voice>.part01.ext`, `.part02.ext`, …). Single-part output uses the legacy flat naming (`<stem>__<voice>.ext`) for backward compatibility.

### Content-hashed cache

```python
def cache_key(text, model, voice, instructions, fmt):
    payload = "\n--SEP--\n".join([model, voice, instructions, fmt, text])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
```

Cache files live outside the repo sync directory (at `~/.raven/audio-cache/`) to avoid bloating cloud sync. Published audio files (in the repo's `audio/` directory, which IS synced) are idempotent copies. A file is only synced to the publish location if its size or modification time differs from the cache copy.

### API key loading without external dependencies

The pipeline loads credentials via a small `load_env_file()` helper that reads `KEY=VALUE` pairs from a `.env` file at the repo root. Environment variables take precedence over file values (env wins over file). The helper skips blank lines and comments, strips matched surrounding quotes, and soft-fails silently if the file is missing. No `python-dotenv` or other dependency is needed. The `.env` file is gitignored.

```python
def load_env_file(path):
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value
```

### Reader panel integration (source document as the canonical entry)

The design choice here is: register the source `.spoken.md` document as the reader panel entry, not the audio files. Audio files are artifacts that are discovered dynamically from the registered source entry. This keeps the reader panel list clean (one entry per document, not one per voice per document) and makes voice selection a runtime query rather than a registration event.

The server exposes `/api/audio/lookup?source=<path>`, which calls `findAudioFor()`. This function scans the `audio/` directory for files whose names match the pattern `<source-stem>__<voice>[.partNN].<ext>`, groups them by voice, and sorts parts numerically. The client (`spokenTemplate` in the reader JS) calls this endpoint on load, then either renders a player for the available renderings or shows a generate button.

The `/doc` endpoint serves audio files as binary with the correct `Content-Type` header. It bypasses the normal document-registry check for files inside the `audio/` directory via `isAudioArtifact()`, since those files aren't registered individually in the documents config.

### Multi-part sequential playback

The client plays multi-part renders sequentially by wiring the `ended` event of each audio element to load and play the next part. A "Part X of N" indicator updates on each transition. From the user's perspective, a 12-minute document chunked into two parts plays as a continuous stream.

### Steering instructions

The TTS call includes a natural-language instructions field that shapes delivery:

```
Read in a calm, conversational tone — like someone telling a colleague
about a research finding over coffee. Slightly thoughtful pacing,
natural pauses at em-dashes and ellipses. Not formal, not breezy.
When you encounter a list, slow down slightly between items.
```

These instructions are part of the cache key, so changing the steering prompt forces a re-render even if the text is unchanged.

## Gotchas

**Non-determinism in TTS output.** The same input, voice, and instructions can produce files that differ by 30% or more in size across runs. Don't try to A/B by re-rendering with identical parameters — the variation is noise, not signal. Vary the rewrite or instructions deliberately if comparing output quality.

**Tables are a known failure mode.** Markdown tables stripped to plain text still sound like a recitation of rows. The rewrite prompt needs an explicit instruction to narrate the headline finding rather than enumerate cells. Until the automated rewrite pass exists, tables should be manually rewritten into prose in the `.spoken.md` source.

**Engine input limits require chunking.** The chunker handles this transparently, but the chunk boundaries matter. Paragraph-boundary splitting produces more natural audio than character-boundary splitting. The sentence-level fallback for very long paragraphs can produce awkward mid-thought cuts if a paragraph runs exceptionally long.

**Windows console encoding.** The Python script wraps `sys.stdout` and `sys.stderr` in UTF-8 on Windows startup. Without this, em-dashes and ellipses in the dry-run output are mangled by the default cp1252 console encoding. The API itself uses bytes from the file and is unaffected; this is purely a terminal display issue.

**HTTP range requests not implemented.** The `/doc` endpoint reads audio files fully and returns them as a single response. Mobile browsers (iOS Safari in particular) may stall on files above a few megabytes without range support. The fix is ~20 lines in the server; the decision was to defer until the problem actually occurs rather than build infrastructure speculatively.

**Dropbox sync and cache placement.** Published audio files in `audio/` are intentionally Dropbox-synced for phone access. The content-hashed cache is placed outside the sync directory to avoid accumulating audio files that don't need to roam. This is a deliberate inversion of the usual "keep caches out of the repo" recommendation — the sync value for roaming access outweighs the cache-hygiene concern.

**Automated rewrite quality is unvalidated.** The pipeline thesis rests on the claim that spoken-prose form produces substantially better audio than stripped-markdown form. The hand-rewrite experiments support this directionally. Whether an LLM rewrite pass can reliably produce comparable spoken-prose quality — and which prompting approach works best — is not yet tested. That's the highest-priority unvalidated assumption in the pipeline. *(Resolved since: see Approach — the rewrite moved upstream to the authoring model instead of into the pipeline.)*

---

The service shape established here — VPN-bound GPU server on a spare machine, one GPU thread for all pipeline work, seed-as-ID for reproducible output, content-hashed client cache — became the template for the second GPU service, self-hosted image generation (see [figure-generation.md](figure-generation.md)). That service diverged in one deliberate way: **load-on-demand instead of resident.** The image model fills most of the GPU and its host has a day job, so the model loads on first request and unloads after idle minutes — with a keep-loaded lease endpoint for iteration loops that would otherwise pay the multi-minute cold load repeatedly. Resident vs. load-on-demand is a per-service call driven by what else the GPU owes its time to.
