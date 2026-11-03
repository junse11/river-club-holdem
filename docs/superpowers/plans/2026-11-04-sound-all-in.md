# Sound and all-in showdown

Implemented for the GitHub Pages TypeScript game engine:

- Prepare Web Audio during the first pointer/keyboard gesture, preserve mute, handle failed resume gracefully. Sharpen chip collisions for call, bet/raise and all-in; strengthen card slide/flip sounds while keeping the shared board-animation timeline.
- When betting closes with at least two live players and no further betting possible, automatically reveal every non-folded hand before the board runout. Continue street-by-street runout and normal pot/bounty settlement; keep these hands public through settlement. Do not reveal while a call/fold decision is outstanding. This also covers a single remaining player with chips after all required calls are resolved.
- Persist the all-in showdown state, reset it on a new hand or stack reset, and prevent hiding mandatory all-in hands.

Validation: Added tests first and confirmed failures for first-gesture audio initialization, street-specific card sound events and pre-runout reveal. Regression tests cover folded-card privacy, outstanding action, restoration, runout completion and mandatory reveal. Vitest: 33 passing, 1 existing expected failure for public MQTT serialization. TypeScript and Vite build pass. Subjective sound quality has not been auditioned on physical speakers. No deployment performed.
