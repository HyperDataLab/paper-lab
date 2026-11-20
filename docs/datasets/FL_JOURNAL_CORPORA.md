# Federated learning journal corpora

Five target journals and five matched controls for exploratory PaperLab profiles. The OpenAlex scan identifies
venues relevant to asynchronous federated learning (FL). Each corpus samples eligible articles across the
venue's output, regardless of topic.

## OpenAlex venue scan

The supplied `fl-journals.json` records completion at **2026-11-20 07:25:03.210 UTC**. The scan stores a single
completion timestamp for the run. Both `/works` searches used the filters below and grouped by
`primary_location.source.id` with `per_page=200`.

```text
Common: type:article,from_publication_date:2021-01-01,primary_location.source.type:journal
FL: title_and_abstract.search:"federated learning"
Async: title_and_abstract.search:"asynchronous federated" OR "semi-asynchronous federated" OR (federated AND (staleness OR straggler OR stragglers))
```

The scan took the first 40 FL groups, read their ISSNs and metrics from `/sources/<id>`, and counted OA FL
articles by adding `primary_location.source.id:<id>,is_oa:true` to the FL filter. The async column counts hits
from its separate query and serves as a proxy for venue fit. The scan starts in 2021 and includes data up to
the run date. The table preserves the scan's order.

| Rank | Journal                                                 | OpenAlex ID   | FL papers | Async FL papers | OA FL papers | 2-year mean citedness | h-index |
| ---: | ------------------------------------------------------- | ------------- | --------: | --------------: | -----------: | --------------------: | ------: |
|    1 | IEEE Internet of Things Journal                         | `S2480266640` |      1199 |              69 |          370 |                 10.36 |     281 |
|    2 | IEEE Access                                             | `S2485537415` |       713 |              17 |          713 |                  8.37 |     430 |
|    3 | Scientific Reports                                      | `S196734849`  |       474 |              10 |          474 |                  6.56 |     502 |
|    4 | IEEE Transactions on Mobile Computing                   | `S69141925`   |       472 |              55 |          186 |                 11.50 |     201 |
|    5 | Electronics                                             | `S4210202905` |       345 |              10 |          345 |                  5.56 |     185 |
|    6 | IEEE Transactions on Consumer Electronics               | `S126824455`  |       319 |              12 |           72 |                 10.07 |     144 |
|    7 | Future Generation Computer Systems                      | `S186357190`  |       278 |              19 |          100 |                  9.39 |     236 |
|    8 | IEEE Transactions on Information Forensics and Security | `S61310614`   |       252 |               6 |           87 |                 12.18 |     221 |
|    9 | Computer Networks                                       | `S63392143`   |       243 |              16 |           89 |                  7.45 |     212 |
|   10 | Sensors                                                 | `S101949793`  |       241 |               9 |          241 |                  6.76 |     376 |
|   11 | IEEE Transactions on Wireless Communications            | `S63459445`   |       226 |              29 |          139 |                 13.92 |     319 |
|   12 | Knowledge-Based Systems                                 | `S10169007`   |       225 |               5 |           58 |                 10.47 |     238 |
|   13 | IEEE Transactions on Vehicular Technology               | `S10936095`   |       224 |              20 |           65 |                  9.05 |     303 |
|   14 | IEEE Transactions on Dependable and Secure Computing    | `S133795288`  |       218 |               7 |           91 |                  8.18 |     148 |
|   15 | Applied Sciences                                        | `S4210205812` |       206 |               2 |          206 |                  4.86 |     267 |

The targets cover IoT, mobile computing, parallel and distributed systems, distributed infrastructure, and
communications. IoT Journal and TMC contribute the strongest async counts among the targets. FGCS extends the
set to distributed infrastructure. TPDS adds a venue focused on the systems and algorithms behind async FL.
OJ-COMS adds a communications venue with an all-OA FL pool. OpenAlex citation metrics give context for the
selection. OA share matters because a profile needs retrieved full text to measure a paper.

| Target                                                | Async hits |      OA FL share | 2-year mean citedness | h-index |
| ----------------------------------------------------- | ---------: | ---------------: | --------------------: | ------: |
| IEEE Internet of Things Journal                       |         69 | 370/1199 (30.9%) |                 10.36 |     281 |
| IEEE Transactions on Mobile Computing                 |         55 |  186/472 (39.4%) |                 11.50 |     201 |
| IEEE Transactions on Parallel and Distributed Systems |          7 |   49/100 (49.0%) |                  7.77 |     213 |
| Future Generation Computer Systems                    |         19 |  100/278 (36.0%) |                  9.39 |     236 |
| IEEE Open Journal of the Communications Society       |         15 |   107/107 (100%) |                 10.37 |      93 |

The scan uses OpenAlex `is_oa:true`, which can include green OA. The journal harvest includes only gold,
diamond, hybrid, and bronze. These statuses define corpus eligibility. A PDF still needs to be acquired and
parsed for the paper to contribute to a profile.

## Corpus IDs and controls

A control title appends `đối chứng` to the target title. An agent chose the three peers for each target based on
field and tier. The owner can change the peer IDs and their order in `scripts/seed/journalCorpora.ts` before
building the seed.

