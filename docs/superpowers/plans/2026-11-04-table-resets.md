# Immediate table resets

**Goal:** Host-only stack and bounty resets, usable during a hand with explicit confirmation.

**Design:** Stack reset cancels the current hand without awarding its pot or bounty, clears all live and paused timers, and returns to WAITING with every seated stack at 100 times the current BB. Players ready again before the host starts. Preserve bounty, history, current and pending blinds. Bounty reset clears seated and archived scores and victim logs immediately without changing the current hand. Clear the latest bounty banner; historical hand results remain historical. Record each reset in the room chat.

**Architecture:** Extend the existing TypeScript engine and coordinator for the currently deployed GitHub Pages mode. Add host controls with explicit cancel and confirm actions. This feature does not replace the public MQTT architecture; server authority and durable recovery remain separate required work for tournament readiness.

**Tech Stack:** React, TypeScript, Vitest.

- [x] Add and run failing tests for authorization, mid-hand cancellation, timers, score independence and serialization.
- [x] Implement engine methods and coordinator routes.
- [x] Add host-only confirmation dialogs with action-specific consequences and busy state.
- [x] Run test suite, typecheck and production build; review diff.

Validation: Vitest 29 passed, 1 pre-existing expected failure; TypeScript and Vite production build passed. Confirmation uses the browser's native confirm/cancel dialog. Changes are local and have not been pushed or published. The existing Java backend does not expose these new controls; they target the deployed serverless mode.
