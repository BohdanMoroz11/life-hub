// Hub: the app list, the shared login, and the login check Caddy calls before every app request.
// No dependencies. Secrets live in .env, written by `npm run set-password`. No .env means nobody can log in.
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN = process.env.HUB_DOMAIN ?? "bohdanmoroz.com";
const HUB_URL = `https://apps.${DOMAIN}`;
const COOKIE = "hub_session";
const SIDEBAR_COOKIE = "hub_sidebar"; // "collapsed" or "open". Set by the page's script, host-only on the hub.
const YEAR = 365 * 24 * 3600;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function secrets() {
  try {
    const vars = Object.fromEntries(
      fs.readFileSync(path.join(root, ".env"), "utf8").split("\n").filter(Boolean).map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
    );
    return vars.PASSWORD_HASH && vars.SESSION_SECRET ? vars : null;
  } catch {
    return null;
  }
}

const sign = (value, key) => crypto.createHmac("sha256", key).update(value).digest("base64url");

function sameText(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name = COOKIE) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v;
  }
}

function isLoggedIn(req) {
  const s = secrets();
  const token = readCookie(req);
  if (!s || !token) return false;
  const [expires, mac] = token.split(".");
  return Boolean(mac) && sameText(mac, sign(expires, s.SESSION_SECRET)) && Number(expires) > Date.now() / 1000;
}

function sessionCookie(s) {
  const expires = String(Math.floor(Date.now() / 1000) + YEAR);
  return `${COOKIE}=${expires}.${sign(expires, s.SESSION_SECRET)}; Domain=.${DOMAIN}; Path=/; Max-Age=${YEAR}; Secure; HttpOnly; SameSite=Lax`;
}

function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64url"), 64).toString("base64url");
  return sameText(actual, hash);
}

