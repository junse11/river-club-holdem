# User-provided table recordings

Supplied by the user on 2026-11-04; filenames below preserve the source mapping. No external audio service is required. Vite bundles these recordings with relative asset URLs for GitHub Pages.

| Local asset | Original supplied filename | Trigger |
| --- | --- | --- |
| card.mp3 | oxidvideos-taking-playing-card-2-522516.mp3 | Hole-card deal and board slide/flip |
| all-in.mp3 | freesound_community-allinpushchips-96121.mp3 | All-in |
| shuffle.mp3 | oxidvideos-shuffling-deck-of-cards-522518.mp3 | New-hand shuffle |
| next-hand.mp3 | oxidvideos-placing-poker-chips-522523.mp3 | New-hand transition |
| bet.mp3 | freesound_community-poker-chip-dropping-80329.mp3 | Call once; bet/raise twice |
| fold.mp3 | oxidvideos-taking-playing-card-3-522513.mp3 | Fold |
| check.mp3 | freesound_community-cup-on-table-91925.mp3 | Check, twice, 100ms apart |

Short portions of the card, betting and new-hand recordings are scheduled to avoid long overlapping tails; all-in, fold and check use the complete recordings. Samples preload on the first user gesture. Missing/unavailable samples fall back to existing synthesized effects. Mute stops active and scheduled sample sources.

Auto-start: settle schedules the next hand after 3000ms; revealing a hand does not extend it. Pause preserves the remaining delay, and resume continues it. At least two ready players are still required. Manual 100BB reset returns to the waiting state and requires ready/start again.
