# Skipto

Ask any YouTube video a question. Skipto jumps to the moment that answers it.

Skipto is a Chrome extension powered by [Jev](https://typesafe.ai), a decision model from TypeSafe AI.
Jev never writes text: it answers typed questions with calibrated probabilities. That makes it a good
fit for "which part of this video answers my question?", where an answer can only ever be a moment
that exists.

## How it works

1. **Read.** Skipto opens YouTube's own transcript for the video. Videos without a transcript aren't supported.
2. **Cut.** The transcript is grouped into windows of about 30 seconds, each tagged with an id (`W000`, `W001`, …).
3. **Decide.** One request asks Jev two questions about the tagged transcript:
   - a **Choice** over the window ids: which line answers the question?
   - a **Noul** (yes/no probability): does any line answer it at all?

   Choice probabilities always add up to 1, so some window always "wins". The Noul is what lets
   Skipto say "this video doesn't cover that" instead of pointing at the least-bad moment.
4. **Jump.** The probabilities light up the progress bar, the top three moments are listed, and when
   the answer is confident the video jumps there.

Long videos are split into several requests, because a Choice takes at most 255 options and each
request has a context budget. A strong answer in one part of the video outranks the best guess in another.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose this folder.
3. Click the Skipto icon and paste a TypeSafe API key (create one at [console.typesafe.ai](https://console.typesafe.ai)).
4. Open any YouTube video that has a transcript and ask away.

Your key stays in the browser's extension storage and is sent only to the API address in Skipto's
settings. Any server that speaks the same `/v1/systemone` API works, including a local open model:
set its address and model name in the settings.

## Cost

Jev charges for input tokens only. A one-hour transcript is roughly 13,000 tokens, so a question
costs about a twentieth of a cent at the listed price. The exact token count is shown under every answer.

## Develop

```bash
npm test
```

The core logic (windows, chunks, request shape, ranking) lives in `src/core.js` and is tested with
Node's built-in test runner. No dependencies, no build step.

## License

MIT
