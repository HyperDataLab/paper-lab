# Corpus profile v2 draft

Writing Bank vendors the draft JSON Schema (`schemas/corpus-profile-v2.draft.schema.json`), the feature registry v2 (`schemas/feature-registry-v2.json`) and the example (`schemas/examples/corpus-profile-v2.draft.example.json`) for its journal profile mapping (writing-bank doc 39). `schemaVersion` distinguishes it from v1, and `draft` is always true while the shape may still change. The example is built by PaperLab code from synthetic papers and contains no real paper text. `npm run schema:corpus-profile` regenerates all three files.

## PDF acquisition

When `VITE_FETCH_HUB_URL` is configured, send the remaining DOIs from the corpus build card and choose
**Cập nhật từ Hub** to import finished PDFs. Build the paper models once their members show **Đã lấy**.
See the [Hub acquisition workflow](../datasets/FL_JOURNAL_CORPORA.md#acquire-pdfs-through-paper-fetch-hub).

## Registry v2 (slice P2)

Every v1 feature is kept with its id and definition and forms the pre-declared `core` FDR family, so its comparisons equal the v1 profile. The P2 features are tested with the same statistics, Benjamini–Hochberg within their own family:

| `fdrFamily`  | Features                                                                                                                                                                                | Extractor                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `structure`  | `section.<ROLE>.presence`, `structure.section_count`, `structure.results_discussion_combined`, `structure.other_share`                                                                  | deterministic                          |
| `paragraphs` | `section.<ROLE>.paragraph_count`, `section.<ROLE>.paragraph_length`                                                                                                                     | deterministic                          |
| `style`      | `section.<ROLE>.hedges`, `.boosters`, `.first_person` (word lists, per 1000 words)                                                                                                      | deterministic                          |
| `style`      | `section.<ROLE>.passive`, `.tense.past`, `.tense.present`, `.tense.future` (main-clause shares, P6)                                                                                     | `tool` (spaCy service)                 |
| `reasoning`  | `section.<ROLE>.claim.<type>` (prevalence, no appendix), `argument.with_data`, `.stated_warrant`, `.inferred_warrant`, `.with_qualifier`, `.with_rebuttal`, `.unsupported` (prevalence) | machine labels (`llm`, `machineShare`) |

Per-section values other than `presence` are null for a paper without that role. `granularity` is `section` for `section.<ROLE>.*` ids and `paper` otherwise; every value is still one per paper. A profile with `scope: "admired"` is always `exploratory`.

List blocks: `headings` (top-level heading per role with document share), `sectionSequences` (role order of top-level sections, abstract/other/appendix left out), `keywords` (OpenAlex keywords, target vs control share over papers with keywords, G² and Log Ratio), `classification.subfields` (primary-topic subfield share; `name` is null when no library record names it).

Passive voice and tense (P6) need the spaCy grammar service (`VITE_NLP_URL`). A paper without a parse has null values, and the profile carries a `syntax_unavailable: …` warning with the count; values are never filled in. Registry `reserved` is now empty.

`evidenceLevel` (P7, optional): shares of E0–E5 over main claims among live arguments of each profiled paper's latest argument run (machine labels), for target and control. It is omitted, with an `evidence_level_unavailable: …` warning, when either side has no graded main claim; counts are in `methodNotes`.
