# GitHub Pages — one-time setup

`.github/workflows/docs.yml` is wired and the VitePress site builds
cleanly (`npm run docs:build` succeeds). All that's missing is the
GitHub-side switch that says "yes, please serve a Pages site."

This is a 30-second click-through you do **once per repo**.

## Steps

1. Open <https://github.com/Cosm1cBug/EchoFox/settings/pages>.
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**
   (NOT "Deploy from a branch").
3. Save. That's it — no other fields to fill.
4. Go to <https://github.com/Cosm1cBug/EchoFox/actions/workflows/docs.yml>
   and click **Run workflow** → **main** → green **Run workflow**
   button. This triggers a manual deploy.
5. Wait ~90 seconds. When the run is green, your site is live at:

   **<https://cosm1cbug.github.io/EchoFox/>**

From this point onward, every push to `main` automatically rebuilds and
redeploys the site (via the workflow's `push: branches: [main]` trigger).

## Verification

- Visit <https://cosm1cbug.github.io/EchoFox/> — should show the
  EchoFox VitePress home page.
- Click any sidebar link (Guide, Commands, Architecture, etc.) — the
  routes should resolve with no 404s.
- View the page source — CSS/JS asset URLs should start with
  `/EchoFox/assets/` (NOT `/assets/`). That's the project-page base
  path we set in `docs/.vitepress/config.mjs`.

## Troubleshooting

| Symptom                                               | Cause                                                 | Fix                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| 404 on `https://cosm1cbug.github.io/EchoFox/`         | Pages source not set to "GitHub Actions"              | Repeat step 2 above                                                  |
| Site loads but CSS/JS broken                          | `base:` in vitepress config doesn't match deploy path | Verify `base: '/EchoFox/'` in `docs/.vitepress/config.mjs`           |
| Workflow runs but "Deploy to GitHub Pages" step fails | Repo Pages env doesn't exist yet                      | Step 2 creates it on first save                                      |
| Workflow doesn't run on push                          | `paths-ignore` filter excluded everything             | We removed that filter in v1.11.0 — should run on every push to main |

## Custom domain (optional, later)

If you want `docs.echofox.example` instead of the github.io URL:

1. Add a `CNAME` file with one line: `docs.echofox.example`
   to `docs/public/` (so VitePress serves it from the build output).
2. In your DNS provider, add a `CNAME` record:
   `docs.echofox.example. → cosm1cbug.github.io.`
3. In repo Settings → Pages → Custom domain, enter the domain. Wait
   for the DNS check + auto-HTTPS.
4. Update `base: '/EchoFox/'` → `base: '/'` in the vitepress config
   (custom domains are served at root, not under `/EchoFox/`).

Not needed for v1.11.0 — the project-page URL works out of the box.
