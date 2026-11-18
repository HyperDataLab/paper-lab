"""Voice/tense rules on hand-built spaCy-style parses (no model needed). Run: python test_syntax.py (or pytest)."""

import unittest

from syntax import MAX_BYTES, MAX_SENTENCES, describe, validate_request


def parse(*rows):
    """rows: (text, lemma, pos, tag, dep, head[, morph]); `i` is the row number."""
    return [
        {"i": i, "text": r[0], "lemma": r[1], "pos": r[2], "tag": r[3], "dep": r[4], "head": r[5],
         "morph": r[6] if len(r) > 6 else ""}
        for i, r in enumerate(rows)
    ]


def derived(tokens):
    value = describe(tokens)
    return value["voice"], value["tense"], value["modal"]


class VoiceTenseTest(unittest.TestCase):
    def test_active_past(self):
        tokens = parse(("We", "we", "PRON", "PRP", "nsubj", 1), ("measured", "measure", "VERB", "VBD", "ROOT", 1),
                       ("the", "the", "DET", "DT", "det", 3), ("rate", "rate", "NOUN", "NN", "dobj", 1),
                       (".", ".", "PUNCT", ".", "punct", 1))
        self.assertEqual(derived(tokens), ("active", "past", None))
        self.assertEqual(describe(tokens)["root"], 1)

    def test_passive_past_clearnlp_labels(self):
        tokens = parse(("The", "the", "DET", "DT", "det", 1), ("samples", "sample", "NOUN", "NNS", "nsubjpass", 3),
                       ("were", "be", "AUX", "VBD", "auxpass", 3), ("analysed", "analyse", "VERB", "VBN", "ROOT", 3),
                       ("by", "by", "ADP", "IN", "agent", 3), ("raters", "rater", "NOUN", "NNS", "pobj", 4))
        self.assertEqual(derived(tokens), ("passive", "past", None))

    def test_passive_present_ud_labels(self):
        tokens = parse(("Results", "result", "NOUN", "NNS", "nsubj:pass", 2), ("are", "be", "AUX", "VBP", "aux:pass", 2),
                       ("reported", "report", "VERB", "VBN", "ROOT", 2), ("here", "here", "ADV", "RB", "advmod", 2))
        self.assertEqual(derived(tokens), ("passive", "present", None))

    def test_voice_pass_morph_alone_is_passive(self):
        tokens = parse(("Results", "result", "NOUN", "NNS", "nsubj", 1),
                       ("reported", "report", "VERB", "VBN", "ROOT", 1, "Aspect=Perf|Tense=Past|VerbForm=Part|Voice=Pass"))
        self.assertEqual(derived(tokens)[0], "passive")

    def test_future_with_will_and_contraction(self):
        will = parse(("We", "we", "PRON", "PRP", "nsubj", 2), ("will", "will", "AUX", "MD", "aux", 2),
                     ("report", "report", "VERB", "VB", "ROOT", 2), ("results", "result", "NOUN", "NNS", "dobj", 2))
        self.assertEqual(derived(will), ("active", "future", "will"))
        contracted = parse(("We", "we", "PRON", "PRP", "nsubj", 2), ("'ll", "will", "AUX", "MD", "aux", 2),
                           ("report", "report", "VERB", "VB", "ROOT", 2))
        self.assertEqual(derived(contracted), ("active", "future", "will"))
        shall = parse(("We", "we", "PRON", "PRP", "nsubj", 2), ("shall", "shall", "AUX", "MD", "aux", 2),
                      ("see", "see", "VERB", "VB", "ROOT", 2))
        self.assertEqual(derived(shall), ("active", "future", "shall"))

    def test_future_passive(self):
        tokens = parse(("Data", "datum", "NOUN", "NNS", "nsubjpass", 3), ("will", "will", "AUX", "MD", "aux", 3),
                       ("be", "be", "AUX", "VB", "auxpass", 3), ("released", "release", "VERB", "VBN", "ROOT", 3))
        self.assertEqual(derived(tokens), ("passive", "future", "will"))

    def test_other_modal_has_no_tense(self):
        tokens = parse(("The", "the", "DET", "DT", "det", 1), ("data", "datum", "NOUN", "NNS", "nsubjpass", 4),
                       ("may", "may", "AUX", "MD", "aux", 4), ("be", "be", "AUX", "VB", "auxpass", 4),
                       ("biased", "bias", "VERB", "VBN", "ROOT", 4))
        self.assertEqual(derived(tokens), ("passive", "none", "may"))

    def test_get_passive_as_auxiliary_and_as_root(self):
        aux = parse(("Samples", "sample", "NOUN", "NNS", "nsubjpass", 2), ("got", "get", "AUX", "VBD", "auxpass", 2),
                    ("contaminated", "contaminate", "VERB", "VBN", "ROOT", 2))
        self.assertEqual(derived(aux), ("passive", "past", None))
        root = parse(("Samples", "sample", "NOUN", "NNS", "nsubj", 1), ("got", "get", "VERB", "VBD", "ROOT", 1),
                     ("contaminated", "contaminate", "VERB", "VBN", "acomp", 1))
        self.assertEqual(derived(root), ("passive", "past", None))
        active_get = parse(("We", "we", "PRON", "PRP", "nsubj", 1), ("got", "get", "VERB", "VBD", "ROOT", 1),
                           ("results", "result", "NOUN", "NNS", "dobj", 1))
        self.assertEqual(derived(active_get), ("active", "past", None))

    def test_questions(self):
        passive = parse(("Were", "be", "AUX", "VBD", "auxpass", 3), ("the", "the", "DET", "DT", "det", 2),
                        ("samples", "sample", "NOUN", "NNS", "nsubjpass", 3),
                        ("analysed", "analyse", "VERB", "VBN", "ROOT", 3), ("?", "?", "PUNCT", ".", "punct", 3))
        self.assertEqual(derived(passive), ("passive", "past", None))
        do = parse(("Does", "do", "AUX", "VBZ", "aux", 3), ("the", "the", "DET", "DT", "det", 2),
                   ("method", "method", "NOUN", "NN", "nsubj", 3), ("generalise", "generalise", "VERB", "VB", "ROOT", 3),
                   ("?", "?", "PUNCT", ".", "punct", 3))
        self.assertEqual(derived(do), ("active", "present", None))

    def test_perfect_follows_its_auxiliary(self):
        present = parse(("The", "the", "DET", "DT", "det", 1), ("model", "model", "NOUN", "NN", "nsubjpass", 4),
                        ("has", "have", "AUX", "VBZ", "aux", 4), ("been", "be", "AUX", "VBN", "auxpass", 4),
                        ("trained", "train", "VERB", "VBN", "ROOT", 4))
        self.assertEqual(derived(present), ("passive", "present", None))
        past = parse(("Others", "other", "NOUN", "NNS", "nsubj", 2), ("had", "have", "AUX", "VBD", "aux", 2),
                     ("shown", "show", "VERB", "VBN", "ROOT", 2), ("this", "this", "PRON", "DT", "dobj", 2))
        self.assertEqual(derived(past), ("active", "past", None))

    def test_passive_relative_clause_does_not_make_the_sentence_passive(self):
        tokens = parse(("We", "we", "PRON", "PRP", "nsubj", 1), ("used", "use", "VERB", "VBD", "ROOT", 1),
                       ("data", "datum", "NOUN", "NNS", "dobj", 1), ("that", "that", "PRON", "WDT", "nsubjpass", 5),
                       ("were", "be", "AUX", "VBD", "auxpass", 5), ("collected", "collect", "VERB", "VBN", "relcl", 2))
        self.assertEqual(derived(tokens), ("active", "past", None))

    def test_coordinated_passive_main_clause_counts(self):
        tokens = parse(("We", "we", "PRON", "PRP", "nsubj", 1), ("collected", "collect", "VERB", "VBD", "ROOT", 1),
                       ("samples", "sample", "NOUN", "NNS", "dobj", 1), ("and", "and", "CCONJ", "CC", "cc", 1),
                       ("they", "they", "PRON", "PRP", "nsubjpass", 6), ("were", "be", "AUX", "VBD", "auxpass", 6),
                       ("analysed", "analyse", "VERB", "VBN", "conj", 1))
        self.assertEqual(derived(tokens), ("passive", "past", None))

    def test_copula_root_in_ud_style(self):
        tokens = parse(("The", "the", "DET", "DT", "det", 1), ("rate", "rate", "NOUN", "NN", "nsubj", 3),
                       ("is", "be", "AUX", "VBZ", "cop", 3), ("high", "high", "ADJ", "JJ", "ROOT", 3))
        self.assertEqual(derived(tokens), ("active", "present", None))

    def test_imperative_fragment_and_empty(self):
        imperative = parse(("Consider", "consider", "VERB", "VB", "ROOT", 0), ("cases", "case", "NOUN", "NNS", "dobj", 0))
        self.assertEqual(derived(imperative), ("active", "none", None))
        fragment = parse(("Results", "result", "NOUN", "NNS", "ROOT", 0), ("and", "and", "CCONJ", "CC", "cc", 0),
                         ("discussion", "discussion", "NOUN", "NN", "conj", 0))
        self.assertEqual(derived(fragment), (None, "none", None))
        self.assertEqual(describe([]), {"root": None, "voice": None, "tense": "none", "modal": None})


class ValidateRequestTest(unittest.TestCase):
    def test_accepts_a_batch(self):
        self.assertEqual(validate_request({"sentences": [{"key": "s1", "text": "We ran it.", "x": 1}]}, 50),
                         [{"key": "s1", "text": "We ran it."}])

    def test_rejects_bad_requests(self):
        for payload in (None, {}, {"sentences": []}, {"sentences": [{"key": "", "text": "A."}]},
                        {"sentences": [{"key": "a", "text": " "}]}, {"sentences": ["text"]},
                        {"sentences": [{"key": "a", "text": "A."}, {"key": "a", "text": "B."}]},
                        {"sentences": [{"key": str(i), "text": "A."} for i in range(MAX_SENTENCES + 1)]}):
            with self.assertRaises(ValueError):
                validate_request(payload, 10)
        with self.assertRaisesRegex(ValueError, "too large"):
            validate_request({"sentences": [{"key": "a", "text": "A."}]}, MAX_BYTES + 1)


if __name__ == "__main__":
    unittest.main()
