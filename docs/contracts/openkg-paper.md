# Paper OpenKG

The paper graph combines the local paper model, the linked DOI-library lookup, the saved SCG run and the latest argument run. It uses the five SciAtlas layers and adds explicit contribution and prerequisite nodes. [SciAtlas paper](https://arxiv.org/abs/2605.22878)

## Identity

Resource IRIs start with `https://hyperdatalab-paragraph-lab.web.app/kg/`. The suffixes are:

| Resource                      | Path                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Paper                         | `paper/<PaperLab id>`                                                                                   |
| Cited work                    | `work/<OpenAlex W id or normalized DOI>`                                                                |
| Venue                         | `source/<OpenAlex S id>`, or `source/name/<venue name>` for a lookup with only the name                 |
| Keyword                       | `keyword/<OpenAlex keyword slug>`                                                                       |
| Discipline                    | `discipline/<OpenAlex short id>`, including its `domains/`, `fields/`, `subfields/` or `topics/` prefix |
| Author                        | `author/<bare ORCID or OpenAlex A id>`                                                                  |
| Institution                   | `institution/<bare ROR id>`                                                                             |
| Contribution and prerequisite | `contribution/<SCG id>` and `prerequisite/<SCG id>`                                                     |
| Tool                          | `tool/<URL>`                                                                                            |
| Claim                         | `claim/<paper id>/<argument run id>/<argument id>`                                                      |
| Argument evidence             | `evidence/<paper id>/<paragraph id>/<start>/<end>` with code-point offsets                              |
| Evidence level                | `evidence-level/<E0–E5>`                                                                                |

Each path component is percent-encoded, including the slash within a DOI. A reference with no DOI uses `work/<paper id>/<ref id>`. SCG links use the model's reference ID when available, otherwise the DOI, `work/s2/<corpus id>`, or a paper-scoped `work/<paper id>/scg/<prerequisite id>/<index>`. Unresolved cross-paper SCG matches use the target contribution ID as the label. Name-only authorships and institutions are retained on lookup and require an identifier to appear in the graph.

## Vocabulary

`schema:` expands to `https://schema.org/` and `pl:` expands to `https://hyperdatalab-paragraph-lab.web.app/kg/vocab/`.

| Layer        | Node types                                                                         | Relationship predicates                                                          |
| ------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Evidential   | `schema:ScholarlyArticle`, `schema:CreativeWork`                                   | `schema:citation`, `schema:isPartOf`                                             |
| Conceptual   | `schema:DefinedTerm` for keywords, `pl:Contribution`, `pl:Prerequisite`, `pl:Tool` | `schema:keywords`, `pl:contributes`, `pl:buildsOn`                               |
| Disciplinary | `schema:DefinedTerm` for domain, field, subfield and topic                         | `schema:about` for the most specific known level, `pl:broader` for the hierarchy |
| Expertise    | `schema:Person`, `schema:Organization`                                             | `schema:author`, `schema:affiliation`                                            |
| Normative    | `pl:Claim`, `pl:Evidence`, `schema:DefinedTerm` for evidence levels                | `pl:hasClaim`, `pl:supportedBy`, `pl:evidenceLevel`                              |

Nodes carry `schema:name`, `pl:layer`, and applicable attributes. These include `schema:description`, `pl:doi`, `pl:openalexId`, `pl:orcid`, `pl:ror`, `pl:country` (OpenAlex country code), `pl:year`, `pl:score`, `pl:salience`, `pl:review` and `pl:evidenceBasis`.

PaperLab groups OpenAlex keyword relevance scores as high for scores at least 0.6, middle for scores from 0.4 up to 0.6, and low below 0.4. These cutoffs live in `KEYWORD_SALIENCE`. Salience in a paper export is specific to that paper. `pl:relatedKeyword` is reserved for corpus co-occurrence.

## Provenance and evidence

Both exports contain direct RDF relationships and one reified `rdf:Statement` per graph edge, with `rdf:subject`, `rdf:predicate`, `rdf:object`, `pl:layer`, and `pl:provenance`. Separate statements can describe the same relationship with different origins. When interpreting relationships, use the provenance on those statements.

- `openalex` identifies library lookup metadata.
- `paper_text` identifies the paper's parsed references. The graph adds sentence keys for uniquely resolved in-text citations. OpenAlex W IDs and textual DOI references remain separate when the local data cannot join them.
- `llm_candidate` identifies unreviewed SCG relationships and argument-run classifications.
- `accepted` identifies a reader-accepted SCG contribution, prerequisite or match. Rejected items and links to a rejected local contribution are omitted.

Each available evidence sentence key is a separate `pl:evidenceSentence` literal on the statement. Keys refer to the existing PaperLab sentence index. Argument evidence comes from anchored data and backing spans. The evidence level belongs to the classified claim and its provenance identifies the argument run's assessment as a candidate.