// Only ever send people back to our own domain over https.
function safeNext(next) {
  try {
    const u = new URL(next);
    return u.protocol === "https:" && (u.hostname === DOMAIN || u.hostname.endsWith(`.${DOMAIN}`)) ? u.href : HUB_URL + "/";
  } catch {
    return HUB_URL + "/";
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const doc = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{color-scheme:light dark;--bg:#f4f4f2;--card:#fff;--text:#1b1c1e;--muted:#6b6e73;--line:#dcdcd8;--accent:#1b1c1e;--on:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#141517;--card:#1e2023;--text:#eceded;--muted:#9a9da3;--line:#2e3136;--accent:#eceded;--on:#141517}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
h1{font-size:20px;margin:0}ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
a.card{display:block;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:10px;color:inherit;text-decoration:none}
a.card:hover,a.card:focus-visible{border-color:var(--text)}a.card b{display:block}a.card span{color:var(--muted);font-size:14px}
input,button{font:inherit;padding:10px 14px;border-radius:8px}input{width:100%;margin-bottom:8px;background:var(--card);color:inherit;border:1px solid var(--line)}
button{background:var(--accent);color:var(--on);border:0;cursor:pointer;width:100%}
.error{color:#c2362b}form.login{max-width:320px;margin:15vh auto 0}
.shell{display:grid;grid-template-columns:auto 1fr;height:100dvh}.pane{overflow-y:auto;min-width:0}
nav.side{width:200px;display:flex;flex-direction:column;gap:2px;padding:12px 8px;background:var(--card);border-right:1px solid var(--line);overflow:hidden auto}
nav.side .item{display:flex;align-items:center;gap:10px;width:100%;padding:6px;border-radius:6px;background:none;color:inherit;font-size:15px;text-decoration:none;text-align:left;white-space:nowrap}
nav.side .item:hover{background:var(--bg)}nav.side .item[aria-current=page]{background:var(--accent);color:var(--on)}
nav.side .ico{flex:none;display:grid;place-items:center;width:28px;height:28px}
nav.side .badge{border:1px solid var(--line);border-radius:6px;font-size:13px;font-weight:600}nav.side [aria-current=page] .badge{border-color:transparent}
nav.side svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
nav.side .home{font-weight:600;margin-bottom:6px}nav.side .tools{display:grid;gap:2px;margin-top:auto;padding-top:8px}
nav.side .tools .item{color:var(--muted)}nav.side .tools .item:hover{color:var(--text)}
.collapsed nav.side{width:57px}.collapsed nav.side .label{display:none}.collapsed .toggle svg{transform:rotate(180deg)}
.frame iframe{display:block;width:100%;height:100%;border:0}
@media(max-width:700px){.shell{grid-template-columns:1fr;grid-template-rows:auto 1fr}
nav.side,.collapsed nav.side{width:auto;flex-direction:row;align-items:center;padding:6px 8px;border-right:0;border-bottom:1px solid var(--line);overflow:auto hidden}
nav.side .item{width:auto}nav.side .home{margin:0}nav.side .label{display:none}nav.side .app .ico,nav.side .toggle{display:none}
nav.side .app .label,.collapsed nav.side .app .label{display:inline;padding:0 4px}nav.side .tools{display:flex;margin:0 0 0 auto;padding:0}main{padding-top:24px}}
</style></head><body>${body}</body></html>`;

const page = (title, body) => doc(title, `<main>${body}</main>`);

const readApps = () => JSON.parse(fs.readFileSync(path.join(root, "apps.json"), "utf8"));
const appUrl = (a) => `https://${a.subdomain}.${DOMAIN}`;
const current = (on) => (on ? ' aria-current="page"' : "");

const ICONS = {
  home: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  logout: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 8l-4 4 4 4M6 12h10"/>',
  collapse: '<path d="M18 6l-6 6 6 6M11 6l-6 6 6 6"/>',
};
const icon = (name) => `<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg></span>`;
// The label hides when the sidebar is collapsed, so title gives the item its name there.
const inner = (ico, text) => ` title="${esc(text)}">${ico}<span class="label">${esc(text)}</span>`;
const item = (cls, attrs, ico, text) => `<a class="item ${cls}" ${attrs}${inner(ico, text)}</a>`;

// Toggling only resizes the grid, so the app in the frame keeps its state.
const TOGGLE_SCRIPT = `<script>document.querySelector(".toggle").addEventListener("click",(e)=>{
const c=document.querySelector(".shell").classList.toggle("collapsed"),b=e.currentTarget;
b.setAttribute("aria-expanded",String(!c));b.title=c?"Expand":"Collapse";
document.cookie="${SIDEBAR_COOKIE}="+(c?"collapsed":"open")+"; Path=/; Max-Age=${YEAR}; SameSite=Lax; Secure";});</script>`;

// Hub pages with the app sidebar. Sidebar links open the app in a frame at /<subdomain>.
function shell(title, apps, active, collapsed, content) {
  const links = apps.map((a) => item("app", `href="/${esc(a.subdomain)}"${current(a === active)}`, `<span class="ico badge">${esc(a.name[0])}</span>`, a.name));
  const open = active ? item("", `href="${esc(appUrl(active))}" target="_blank" rel="noopener"`, icon("open"), "Open separately") : "";
  return doc(title, `<div class="shell${collapsed ? " collapsed" : ""}"><nav class="side">${item("home", `href="/"${current(!active)}`, icon("home"), "Apps")}${links.join("")}
<div class="tools">${open}<form method="post" action="/logout"><button class="item"${inner(icon("logout"), "Log out")}</button></form>
<button type="button" class="item toggle" aria-expanded="${!collapsed}" title="${collapsed ? "Expand" : "Collapse"}">${icon("collapse")}<span class="label">Collapse</span></button></div></nav>
${content}</div>${TOGGLE_SCRIPT}`);
}

function loginPage(next, error) {
  return page("Log in", `<form class="login" method="post" action="/login"><h1>Apps</h1><p class="error">${esc(error ?? "")}</p>
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="password" placeholder="Password" aria-label="Password" autocomplete="current-password" autofocus required>
<button>Log in</button></form>`);
}

function listPage(apps, collapsed) {
  const items = apps.map((a) => `<li><a class="card" href="${esc(appUrl(a))}"><b>${esc(a.name)}</b><span>${esc(a.description ?? "")}</span></a></li>`);
  return shell("Apps", apps, null, collapsed, `<div class="pane"><main><header><h1>Apps</h1></header><ul>${items.join("")}</ul></main></div>`);
}

function framePage(apps, app, collapsed) {
  return shell(app.name, apps, app, collapsed, `<div class="pane frame">
<iframe src="${esc(appUrl(app))}" title="${esc(app.name)}" allow="clipboard-write; fullscreen; screen-wake-lock"></iframe></div>`);
}

const isCollapsed = (req) => readCookie(req, SIDEBAR_COOKIE) === "collapsed";

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}
const redirect = (res, to, headers = {}) => send(res, 303, "", { location: to, ...headers });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => resolve(new URLSearchParams(body)));
    req.on("error", reject);
  });
}

