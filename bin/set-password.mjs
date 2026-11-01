// Prompts for the shared password and writes its hash plus a new session secret to .env.
// A new secret also logs out every existing session.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function ask(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let text = "";
    const onData = (buf) => {
      for (const c of buf.toString()) {
        if (c === "\u0003") process.exit(130);
        if (c === "\r" || c === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(text);
        }
        text = c === "\u007f" ? text.slice(0, -1) : text + c;
      }
    };
    process.stdin.on("data", onData);
  });
}

const password = await ask("New password: ");
if (password.length < 12) {
  console.error("Use at least 12 characters: this login is on the public internet.");
  process.exit(1);
}
if ((await ask("Repeat it: ")) !== password) {
  console.error("Those didn't match. Nothing changed.");
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
const env = `PASSWORD_HASH=${salt.toString("base64url")}:${hash}\nSESSION_SECRET=${crypto.randomBytes(32).toString("base64url")}\n`;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
fs.writeFileSync(file, env, { mode: 0o600 });
console.log("Password saved. It works right away, no restart needed.");
