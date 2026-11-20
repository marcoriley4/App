# Rules for working on the Top Hat app (from the owner, permanent)

1. **Never remove or drop existing features.** Keep every page, button, working function and all
   4 roles (customer, sales, contractor/crew, office) intact. Don't shorten, skip or delete working code
   when editing something else. Only remove a feature when the owner asks for that exact feature to go.
2. **The AI Design Studio inside customer sign-up is a permanent core screen.** It is step 2
   ("Design") of the request wizard in `buyer.js` (`screen === 'design'`; step 1 is Photos, step 3 is Schedule),
   which is also how new customers sign up. It must always let a new customer use their before photos, pick a
   room/look or type their own words, and generate the AI (Gemini) dream picture right there,
   shown as the before/after slider. Never remove or hide it when editing other dashboards.
3. **Keep it connected to their new account.** When a new customer sends the request and makes their
   account, the before photo, the AI after picture and the project are attached to their job
   (`api.designs.adopt` + `api.designs.save` in `submitJob`) and show on their My jobs dashboard.
4. Before committing, run `node tests/signup-studio.test.js` (with `python3 -m http.server 8766` running
   in this folder). It must print only PASS lines.

Other standing rules: never put secrets (API keys, bank details) in code; the repo is public.
Contractors never see customer prices or profit. Run `./bump-version.sh` before each commit.
