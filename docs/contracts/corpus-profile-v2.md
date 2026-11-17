# Corpus profile v2 draft

Writing Bank vendors the draft JSON Schema (`schemas/corpus-profile-v2.draft.schema.json`), the feature registry v2 (`schemas/feature-registry-v2.json`) and the example (`schemas/examples/corpus-profile-v2.draft.example.json`) for its journal profile mapping (writing-bank doc 39). `schemaVersion` distinguishes it from v1, and `draft` is always true while the shape may still change. The example is built by PaperLab code from synthetic papers and contains no real paper text. `npm run schema:corpus-profile` regenerates all three files.

## Registry v2 (slice P2)

Every v1 feature is kept with its id and definition and forms the pre-declared `core` FDR family, so its comparisons equal the v1 profile. The P2 features are tested with the same statistics, Benjamini–Hochberg within their own family:

| `fdrFamily`  | Features                                                                                                                                                                                | Extractor                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `structure`  | `section.<ROLE>.presence`, `structure.section_count`, `structure.results_discussion_combined`, `structure.other_share`                                                                  | deterministic                          |
| `paragraphs` | `section.<ROLE>.paragraph_count`, `section.<ROLE>.paragraph_length`                                                                                                                     | deterministic                          |
| `style`      | `section.<ROLE>.hedges`, `.boosters`, `.first_person` (word lists, per 1000 words)                                                                                                      | deterministic                          |
| `reasoning`  | `section.<ROLE>.claim.<type>` (prevalence, no appendix), `argument.with_data`, `.stated_warrant`, `.inferred_warrant`, `.with_qualifier`, `.with_rebuttal`, `.unsupported` (prevalence) | machine labels (`llm`, `machineShare`) |

Per-section values other than `presence` are null for a paper without that role. `granularity` is `section` for `section.<ROLE>.*` ids and `paper` otherwise; every value is still one per paper. A profile with `scope: "admired"` is always `exploratory`.

List blocks: `headings` (top-level heading per role with document share), `sectionSequences` (role order of top-level sections, abstract/other/appendix left out), `keywords` (OpenAlex keywords, target vs control share over papers with keywords, G² and Log Ratio), `classification.subfields` (primary-topic subfield share; `name` is null when no library record names it).

Reserved, not measured yet: `section.<ROLE>.passive` and `section.<ROLE>.tense.<past|present|future>` (P6, registry `reserved`), and the optional `evidenceLevel` block (P7).
