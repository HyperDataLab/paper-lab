import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from syntax import MAX_BYTES, SERVICE_VERSION, describe, doc_tokens, validate_request

MODEL = "en_core_web_sm"
_nlp = None
_lock = threading.Lock()


def pipeline():
    """Loads the model once, on first use. The model is installed into the image at build time; nothing downloads."""
    global _nlp
    with _lock:
        if _nlp is None:
            import spacy

            _nlp = spacy.load(MODEL, exclude=["ner"])
        return _nlp


def parse(sentences):
    import spacy

    nlp = pipeline()
    with _lock:
        docs = list(nlp.pipe([item["text"] for item in sentences], batch_size=64))
    results = []
    for item, doc in zip(sentences, docs):
        tokens = doc_tokens(doc)
        results.append({"key": item["key"], "tokens": tokens, **describe(tokens)})
    return {
        "model": MODEL,
        "modelVersion": nlp.meta.get("version"),
        "spacyVersion": spacy.__version__,
        "version": SERVICE_VERSION,
        "sentences": results,
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/nlp/parse":
            return self.send_json(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length", "0"))
        try:
            if size > 0 and size <= MAX_BYTES:
                payload = json.loads(self.rfile.read(size))
            else:
                payload = None
            sentences = validate_request(payload, size)
        except ValueError as error:
            status = 413 if str(error) == "payload too large" else 400
            return self.send_json(status, {"error": str(error)})
        try:
            self.send_json(200, parse(sentences))
        except Exception as error:  # noqa: BLE001 - report, never crash the server
            print(f"parse error: {error}", flush=True)
            self.send_json(500, {"error": "parse failed"})

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"ok": True, "version": SERVICE_VERSION})
        self.send_json(404, {"error": "not found"})


if __name__ == "__main__":
    threading.Thread(target=pipeline, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
