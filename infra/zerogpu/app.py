"""Private Space serving the NEXUS Qwen provider."""

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path
from queue import SimpleQueue
from tempfile import mkdtemp
from threading import Event, Lock, Thread
from time import monotonic, perf_counter

import spaces
import gradio as gr
import torch
from fastapi import HTTPException
from gradio.routes import App
from transformers import AutoModelForCausalLM, AutoTokenizer, StoppingCriteria, TextStreamer

MODEL = "Qwen/Qwen3.5-2B"
REVISION = "15852e8c16360a2fea060d615a32b45270f8a8fc"
GPU_SECONDS = 30
MAX_INPUT_TOKENS = 1024
MAX_OUTPUT_TOKENS = 128
MAX_MESSAGES = 32
MAX_MESSAGE_JSON_BYTES = 16384
STOP_WAIT_SECONDS = 3
RECORD_TTL_SECONDS = 900
MAX_RECORDS = 1024
REQUEST_ID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
)
SMOKE_QUESTION = "Ответь по-русски одним предложением: чему равно 12 × 7 и как это вычислить?"

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, trust_remote_code=False)
model = AutoModelForCausalLM.from_pretrained(
    MODEL,
    revision=REVISION,
    dtype=torch.bfloat16,
    use_safetensors=True,
    trust_remote_code=False,
).eval().to("cuda")

# The web process and the forked ZeroGPU worker observe the same marker file.
stop_directory = Path(mkdtemp(prefix="nexus-stop-"))
operations_lock = Lock()


@dataclass
class Operation:
    finished: Event = field(default_factory=Event)
    stopped: bool = False


active_operations: dict[str, Operation] = {}
completed_operations: dict[str, tuple[bool, float]] = {}
stop_markers: dict[str, float] = {}


def prune_records():
    now = monotonic()
    for request_id, expiry in tuple(stop_markers.items()):
        if expiry <= now and request_id not in active_operations:
            (stop_directory / request_id).unlink(missing_ok=True)
            del stop_markers[request_id]

    for request_id, (_, expiry) in tuple(completed_operations.items()):
        if expiry <= now or len(completed_operations) > MAX_RECORDS:
            del completed_operations[request_id]


def set_stop_marker(request_id):
    (stop_directory / request_id).touch(mode=0o600)
    stop_markers[request_id] = monotonic() + RECORD_TTL_SECONDS


def encode_messages(messages_json):
    try:
        if not isinstance(messages_json, str):
            raise ValueError
        if len(messages_json.encode("utf-8")) > MAX_MESSAGE_JSON_BYTES:
            raise gr.Error("NEXUS_CONTEXT_LIMIT", print_exception=False)
        messages = json.loads(messages_json)
        if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
            raise ValueError

        for index, message in enumerate(messages):
            if not isinstance(message, dict) or set(message) != {"role", "content"}:
                raise ValueError
            allowed_roles = ("system", "user", "assistant") if index == 0 else ("user", "assistant")
            if message["role"] not in allowed_roles:
                raise ValueError
            if not isinstance(message["content"], str) or not message["content"].strip():
                raise ValueError
        if messages[-1]["role"] != "user":
            raise ValueError
    except (ValueError, RecursionError):
        raise gr.Error("NEXUS_INVALID_REQUEST", print_exception=False) from None

    encoded = tokenizer.apply_chat_template(
        messages,
        enable_thinking=False,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
    )
    if len(encoded["input_ids"]) > MAX_INPUT_TOKENS:
        raise gr.Error("NEXUS_CONTEXT_LIMIT", print_exception=False)
    return encoded["input_ids"]


class StopCriterion(StoppingCriteria):
    def __init__(self, marker):
        self.marker = marker
        self.stream_closed = Event()
        self.stopped = False

    def should_stop(self):
        self.stopped = self.stopped or self.stream_closed.is_set() or self.marker.exists()
        return self.stopped

    def __call__(self, input_ids, scores, **kwargs):
        return self.should_stop()


class ChunkStreamer(TextStreamer):
    def __init__(self, chunks):
        super().__init__(tokenizer, skip_prompt=True, skip_special_tokens=True)
        self.chunks = chunks

    def on_finalized_text(self, text, stream_end=False):
        if text:
            self.chunks.put(text)


@spaces.GPU(duration=GPU_SECONDS)
def generate(input_ids, max_tokens, marker_path):
    control = StopCriterion(Path(marker_path))
    if control.should_stop():
        yield "", "stopped"
        return

    chunks = SimpleQueue()
    streamer = ChunkStreamer(chunks)

    def run():
        try:
            if control.should_stop():
                return
            with torch.inference_mode():
                ids = torch.tensor([input_ids], device="cuda")
                model.generate(
                    input_ids=ids,
                    attention_mask=torch.ones_like(ids),
                    max_new_tokens=max_tokens,
                    do_sample=False,
                    streamer=streamer,
                    stopping_criteria=[control],
                )
                torch.cuda.synchronize()
        except Exception as error:
            chunks.put(error)
        finally:
            chunks.put(None)

    worker = Thread(target=run, name="qwen-generate")
    worker.start()
    text = ""
    try:
        for chunk in iter(chunks.get, None):
            if isinstance(chunk, Exception):
                raise gr.Error("NEXUS_GENERATION_FAILED", print_exception=False) from None
            text += chunk
            yield text, "streaming"
    finally:
        control.stream_closed.set()
        worker.join()

    yield text, "stopped" if control.stopped else "done"


