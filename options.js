const fields = ["key", "baseURL", "model"];

chrome.storage.local.get(fields).then((saved) => {
  for (const f of fields) document.getElementById(f).value = saved[f] || "";
});

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(fields.map((f) => [f, document.getElementById(f).value.trim()]));
  await chrome.storage.local.remove(fields.filter((f) => !values[f])); // empty means "use the default"
  await chrome.storage.local.set(Object.fromEntries(Object.entries(values).filter(([, v]) => v)));
  document.getElementById("saved").textContent = "Saved. Ask away on any YouTube video.";
});
