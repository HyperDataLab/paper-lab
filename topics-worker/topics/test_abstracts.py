import io
import json
import urllib.error
import urllib.parse

from abstracts import clean_jats, crossref_abstract, fetch_json, fetch_texts, semantic_abstracts, source_counts


def response(value):
    return io.BytesIO(json.dumps(value).encode())


def test_jats_and_crossref_parsing():
    text = "<jats:p>Abstract: A &amp; B <jats:italic>result</jats:italic>.</jats:p>"
    assert clean_jats(text) == "A & B result."
    assert crossref_abstract({"message": {"abstract": text}}) == "A & B result."
    assert crossref_abstract({"message": {}}) == ""


def test_semantic_batch_preserves_nulls_and_order():
    assert semantic_abstracts([{"abstract": "first"}, None, {"abstract": "third"}], 3) == [
        "first", None, "third"]
    assert semantic_abstracts([None], 2) == [None, None]


def test_backoff_honours_retry_after_and_limits_attempts():
    waits = []
    calls = []

    def fetch(request, timeout):
        calls.append(timeout)
        if len(calls) < 4:
            headers = {"Retry-After": "3"} if len(calls) == 1 else {}
            raise urllib.error.HTTPError("url", 429, "limited", headers, None)
        return response({"ok": True})

    assert fetch_json("request", fetch, waits.append) == {"ok": True}
    assert calls == [20] * 4
    assert waits == [3, 10, 20]


def test_fallback_sources_progress_and_request_content():
    long_abstract = "word " * 40
    members = [
        {"openalexId": "W1", "doi": "10.1/a", "title": "A"},
        {"openalexId": "W2", "doi": "10.1/b", "title": "B"},
        {"openalexId": None, "doi": "https://doi.org/10.1/c", "title": "C"},
        {"openalexId": "W4", "doi": "10.1/d", "title": "D"},
        {"openalexId": None, "doi": None, "title": "E"},
    ]
    calls = []
    progress = []

    def fetch(request, timeout):
        assert timeout == 20
        assert request.get_header("User-agent") == "paperlab-corpus-topics"
        calls.append(request)
        if "openalex.org" in request.full_url:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            if query["filter"][0].startswith("doi:"):
                return response({"results": []})
            return response({"results": [{"id": "https://openalex.org/W1",
                                          "abstract_inverted_index": {"word": list(range(40))}}]})
        if "semanticscholar.org" in request.full_url:
            assert json.loads(request.data) == {"ids": ["DOI:10.1/b", "DOI:10.1/c", "DOI:10.1/d"]}
            return response([{"abstract": long_abstract}, None, None])
        if request.full_url.endswith("10.1%2Fc"):
            return response({"message": {"abstract": "<jats:p>Abstract: " + long_abstract + "</jats:p>"}})
        raise urllib.error.HTTPError(request.full_url, 404, "missing", {}, None)

    fetch_texts(members, progress.append, fetch=fetch, sleep=lambda _: None, clock=lambda: 0)
    assert [m["abstract_source"] for m in members] == ["openalex", "semanticscholar", "crossref", "none", "none"]
    assert source_counts(members) == "Abstracts: OpenAlex 1, Semantic Scholar 1, Crossref 1, none 2"
    assert progress[-1] == source_counts(members)
    assert "Fetching abstracts (OpenAlex) 4/4" in progress
    assert "Filling abstracts (Semantic Scholar) 3/3" in progress
    assert "Filling abstracts (Crossref) 2/2" in progress
