## Deployment

Live at https://{{subdomain}}.{{domain}}, behind the shared hub login. Do not add auth to this app.

The hub also shows this app in an iframe at https://apps.{{domain}}/{{subdomain}}, next to a sidebar of all apps. `inHub` (exported from `web/src/lib.ts`) is true there. Use it for anything that should differ inside the hub. For now it hides the "Open hub" link, because the sidebar already does that job.

- The `{{repo}}` container mounts this repo's primary checkout and runs `npm run live`. Caddy reaches it at `{{repo}}:3000`. No host port is published.
- There is no build or deploy step. Files changed in the primary checkout go live automatically, so `main` there is production.
- Worktree changes are not live until merged into the primary checkout's `main`. If merged on GitHub, run `git pull` in the primary checkout.
- Preview in a worktree with `npm run dev`. Don't use the primary checkout for experiments.
- If dependencies change, once they're on `main` run `npm install` in the primary checkout, on the host, then `docker restart {{repo}}`.
- If `compose.yml` changes, run `docker compose up -d` in the primary checkout.
- Logs: `docker logs -f {{repo}}`.
- Never use root or an Alpine image: files and `node_modules` are shared with the host.
- Routing, login and the app list belong to the `hub` repo. Don't change them from here.