| Target title                                          | Journal ID                             | Control ID                             | Control venues in protocol order                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IEEE Internet of Things Journal                       | `d076ad26-8222-4385-aee4-ffbfefef4543` | `ca212a61-f793-4c24-a80b-3fe311a3777c` | IEEE Transactions on Industrial Informatics (`S184777250`), Internet of Things, Elsevier (`S4210174276`), IEEE Transactions on Network Science and Engineering (`S2484352698`) |
| IEEE Transactions on Mobile Computing                 | `0dd52a4c-e634-4288-b83c-cd3915aaf463` | `ad02427c-95e8-4b47-8b8c-c9fbdbaab04b` | Computer Networks (`S63392143`), IEEE Transactions on Network and Service Management (`S173527311`), IEEE Transactions on Vehicular Technology (`S10936095`)                   |
| IEEE Transactions on Parallel and Distributed Systems | `638d5e0b-d051-427a-90fe-c1d44e0b1b4b` | `c09e06c1-a60c-4d28-9329-2a0c344807e9` | Future Generation Computer Systems (`S186357190`), The Journal of Supercomputing (`S32326811`), Cluster Computing (`S106148199`)                                               |
| Future Generation Computer Systems                    | `001f76b5-aeac-4928-8c2a-1f8816732bce` | `09f28aed-a9c0-4bd2-a809-2fda98730c34` | Cluster Computing (`S106148199`), The Journal of Supercomputing (`S32326811`), Computer Networks (`S63392143`)                                                                 |
| IEEE Open Journal of the Communications Society       | `c756b38f-133a-48a1-b21f-e1ffc0adf27e` | `5a7f3607-9fb7-4780-8510-72beb4f511a4` | IEEE Transactions on Cognitive Communications and Networking (`S2484188435`), IEEE Network (`S186584794`), IEEE Transactions on Vehicular Technology (`S10936095`)             |

Targets use `admired` sampling with N = 50. The harvest ranks by `cited_by_count` within publication year and
aims for 10 articles in each year from 2021 through 2025. The protocol uses the app's version-of-record default.
The shared sampler filters retractions, missing DOIs, non-articles, editorial or correction titles, and
duplicate OpenAlex works in the candidate pool. The app orders ties by DOI, then OpenAlex work ID.

Each `control` protocol has `samplingRule: match:<target ID>` and inherits the target's scope. Its yearly
quota follows the target's realised count for that year. The app divides the quota evenly between the peers,
allocates remainders in protocol order, and ranks each peer separately. A year with a target count of 10 thus
allocates 4, 3, and 3 papers. A shortfall stays in its own year and venue. All selected members have role
`build`. The admired profile has no holdout and is exploratory.

## Fetch and build

Run from the repository root using the project's existing Vite dependency.

```sh
node scripts/seed/journalCorpora.mjs fetch <fl-journals.json> <journal-openalex>
node scripts/seed/journalCorpora.mjs build <fl-journals.json> <journal-openalex> <journal-corpora>
```

Fetch uses anonymous OpenAlex requests at least four seconds apart. It saves the exact app page URLs and
responses in `journal-openalex`, so it can resume and the build can run offline. All 15 sources have ISSNs
in the supplied scan. A source with missing ISSNs is looked up at `/sources/<id>`.

The build validates each of the ten `<id>.json` files with `CorpusSchema`. It credits selected records to
their OpenAlex queries and writes `summary.json` with the per-corpus N, yearly counts and shortfalls,
exclusions, OA share, OA status counts, and request times. The live harvest in the development environment
was blocked by outbound network permissions. The table records reserved IDs. The counts and exclusions
will be available after a successful fetch and build. Eligible selected papers have a 100% OA share by
the harvest filter.

## Upload, import, and profile

1. With `PAPERLAB_DATA_TOKEN` set to a current lab Firebase ID token and Wrangler authenticated to the lab
   account, run `node scripts/seed/uploadCorpora.mjs <journal-corpora>`. It uses Wrangler 4.161.0 to check
   `paper-fetch/paperlab/corpora/<id>`, then uses the legacy worker's conditional R2 write to create a missing
   object with metadata. The conditional write also protects against a concurrent create.
2. In PaperLab, sign in as a lab admin. Open **Cài đặt** (Settings), then **Tài khoản lab → Nhập corpus cũ**.
   This imports the legacy objects into the central store and skips existing live corpus IDs.
3. Open each target and control. Under **Thu thập và dựng paper model**, run **Lấy PDF**, then **Dựng paper
   model**. Keep the tab open while the queue runs. Profile measurements use the retrieved full-text papers.
4. On both corpora, run **Gắn nhãn cho corpus** for the label-backed features you want in the profile.
5. On the journal corpus, open **Profile**. Confirm the matched **Corpus đối chứng**, then choose
   **Tính profile**.
6. Choose **Tải profile v2 (nháp)** and import the exported `*.corpus-profile-v2.draft.json` as real profile
   data in Writing Bank. See the [v2 export contract](../contracts/corpus-profile-v2.md).
