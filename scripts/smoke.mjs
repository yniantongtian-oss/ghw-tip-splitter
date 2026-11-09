import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = "/tmp/tip-splitter-chrome-profile";
const port = 9333;
const pageUrl = `file://${root}/index.html`;
const shots = resolve(root, "screenshots");

const pageErrors = [];
let chrome;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
  console.log(`ok  ${label}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else done(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "exception");
      }
      if (message.method === "Log.entryAdded" && message.params.entry?.level === "error") {
        pageErrors.push(message.params.entry.text);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        pageErrors.push(message.params.args.map((arg) => arg.value || arg.description || "").join(" "));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(payload);
    });
  }
}

async function connect() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (version.ok) break;
    } catch {
      // Chrome is still booting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!created.ok) {
    throw new Error(`Could not open a tab (${created.status})`);
  }
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    ws.addEventListener("open", resolvePromise, { once: true });
    ws.addEventListener("error", () => reject(new Error("DevTools socket failed")), { once: true });
  });
  return new Cdp(ws);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForReady(cdp) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const ready = await evaluate(cdp, `document.documentElement.dataset.ready === "true"`);
      if (ready) return;
    } catch {
      // The page may still be navigating.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const text = await evaluate(cdp, `document.body ? document.body.innerText : "no body"`).catch((error) => String(error));
  throw new Error(`App did not start.\n${text}\n${pageErrors.join("\n")}`);
}

async function openPage(cdp) {
  pageErrors.length = 0;
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1040,
    height: 860,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url: pageUrl });
  await waitForReady(cdp);
}

async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const path = resolve(shots, name);
  await writeFile(path, Buffer.from(data, "base64"));
  console.log(`saved ${path}`);
}

async function setValue(cdp, selector, value) {
  await evaluate(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`,
  );
}