def chat(request_id, messages_json, max_tokens):
    if not isinstance(request_id, str) or REQUEST_ID.fullmatch(request_id) is None:
        raise gr.Error("NEXUS_INVALID_REQUEST", print_exception=False)
    if type(max_tokens) is not int or not 1 <= max_tokens <= MAX_OUTPUT_TOKENS:
        raise gr.Error("NEXUS_INVALID_REQUEST", print_exception=False)

    marker = stop_directory / request_id
    with operations_lock:
        prune_records()
        if request_id in active_operations or request_id in completed_operations:
            raise gr.Error("NEXUS_DUPLICATE_REQUEST", print_exception=False)
        operation = Operation()
        active_operations[request_id] = operation

    result = None
    stream = None
    try:
        if marker.exists():
            result = "", "stopped"
        else:
            input_ids = encode_messages(messages_json)
            if marker.exists():
                result = "", "stopped"
            else:
                stream = generate(input_ids, max_tokens, str(marker))
                for text, status in stream:
                    if status == "streaming":
                        yield text, status
                    else:
                        result = text, status
    finally:
        try:
            if stream is not None and result is None:
                with operations_lock:
                    set_stop_marker(request_id)
                stream.close()
        finally:
            with operations_lock:
                operation.stopped = result is not None and result[1] == "stopped"
                completed_operations[request_id] = (
                    operation.stopped,
                    monotonic() + RECORD_TTL_SECONDS,
                )
                del active_operations[request_id]
                operation.finished.set()

    if result is None:
        raise gr.Error("NEXUS_GENERATION_FAILED", print_exception=False)
    yield result


server = App()


@server.post("/stop/{request_id}")
async def stop(request_id: str):
    if REQUEST_ID.fullmatch(request_id) is None:
        raise HTTPException(status_code=400, detail="Invalid request ID")

    with operations_lock:
        prune_records()
        completed = completed_operations.get(request_id)
        if completed is not None:
            return {"stopped": completed[0]}
        operation = active_operations.get(request_id)
        if operation is None and request_id not in stop_markers and len(stop_markers) >= MAX_RECORDS:
            raise HTTPException(status_code=503, detail="Cancellation capacity reached")
        set_stop_marker(request_id)

    # An operation still in the Gradio queue will see the marker before requesting CUDA.
    if operation is None:
        return {"stopped": True}

    deadline = monotonic() + STOP_WAIT_SECONDS
    while not operation.finished.is_set() and monotonic() < deadline:
        await asyncio.sleep(0.05)
    return {"stopped": operation.finished.is_set() and operation.stopped}


@spaces.GPU(duration=GPU_SECONDS)
def smoke():
    inputs = tokenizer.apply_chat_template(
        [{"role": "user", "content": SMOKE_QUESTION}],
        enable_thinking=False,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    ).to("cuda")
    torch.cuda.synchronize()
    started = perf_counter()
    with torch.inference_mode():
        tokens = model.generate(**inputs, max_new_tokens=64, do_sample=False)
    torch.cuda.synchronize()
    seconds = perf_counter() - started
    if not tokens.is_cuda or model.device.type != "cuda":
        raise gr.Error("NEXUS_CUDA_UNAVAILABLE", print_exception=False)
    generated = tokens[0, inputs.input_ids.shape[1]:].cpu()
    return tokenizer.decode(generated, skip_special_tokens=True).strip(), {
        "model": MODEL,
        "revision": REVISION,
        "device": torch.cuda.get_device_name(0),
        "generation_seconds": round(seconds, 2),
        "output_tokens": int(generated.numel()),
        "runtime": {
            package: version(package) for package in ("torch", "transformers", "spaces", "gradio")
        },
    }


with gr.Blocks(analytics_enabled=False) as demo:
    gr.Markdown("## NEXUS · Qwen3.5‑2B")
    smoke_button = gr.Button("Проверить GPU")
    smoke_text = gr.Textbox(label="Ответ модели", interactive=False)
    smoke_metrics = gr.JSON(label="Измерения")
    smoke_button.click(
        smoke, outputs=[smoke_text, smoke_metrics],
        api_name="smoke", concurrency_id="gpu", concurrency_limit=1,
    )

    request_id = gr.Textbox(visible=False)
    messages_json = gr.Textbox(visible=False)
    max_tokens = gr.Number(visible=False)
    chat_text = gr.Textbox(visible=False)
    chat_status = gr.Textbox(visible=False)
    gr.Button(visible=False).click(
        chat, inputs=[request_id, messages_json, max_tokens],
        outputs=[chat_text, chat_status], api_name="chat",
        preprocess=False, concurrency_id="gpu", concurrency_limit=1,
    )

if __name__ == "__main__":
    demo.queue(max_size=5, api_open=False).launch(
        _app=server,
        blocked_paths=[str(stop_directory)],
        enable_monitoring=False,
        run_history=False,
        show_error=False,
        ssr_mode=False,
    )