// Counted globally rather than per IP: there is one user, and existing sessions keep working during a lockout.
let failures = [];

async function handle(req, res) {
  const url = new URL(req.url, HUB_URL);

  // Caddy asks this before forwarding any app request. Any non-2xx answer goes straight back to the browser.
  if (url.pathname === "/auth") {
    if (isLoggedIn(req)) return send(res, 204, "");
    const uri = req.headers["x-forwarded-uri"] ?? "/";
    if (uri.startsWith("/api") || req.headers["x-forwarded-method"] !== "GET") return send(res, 401, "Log in required");
    const next = `https://${req.headers["x-forwarded-host"]}${uri}`;
    return redirect(res, `${HUB_URL}/login?next=${encodeURIComponent(next)}`);
  }

  if (url.pathname === "/health") return send(res, 200, "ok");

  if (url.pathname === "/login" && req.method === "POST") {
    const form = await readBody(req);
    const next = safeNext(form.get("next"));
    failures = failures.filter((t) => Date.now() - t < FAILURE_WINDOW_MS);
    if (failures.length >= MAX_FAILURES) return send(res, 429, loginPage(next, "Too many attempts. Try again in a few minutes."));
    const s = secrets();
    if (!s) return send(res, 503, loginPage(next, "No password is set yet."));
    if (!passwordMatches(form.get("password") ?? "", s.PASSWORD_HASH)) {
      failures.push(Date.now());
      return send(res, 401, loginPage(next, "Wrong password."));
    }
    return redirect(res, next, { "set-cookie": sessionCookie(s) });
  }

  if (url.pathname === "/login") {
    const next = safeNext(url.searchParams.get("next"));
    return isLoggedIn(req) ? redirect(res, next) : send(res, 200, loginPage(next));
  }

  if (url.pathname === "/logout" && req.method === "POST") {
    return redirect(res, "/login", { "set-cookie": `${COOKIE}=; Domain=.${DOMAIN}; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax` });
  }

  if (url.pathname === "/" && req.method === "GET") {
    if (!isLoggedIn(req)) return redirect(res, "/login");
    return send(res, 200, listPage(readApps(), isCollapsed(req)), { "set-cookie": sessionCookie(secrets()) }); // opening the hub renews the session
  }

  // /<subdomain>: the app in a frame, next to the sidebar. Also renews the session.
  if (req.method === "GET") {
    const apps = readApps();
    const app = apps.find((a) => url.pathname === `/${a.subdomain}`);
    if (app) {
      if (!isLoggedIn(req)) return redirect(res, `/login?next=${encodeURIComponent(HUB_URL + url.pathname)}`);
      return send(res, 200, framePage(apps, app, isCollapsed(req)), { "set-cookie": sessionCookie(secrets()) });
    }
  }

  send(res, 404, page("Not found", "<h1>Not found</h1>"));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, "Something went wrong");
    else res.end();
  });
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "0.0.0.0", () => console.log("hub listening"));
