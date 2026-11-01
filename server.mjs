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

function readCookie(req) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === COOKIE) return v;
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

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{color-scheme:light dark;--bg:#f4f4f2;--card:#fff;--text:#1b1c1e;--muted:#6b6e73;--line:#dcdcd8;--accent:#1b1c1e;--on:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#141517;--card:#1e2023;--text:#eceded;--muted:#9a9da3;--line:#2e3136;--accent:#eceded;--on:#141517}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
h1{font-size:20px;margin:0}ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
a.app{display:block;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:10px;color:inherit;text-decoration:none}
a.app:hover,a.app:focus-visible{border-color:var(--text)}a.app b{display:block}a.app span{color:var(--muted);font-size:14px}
input,button{font:inherit;padding:10px 14px;border-radius:8px}input{width:100%;margin-bottom:8px;background:var(--card);color:inherit;border:1px solid var(--line)}
button{background:var(--accent);color:var(--on);border:0;cursor:pointer;width:100%}button.quiet{background:none;color:var(--muted);width:auto;padding:0}
.error{color:#c2362b}form.login{max-width:320px;margin:15vh auto 0}
</style></head><body><main>${body}</main></body></html>`;

function loginPage(next, error) {
  return page("Log in", `<form class="login" method="post" action="/login"><h1>Apps</h1><p class="error">${esc(error ?? "")}</p>
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="password" placeholder="Password" aria-label="Password" autocomplete="current-password" autofocus required>
<button>Log in</button></form>`);
}

function listPage() {
  const apps = JSON.parse(fs.readFileSync(path.join(root, "apps.json"), "utf8"));
  const items = apps.map((a) => `<li><a class="app" href="https://${esc(a.subdomain)}.${DOMAIN}"><b>${esc(a.name)}</b><span>${esc(a.description ?? "")}</span></a></li>`);
  return page("Apps", `<header><h1>Apps</h1><form method="post" action="/logout"><button class="quiet">Log out</button></form></header><ul>${items.join("")}</ul>`);
}

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
    return send(res, 200, listPage(), { "set-cookie": sessionCookie(secrets()) }); // opening the hub renews the session
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
