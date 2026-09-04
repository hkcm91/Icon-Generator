---
name: token-saver
description: Audit and cut context/token usage on long sessions in this repo without losing work quality. Use when the user says "save tokens", "reduce context", "token audit", "token bloat", "optimize tokens", "I'm hitting limits", "context is getting huge", or when a session has run 20+ turns and each turn is re-reading the same large files (wallpaper/index.html, SimpleStudio.tsx, IconGrid.tsx, the Blender scripts, or docs/screenshots PNGs).
---

# Token Saver

Most input tokens in a long session are *reused* — carried forward from earlier
turns rather than new. The goal is to drop the reused material that no longer
informs a decision, and keep the material that does.

Realistic outcome: **40–70% reduction** with no quality change. 80–90% is
possible but aggressive; verify before trusting it on debugging work.

---

## Step 1 — Audit

When asked to audit, report:

- Which messages/tool results hold the most tokens
- Which category each falls into (below)
- A confidence tier per drop candidate

**Bloat categories**

| Category | Typical share | Safe to drop? |
|---|---|---|
| Rejected attempts / "that won't work" reasoning | 15–30% | Yes, once the decision is final |
| Stale tool output (old test runs, builds, greps) | 10–25% | Yes |
| Superseded file versions | 20–40% | Keep latest + one prior |
| Repeated standing instructions / API refs | 5–20% | Consolidate to one canonical copy |
| Settled decision chains | 10–20% | Replace with a one-line marker |
| Screenshots kept at full size | varies | Crop/annotate, drop the rest |

**Confidence tiers**

- **Safe (>95%)** — rejected code, old command output, reasoning behind a shipped decision
- **Probably safe (70–95%)** — duplicated tool definitions, older file versions
- **Risky (<70%)** — anything an open question still depends on. Flag, do not drop silently.

---

## Step 2 — The four core rules

Apply on sessions past ~20 turns. The user approves each one.

1. **Drop rejected answers.** An approach that was ruled out doesn't inform the
   next step; the final code already encodes the decision.
2. **Consolidate standing instructions.** One canonical copy of an API shape,
   tool contract, or convention — later turns reference it instead of restating.
3. **Truncate file history.** Keep the current state plus one prior version for
   diff context. Drop the rest.
4. **Archive settled decisions.** Replace the deliberation with the outcome:
   `Architecture: monolith (cost + latency) ✓`.

---

## Step 3 — Nine habits (use these going forward)

1. **Checkpoints** — "Phase 1 complete ✓" instead of restating what happened.
2. **Approval stamps** — "Approved ✓" replaces the iteration history.
3. **Diffs, not files** — show what changed, never re-paste the whole file.
4. **Batch output** — one message with 5 results, not 5 messages.
5. **Reference, don't paste** — "see `docs/RADIUS-DRIFT.md` §2" beats quoting it.
6. **Annotate screenshots** — crop to the region under discussion.
7. **No-change markers** — "unchanged since last turn" instead of re-posting.
8. **Defer explicitly** — "revisit caching in Phase 3 ✓" ends the loop.
9. **Session checkpoints** — every 10–15 turns, summarize and offer to drop old context.

Habits alone: 30–50%. Habits plus the four rules: 50–80%.

---

## This repo specifically

The heaviest things to read carelessly, in line count:

- `wallpaper/index.html` (~5.1k lines) — the live-wallpaper page. Never read it
  whole. Grep for the system you're touching (physics constants, glitter,
  bubbles, sensor cadence) and read that range.
- `src/components/SimpleStudio.tsx` (~1.5k) and `src/components/IconGrid.tsx` (~1.2k)
  — read by symbol, not top-to-bottom.
- `blender/water_ring_toy.py` (~2k) and `blender/liquid_shaker.py` (~1.2k).
- `docs/screenshots/*.png` — each is a full-app capture. Reading one costs more
  than most source files. Read one only when the visual is the question.
- `package-lock.json` — never read it; use `npm ls <pkg>` or grep for a single
  version string.

Practices that pay off here:

- Physics and rendering tuning is iterative by nature. After each accepted
  tuning pass, checkpoint the constants that landed (`gravity 0.42, viscosity
  0.31 ✓`) and drop the rejected values from context.
- `npm test` (vitest) output: keep the failing assertions, drop the passing
  roster.
- `npm run screenshots` produces new PNGs under `docs/screenshots/`. Compare
  them by describing the delta, not by loading both images.
- When exploring, delegate the sweep to a subagent and keep only its conclusion
  rather than the file dumps.

---

## When not to use this

- Sessions under ~10 turns — savings are under 20% and not worth the churn.
- Active debugging or incident response, where the history *is* the evidence.
- Anything needing a full audit trail of how a decision was reached.

---

## Honest limits

- The skill suggests what looks droppable; it cannot verify that quality held.
  Compare outputs before and after on one real task before trusting it broadly.
- The published 90% figure comes from a single case study and is unvalidated.
  40–70% is the number to plan around.
- It prunes conversation input only. It cannot make the model's own replies
  shorter, change how a tool formats its output, or alter provider-side
  token accounting.
