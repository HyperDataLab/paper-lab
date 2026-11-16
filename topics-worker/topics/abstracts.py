"""Fetch usable abstracts without importing the clustering stack."""
import datetime as dt
import email.utils
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

from helpers import abstract_of

USER_AGENT = "paperlab-corpus-topics"


def usable(text):
    return isinstance(text, str) and len(text.split()) >= 40


def clean_jats(value):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"</?(?:jats:)?(?:p|sec|title|br)\b[^>]*>", " ", value, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]*>", "", value))
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"^abstract\b\s*[:.\-]?\s*", "", text, flags=re.I)


def semantic_abstracts(payload, count):
    if not isinstance(payload, list):
        raise ValueError("Invalid Semantic Scholar response")
    return [(item.get("abstract") if isinstance(item, dict) else None)
            for item in (payload + [None] * count)[:count]]


def crossref_abstract(payload):
    message = payload.get("message") if isinstance(payload, dict) else None
    return clean_jats(message.get("abstract")) if isinstance(message, dict) else ""


def retry_delay(error, attempt):
    value = error.headers.get("Retry-After") if error.headers else None
    if value:
        try:
            return max(0, float(value))
        except ValueError:
            try:
                date = email.utils.parsedate_to_datetime(value)
                return max(0, (date - dt.datetime.now(dt.timezone.utc)).total_seconds())
            except (TypeError, ValueError, OverflowError):
                pass
    return 5 * (2 ** attempt)


def fetch_json(request, fetch=urllib.request.urlopen, sleep=time.sleep, retry_5xx=True):
    for attempt in range(4):
        try:
            with fetch(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if (error.code != 429 and not (retry_5xx and 500 <= error.code < 600)) or attempt == 3:
                raise
            sleep(retry_delay(error, attempt))


def doi_of(member):
    doi = member.get("doi")
    if not isinstance(doi, str):
        return ""
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", doi.strip(), flags=re.I)


def source_counts(members):
    counts = Counter(m.get("abstract_source", "none") for m in members)
    return (f"Abstracts: OpenAlex {counts['openalex']}, Semantic Scholar {counts['semanticscholar']}, "
            f"Crossref {counts['crossref']}, none {counts['none']}")


def fetch_texts(members, progress, fetch=urllib.request.urlopen, sleep=time.sleep, clock=time.monotonic):
    by_oa = defaultdict(list)
    by_doi = defaultdict(list)
    for member in members:
        member["abstract_source"] = "none"
        if member.get("openalexId"):
            by_oa[member["openalexId"]].append(member)
        elif doi_of(member):
            by_doi[doi_of(member)].append(member)

    keys = list(by_oa)
    tasks = [("id", keys[i:i + 50]) for i in range(0, len(keys), 50)]
    tasks += [("doi", [doi]) for doi in by_doi]
    total = len(keys) + len(by_doi)
    done = 0
    progress(f"Fetching abstracts (OpenAlex) 0/{total}")
    for kind, chunk in tasks:
        params = {"filter": ("openalex_id:" if kind == "id" else "doi:") + "|".join(chunk),
                  "per-page": "50", "select": "id,title,abstract_inverted_index,primary_topic"}
        request = urllib.request.Request("https://api.openalex.org/works?" + urllib.parse.urlencode(params),
                                         headers={"User-Agent": USER_AGENT})
        try:
            works = fetch_json(request, fetch, sleep)["results"]
            for work in works:
                targets = by_oa.get(work.get("id", "").rsplit("/", 1)[-1], []) if kind == "id" else by_doi[chunk[0]]
                for member in targets:
                    abstract = abstract_of(work.get("abstract_inverted_index"))
                    if usable(abstract):
                        member["abstract"], member["abstract_source"] = abstract, "openalex"
                    member["title"] = member.get("title") or work.get("title") or ""
                    member["oa_subfield"] = ((work.get("primary_topic") or {}).get("subfield") or {}).get("display_name")
        except Exception as error:
            print(f"OpenAlex batch failed: {error}", flush=True)
        done += len(chunk)
        progress(f"Fetching abstracts (OpenAlex) {done}/{total}")
        if done < total:
            sleep(0.2)

    missing = [m for m in members if m["abstract_source"] == "none" and doi_of(m)]
    progress(f"Filling abstracts (Semantic Scholar) 0/{len(missing)}")
    for i in range(0, len(missing), 500):
        chunk = missing[i:i + 500]
        request = urllib.request.Request(
            "https://api.semanticscholar.org/graph/v1/paper/batch?fields=abstract,externalIds",
            data=json.dumps({"ids": ["DOI:" + doi_of(m) for m in chunk]}).encode(),
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"}, method="POST")
        try:
            results = semantic_abstracts(fetch_json(request, fetch, sleep, retry_5xx=False), len(chunk))
            for member, abstract in zip(chunk, results):
                if usable(abstract):
                    member["abstract"], member["abstract_source"] = abstract, "semanticscholar"
        except Exception as error:
            print(f"Semantic Scholar batch failed: {error}", flush=True)
        progress(f"Filling abstracts (Semantic Scholar) {i + len(chunk)}/{len(missing)}")

    missing = [m for m in members if m["abstract_source"] == "none" and doi_of(m)]
    progress(f"Filling abstracts (Crossref) 0/{len(missing)}")
    last_request = None

    def rate_limited_fetch(request, timeout):
        nonlocal last_request
        if last_request is not None:
            sleep(max(0, 0.2 - (clock() - last_request)))
        last_request = clock()
        return fetch(request, timeout=timeout)

    for i, member in enumerate(missing):
        request = urllib.request.Request("https://api.crossref.org/works/" + urllib.parse.quote(doi_of(member), safe=""),
                                         headers={"User-Agent": USER_AGENT})
        try:
            abstract = crossref_abstract(fetch_json(request, rate_limited_fetch, sleep))
            if usable(abstract):
                member["abstract"], member["abstract_source"] = abstract, "crossref"
        except urllib.error.HTTPError as error:
            if error.code != 404:
                print(f"Crossref request failed: {error}", flush=True)
        except Exception as error:
            print(f"Crossref request failed: {error}", flush=True)
        progress(f"Filling abstracts (Crossref) {i + 1}/{len(missing)}")
    counts = source_counts(members)
    print(counts, flush=True)
    progress(counts)
