# Hub

The front door to my personal apps, live at https://apps.bohdanmoroz.com. It has one login for all of them, the app list, and a sidebar that opens any app inside the hub.

The apps live in their own repos but are one project. The hub logs you in for every app, routes their subdomains and writes the Deployment section of each app's `AGENTS.md`. Each app has an "Open hub" link back here.

| App | Repo | What it is |
|---|---|---|
| Courtside | [life-courtside](https://github.com/BohdanMoroz11/life-courtside) | NBA: which games to watch tonight, standings and a second screen for live games. [nba.bohdanmoroz.com](https://nba.bohdanmoroz.com) |
| Touchline | [life-touchline](https://github.com/BohdanMoroz11/life-touchline) | Football: a second screen for watching matches. [football.bohdanmoroz.com](https://football.bohdanmoroz.com) |
| Gym | [life-gym](https://github.com/BohdanMoroz11/life-gym) | A workout log with as little logging effort as possible. [gym.bohdanmoroz.com](https://gym.bohdanmoroz.com) |

See `AGENTS.md` for how it all fits together.

    npm run set-password
    docker compose up -d
    npm run app -- add <repo> <subdomain> "<Name>" "<description>"
