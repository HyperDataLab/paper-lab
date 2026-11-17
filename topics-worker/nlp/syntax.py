"""Voice and tense of a sentence's main clause, from a spaCy-style dependency parse.

Pure functions over token dicts ({i, text, lemma, pos, tag, dep, head, morph}); nothing here imports spaCy, so the
rules are tested on hand-built parses. Bump SERVICE_VERSION whenever a rule or the response shape changes.

Rules (main clause = the first ROOT and the verbs coordinated with it by `conj`):
- voice: "passive" when a main-clause verb has a passive subject/auxiliary child (ClearNLP `nsubjpass`/`auxpass`/
  `csubjpass` as in en_core_web_sm, or UD `nsubj:pass`/`aux:pass`/`csubj:pass`), carries `Voice=Pass`, or is "get"
  + past participle ("got contaminated"). Passive relative or subordinate clauses do not count. "active" otherwise;
  null when the root is not a verb or copula (a verbless fragment such as a heading).
- tense: taken from the ROOT's verb group (its aux/cop children and the ROOT, in order).
  will/shall/'ll/wo(n't) -> "future"; any other modal (may, can, should, would, could, must) -> "none" with `modal`
  set; otherwise the first finite verb in the group decides: VBD -> "past", VBZ/VBP -> "present" (so perfects
  follow their auxiliary: "has shown" is present, "had shown" past; do-questions follow "do/did"). No finite verb
  (imperative VB, bare participle, verbless fragment) -> "none". "be going to" counts as present.
"""

SERVICE_VERSION = "pl-nlp-1"
MAX_SENTENCES = 200
MAX_BYTES = 100_000
MAX_KEY_LENGTH = 128

PASSIVE_DEPS = {"nsubjpass", "nsubj:pass", "auxpass", "aux:pass", "csubjpass", "csubj:pass"}
GROUP_DEPS = {"aux", "auxpass", "aux:pass", "cop"}
FUTURE_MODALS = {"will", "shall", "'ll", "ll", "wo", "sha"}
GET_COMPLEMENTS = {"acomp", "xcomp", "oprd", "ccomp", "attr"}
VERBAL = {"VERB", "AUX"}


def _feats(token):
    morph = token.get("morph") or ""
    return dict(part.split("=", 1) for part in morph.split("|") if "=" in part)


def _children(tokens, head):
    return [t for t in tokens if t["head"] == head and t["i"] != head]


def main_root(tokens):
    """Index of the first ROOT token, or None."""
    for token in tokens:
        if token["dep"] == "ROOT" or token["head"] == token["i"]:
            return token["i"]
    return None


def _by_index(tokens):
    return {t["i"]: t for t in tokens}


def _is_predicate(tokens, i):
    token = _by_index(tokens)[i]
    return token["pos"] in VERBAL or any(c["dep"] == "cop" for c in _children(tokens, i))


def main_clause_heads(tokens):
    root = main_root(tokens)
    if root is None:
        return []
    index = _by_index(tokens)
    return [root] + [c["i"] for c in _children(tokens, root) if c["dep"] == "conj" and index[c["i"]]["pos"] in VERBAL]


def _passive_head(tokens, i):
    token = _by_index(tokens)[i]
    if _feats(token).get("Voice") == "Pass":
        return True
    children = _children(tokens, i)
    if any(c["dep"] in PASSIVE_DEPS for c in children):
        return True
    return (token.get("lemma") or "").lower() == "get" and any(
        c["dep"] in GET_COMPLEMENTS and c["tag"] == "VBN" for c in children
    )


def voice(tokens):
    root = main_root(tokens)
    if root is None or not _is_predicate(tokens, root):
        return None
    return "passive" if any(_passive_head(tokens, i) for i in main_clause_heads(tokens)) else "active"


def verb_group(tokens):
    """The ROOT's auxiliaries/copula and the ROOT itself, in sentence order."""
    root = main_root(tokens)
    if root is None:
        return []
    group = [c for c in _children(tokens, root) if c["dep"] in GROUP_DEPS]
    return sorted(group + [_by_index(tokens)[root]], key=lambda t: t["i"])


def tense(tokens):
    """(tense, modal) for the main clause; modal is the lemma of a modal auxiliary, else None."""
    root = main_root(tokens)
    if root is None or not _is_predicate(tokens, root):
        return "none", None
    for token in verb_group(tokens):
        if token["tag"] == "MD":
            lemma = (token.get("lemma") or token["text"]).lower()
            word = token["text"].lower()
            if lemma in FUTURE_MODALS or word in FUTURE_MODALS:
                return "future", "shall" if {lemma, word} & {"shall", "sha"} else "will"
            return "none", lemma
    for token in verb_group(tokens):
        feats = _feats(token)
        if token["tag"] == "VBD" or (feats.get("VerbForm") == "Fin" and feats.get("Tense") == "Past"):
            return "past", None
        if token["tag"] in ("VBZ", "VBP") or (feats.get("VerbForm") == "Fin" and feats.get("Tense") == "Pres"):
            return "present", None
    return "none", None


def describe(tokens):
    """Derived fields for one parsed sentence."""
    sentence_tense, modal = tense(tokens)
    return {"root": main_root(tokens), "voice": voice(tokens), "tense": sentence_tense, "modal": modal}


def validate_request(payload, size):
    """The sentence list of a parse request, or ValueError naming what is wrong."""
    if size > MAX_BYTES:
        raise ValueError("payload too large")
    if not isinstance(payload, dict) or not isinstance(payload.get("sentences"), list):
        raise ValueError("invalid payload")
    sentences = payload["sentences"]
    if not 1 <= len(sentences) <= MAX_SENTENCES:
        raise ValueError(f"send 1 to {MAX_SENTENCES} sentences")
    keys = set()
    for item in sentences:
        if not isinstance(item, dict):
            raise ValueError("invalid sentence")
        key, text = item.get("key"), item.get("text")
        if not isinstance(key, str) or not 1 <= len(key) <= MAX_KEY_LENGTH or key in keys:
            raise ValueError("invalid or duplicate key")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("invalid text")
        keys.add(key)
    return [{"key": item["key"], "text": item["text"]} for item in sentences]


def doc_tokens(doc):
    """spaCy Doc -> token dicts. Offsets are Python string indexes, i.e. code points in the sentence text."""
    return [
        {
            "i": t.i,
            "text": t.text,
            "start": t.idx,
            "end": t.idx + len(t.text),
            "lemma": t.lemma_,
            "pos": t.pos_,
            "tag": t.tag_,
            "dep": t.dep_,
            "head": t.head.i,
            "morph": str(t.morph),
        }
        for t in doc
    ]
