# Project delivery preferences

- The user authorizes automatic deployment after completed changes in this project. Unless the user explicitly requests local-only work, commit and push the relevant changes to the GitHub Pages deployment branch after verification, without asking again.
- Run `npm run test -w apps/web`, `npm run build`, and `git diff --check` before publishing. Stop and fix unexpected failures before deployment. Do not represent the existing expected-failure security test as a resolved issue.
- Deploy using the existing GitHub Pages workflow for `junse11/river-club-holdem` (`master`). Inspect the remote head before pushing, preserve unrelated user work, and never force-push.
- Verify the matching GitHub Actions deployment succeeds and that the live site serves the new build. Report the live URL and any remaining limitation accurately.