async function text(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).textContent`);
}

async function main() {
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });
  await mkdir(shots, { recursive: true });

  chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let chromeLog = "";
  chrome.stderr.on("data", (chunk) => {
    chromeLog += chunk;
  });
  chrome.on("exit", (code) => {
    if (code && pageErrors) chromeLog += `\nchrome exit ${code}`;
  });

  const cdp = await connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await openPage(cdp);

  assertEqual(await text(cdp, "#per-person"), "$33.98–$33.99", "default per person");
  assertEqual(await text(cdp, "#tip-amount"), "$15.55", "default tip");
  assertEqual(await text(cdp, "#total-amount"), "$101.95", "default total");
  assertEqual(await text(cdp, "#share-note"), "1 person pays $33.99, 2 people pay $33.98", "default share note");
  assertEqual(await evaluate(cdp, `document.documentElement.getAttribute("data-theme")`), "light", "starts in light mode");
  await shot(cdp, "running.png");

  await setValue(cdp, "#bill", "-5");
  assertEqual(await text(cdp, "#bill-error"), "Bill amount can't be negative.", "negative bill error");
  assertEqual(await text(cdp, "#per-person"), "—", "invalid bill clears the result");
  assertEqual(
    await evaluate(cdp, `document.querySelector("#per-person").classList.contains("is-empty")`),
    true,
    "empty amount is not drawn as a giant total",
  );

  await setValue(cdp, "#bill", "86.40");
  await setValue(cdp, "#people", "0");
  assertEqual(await text(cdp, "#people-error"), "Enter a whole number of people, at least 1.", "zero people");
  await setValue(cdp, "#people", "-2");
  assertEqual(await text(cdp, "#people-error"), "Number of people can't be negative.", "negative people");
  await setValue(cdp, "#people", "1.5");
  assertEqual(await text(cdp, "#people-error"), "Enter a whole number of people, at least 1.", "fractional people");
  await setValue(cdp, "#people", "3");
  assertEqual(await text(cdp, "#people-error"), "", "people error clears");

  await evaluate(cdp, `document.querySelector('#presets button[data-tip="20"]').click()`);
  assertEqual(await text(cdp, "#per-person"), "$34.56", "20% preset is an even split");
  assertEqual(await text(cdp, "#tip-amount"), "$17.28", "20% tip");
  assertEqual(await text(cdp, "#total-amount"), "$103.68", "20% total");

  await setValue(cdp, "#custom-tip", "12.5");
  assertEqual(await text(cdp, "#per-person"), "$32.40", "custom 12.5%");
  assertEqual(
    await evaluate(cdp, `document.querySelector('#presets button[aria-pressed="true"]')`),
    null,
    "custom percent clears the presets",
  );

  await evaluate(cdp, `document.querySelector('#presets button[data-tip="15"]').click()`);
  assertEqual(await evaluate(cdp, `document.querySelector("#custom-tip").value`), "", "preset clears custom tip");
  assertEqual(await text(cdp, "#tip-amount"), "$12.96", "15% preset replaces the custom tip");
  assertEqual(
    await evaluate(cdp, `document.querySelector('#presets button[data-tip="15"]').getAttribute("aria-pressed")`),
    "true",
    "clicked preset is selected",
  );

  await setValue(cdp, "#custom-tip", "");
  await evaluate(cdp, `document.querySelector("#round").click()`);
  assertEqual(await text(cdp, "#per-person"), "$33.00–$34.00", "rounding $86.40 at 15% across 3");
  assertEqual(
    await text(cdp, "#share-note"),
    "1 person pays $34.00, 2 people pay $33.00",
    "rounding raises only the shares needed to cover the bill",
  );
  assertEqual(await text(cdp, "#total-amount"), "$100.00", "rounded total covers the bill");

  await setValue(cdp, "#bill", "100");
  await setValue(cdp, "#custom-tip", "0");
  assertEqual(await text(cdp, "#per-person"), "$33.00–$34.00", "nearest dollars still cover a $100 bill");
  assertEqual(await text(cdp, "#total-amount"), "$100.00", "rounded $100 total");

  await evaluate(cdp, `document.querySelector("#people-dec").click()`);
  await evaluate(cdp, `document.querySelector("#people-dec").click()`);
  await evaluate(cdp, `document.querySelector("#people-dec").click()`);
  assertEqual(await evaluate(cdp, `document.querySelector("#people").value`), "1", "stepper stops at one person");
  assertEqual(await evaluate(cdp, `document.querySelector("#people-dec").disabled`), true, "minus is disabled at one");

  const urlBefore = await evaluate(cdp, `location.href`);
  await evaluate(cdp, `document.querySelector("#split-form").requestSubmit()`);
  assertEqual(await evaluate(cdp, `location.href`), urlBefore, "Enter does not reload the page");

  await evaluate(cdp, `document.querySelector('#lang-toggle button[data-lang="zh"]').click()`);
  assertEqual(await text(cdp, "h1"), "小费分摊", "Chinese title");
  assertEqual(await text(cdp, "#per-person-label"), "每人", "Chinese per-person label");
  assertEqual(await evaluate(cdp, `document.documentElement.lang`), "zh-CN", "html lang");
  assertEqual(await evaluate(cdp, `localStorage.getItem("tip-splitter-lang")`), "zh", "language is stored");

  await evaluate(cdp, `document.querySelector("#theme-toggle").click()`);
  assertEqual(await evaluate(cdp, `document.documentElement.getAttribute("data-theme")`), "dark", "dark mode turns on");
  assertEqual(await evaluate(cdp, `localStorage.getItem("tip-splitter-theme")`), "dark", "dark mode is stored");
  assertEqual(
    await evaluate(cdp, `document.querySelector("#theme-toggle").getAttribute("aria-label")`),
    "切换到浅色模式",
    "theme label follows the language",
  );

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForReady(cdp);
  assertEqual(await evaluate(cdp, `document.documentElement.getAttribute("data-theme")`), "dark", "dark mode survives reload");
  assertEqual(await text(cdp, "h1"), "小费分摊", "language survives reload");

  await setValue(cdp, "#bill", "86.40");
  await setValue(cdp, "#people", "3");
  await setValue(cdp, "#custom-tip", "");
  await evaluate(cdp, `document.querySelector('#presets button[data-tip="18"]').click()`);
  if (await evaluate(cdp, `document.querySelector("#round").checked`)) {
    await evaluate(cdp, `document.querySelector("#round").click()`);
  }
  await evaluate(cdp, `document.querySelector('#lang-toggle button[data-lang="en"]').click()`);
  assertEqual(await text(cdp, "#per-person"), "$33.98–$33.99", "restored default split in dark mode");
  await shot(cdp, "dark.png");

  if (pageErrors.length) {
    throw new Error(`Console errors:\n${pageErrors.join("\n")}`);
  }
  console.log("smoke passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill("SIGKILL");
}
