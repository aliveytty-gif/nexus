---
title: NEXUS Qwen
sdk: gradio
sdk_version: 6.32.0
python_version: "3.12.12"
app_file: app.py
suggested_hardware: zero-a10g
---

# NEXUS Qwen

Deploy these files at the root of a **private** Hugging Face Gradio Space on ZeroGPU. Use one Space replica. Keep the Hugging Face token on the NEXUS server and send it as a Bearer token on each Space request. The Space uses Hugging Face's private access check for its API and stop route.

## HTTP contract

- `POST /gradio_api/call/chat` takes `{"data":[requestId,messagesJson,maxTokens]}`. The request ID is a lowercase hyphenated UUID unique to each attempt. `messagesJson` is a serialized list of up to 32 `{"role":"user","content":"…"}` messages. Roles are `system`, `user`, and `assistant`. The system message belongs first and the final message belongs to the user. The model accepts up to 1,024 input tokens including template tokens and 1–128 output tokens.
- `GET /gradio_api/call/chat/{event_id}` opens the stream for the returned event ID. Chunks are cumulative `[text,"streaming"]` frames. The `complete` event carries `[text,"done"]` or `[text,"stopped"]`. The `heartbeat` event carries no model output. An SSE `error` can contain the machine-readable `NEXUS_CONTEXT_LIMIT` code.
- `POST /stop/{requestId}` runs independently of the generation queue. A pre-start stop records cancellation before allocation. An active stop signals Qwen between generation steps and waits up to three seconds. `{"stopped":true}` confirms pre-start or cooperative cancellation. `{"stopped":false}` means cancellation remains unconfirmed or generation already finished. The caller can retry the stop request or use the stream's terminal status. Use a fresh request ID for a new generation.
- `/gradio_api/call/smoke` keeps the fixed CUDA smoke test available via the same two-step Gradio API. Submit it with `{"data":[]}`. It shares the single GPU generation slot.

The queue accepts up to five waiting requests. The Space requests 30 seconds of ZeroGPU time for each generation. Its cancellation records expire after fifteen minutes and contain operation IDs and status. Validate streaming, a queued stop, and a stop during generation on the deployed Space before using it with NEXUS.
