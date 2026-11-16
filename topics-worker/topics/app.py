import json
import multiprocessing
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from jsonschema import Draft202012Validator
from job_helpers import execute_job

jobs = {}
lock = threading.Lock()
schema = json.loads(Path(__file__).with_name("schema.json").read_text(encoding="utf-8"))


def execute(job, payload):
    def run_pipeline(payload, progress):
        from pipeline import run
        return run(payload, progress)
    execute_job(job, payload, run_pipeline, lambda result: Draft202012Validator(schema).validate(result))


def watch(job, process):
    process.join()
    if job["state"] not in ("done", "failed"):
        job.update(state="failed", progress="Failed", error=f"Process exited unexpectedly (exit code {process.exitcode})")
        print(job["error"], flush=True)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/jobs":
            return self.send_json(404, {"error": "not found"})
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            if not isinstance(payload["corpora"], list) or not isinstance(payload["members"], list):
                raise ValueError("invalid payload")
        except (ValueError, KeyError, TypeError):
            return self.send_json(400, {"error": "invalid payload"})
        with lock:
            if any(job["state"] in ("queued", "running") for job in jobs.values()):
                return self.send_json(409, {"error": "busy"})
            job_id = str(uuid.uuid4())
            jobs[job_id] = manager.dict(state="queued", progress="Queued")
            process = multiprocessing.get_context("spawn").Process(target=execute, args=(jobs[job_id], payload))
            process.start()
            threading.Thread(target=watch, args=(jobs[job_id], process), daemon=True).start()
        self.send_json(202, {"jobId": job_id})

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"ok": True})
        parts = self.path.strip("/").split("/")
        if len(parts) not in (2, 3) or parts[0] != "jobs" or parts[1] not in jobs:
            return self.send_json(404, {"error": "not found"})
        job = jobs[parts[1]]
        if len(parts) == 3:
            if parts[2] != "result" or job["state"] != "done":
                return self.send_json(404, {"error": "result unavailable"})
            return self.send_json(200, job["result"])
        self.send_json(200, {k: v for k, v in job.items() if k != "result"})


if __name__ == "__main__":
    manager = multiprocessing.get_context("spawn").Manager()
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
