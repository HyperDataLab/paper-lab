# Corpus profile v2 draft

Writing Bank vendors the draft JSON Schema and synthetic fixture for its journal profile mapping. The shape may change until P2 ships; this contract does not provide measurements or a v2 registry. `schemaVersion` distinguishes it from v1, and `draft` is always true. The fixture contains invented values and no paper text.

Section feature IDs follow `section.<ROLE>.<metric>`, using the v1 registry's role IDs. Planned metrics include `paragraph_count`, `paragraph_length`, `presence`, `hedges`, `boosters`, `first_person`, `passive`, `tense.past`, `tense.present`, `tense.future`, and `claim.<type>`. Paper-level additions include `structure.section_count`, `structure.results_discussion_combined`, and `argument.with_data`, `argument.stated_warrant`, `argument.inferred_warrant`, `argument.with_qualifier`, `argument.with_rebuttal`, and `argument.unsupported`. These IDs are a draft, not a published registry.

`fdrFamily` identifies the declared testing family; exploratory features are for reference. The optional evidence-level distribution is P7 and remains provisional. The coordination discussion records a subsequent owner decision to include P7, but its measurement and final shape are pending.
