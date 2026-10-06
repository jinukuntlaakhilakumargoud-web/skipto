import { chunks, combine, request, windows } from "./core.js";

const DEFAULTS = { baseURL: "https://api.typesafe.ai", model: "jev-latest" };

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "ask") {
    ask(msg).then(reply, (e) => reply({ error: e.message }));
    return true; // reply asynchronously
  }
  if (msg.type === "settings") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function ask({ question, events }) {
  const { key, baseURL, model } = { ...DEFAULTS, ...(await chrome.storage.local.get(["key", "baseURL", "model"])) };
  if (!key) throw new Error("NO_KEY");
  const parts = chunks(windows(events));
  const started = performance.now();
  const responses = await Promise.all(parts.map((p) => call(baseURL, key, request(p, question, model))));
  return { ...combine(parts, responses), ms: Math.round(performance.now() - started) };
}

// Retries rate limits and overloads with exponential backoff, like the official SDKs.
async function call(baseURL, key, body, attempt = 0) {
  const res = await fetch(`${baseURL.replace(/\/+$/, "")}/v1/systemone`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return call(baseURL, key, body, attempt + 1);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(res.status === 401 ? "Your API key was rejected. Check it in Skipto's settings." : `API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}
