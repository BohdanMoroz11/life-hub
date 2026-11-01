# Hub

The app list and shared login for my personal apps, at https://apps.bohdanmoroz.com. Keep it small: no dependencies, no build step, no database.

## How the platform works

- Each app is its own repo in `~/projects` with its own `compose.yml`. It runs in a `node:24-slim` container with the repo mounted, on the external `web` Docker network, listening on port 3000.
- Caddy (`~/reverse-proxy`, not in git) routes each subdomain to its container. It asks this hub's `/auth` before forwarding any app request. If the hub is down, apps return an error rather than opening up.
- `/auth` returns 204 when logged in, 401 for `/api` and non-GET requests, and otherwise a redirect to the login page.
- The session is a signed cookie on `.bohdanmoroz.com` that lasts a year. It renews when the hub page is opened.
- Secrets are in the gitignored `.env`, written only by `npm run set-password`. Agents must not read, print or change it.

## Files

- `server.mjs`: pages, login and `/auth`.
- `apps.json`: the list of apps. Source of truth for the hub page, the Caddy routes and the agent docs.
- `bin/app.mjs`: `add`, `caddy` and `docs` commands, run with `npm run app -- <command>`.
- `templates/`: the `compose.yml` and AGENTS.md block given to each app.

## Common tasks

- Add an app: `npm run app -- add <repo> <subdomain> "<Name>" "<description>"`. The repo needs `server/index.ts` and Vite, or its own `live` script.
- Change the Deployment instructions every app gets: edit `templates/agents-block.md`, then `npm run app -- docs`. Set `agentNote` in `apps.json` for an app-specific line.
- Never edit `~/reverse-proxy/conf.d/apps.caddy` by hand. It's generated.
- Changes to `server.mjs` go live on save, through `node --watch`.
