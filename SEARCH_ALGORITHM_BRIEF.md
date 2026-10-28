# RADR. — Product Brief & Search Algorithm Reference

**Audience:** AI agents (and engineers) planning how to make RADR.'s X-Ray search produce the best possible candidate set for every requisition, at the lowest SerpAPI credit cost.
**Written against:** commit `ef6dac4` (branch `main`), 2026-10-27. Every behaviour described below was read from source; the sample queries in §6 were produced by running the real generator code, not written by hand.
**How to use this document:** §1 is the product, §2–§5 describe exactly how search works today, §6 shows real output, §7 lists the defects that hurt search quality, and §8 is the planning framework and the list of levers for query optimisation. §9 lists invariants a redesign must keep. §10 lists open questions for the product owner.

---

## 1. Product brief

**RADR.** (repo name `Radrs`, earlier name *CandidateRadar*) is a recruiter-facing sourcing SaaS. A recruiter gives it a job requisition. RADR. turns the requisition into a bundle of Google **X-Ray** Boolean queries (`site:linkedin.com/in/ ...`, `site:github.com ...`, `filetype:pdf ...`), runs each query through **SerpAPI** (Google results), turns every profile-shaped result into a candidate card scored against the requisition, and then supports the rest of the funnel: a pipeline board (New → Reviewed → Saved → Shortlisted → Contacted → Replied → Archived), LLM-drafted outreach (LinkedIn note/DM, email, WhatsApp, call script), and message templates.

**Core promise:** zero hallucinated candidates. Every candidate comes from a real indexed search result (title + snippet + URL). RADR. never fetches or scrapes profile pages. It shows only what Google indexed.

**Who pays for search:** each recruiter brings their own SerpAPI key (BYOK). It is stored encrypted (AES-256-GCM, `src/lib/credentials.ts`) and verified against SerpAPI's free `account.json` endpoint at onboarding. **One SERP page (10 results) = one SerpAPI credit.** Free SerpAPI plans have a small monthly allowance, so credit efficiency is a first-class product requirement, not an optimisation nicety. The agent's system prompt states the guardrail plainly: *"Searches are expensive. I shall not initiate query creation until I have the full scope of the recruitment."*

**Two ways in:**
1. **Dashboard flow** (`src/app/(app)/dashboard/page.tsx`): upload or paste a JD → `/api/parse-jd` → the recruiter edits a **Constraints form** → `/api/generate-queries` → **Query Preview modal** (edit/remove/add queries, choose depth) → run.
2. **Agent flow** (`src/app/(app)/dashboard/agent/page.tsx`, `src/lib/agent/engine.ts`): a chat copilot. It gathers scope across phases `gathering → scoping → confirming → ready` and builds queries only after an explicit go-ahead. The phase is decided in code (`src/lib/agent/scope.ts` `decidePhase`); the model's opinion can only move it backwards.

**Stack:** Next.js 14 App Router (Node runtime), TypeScript, Tailwind, Auth.js (Google OAuth, DB sessions), Prisma. The datasource is now **PostgreSQL** (it was SQLite; see recent commits). LLM: **DeepSeek** (`deepseek-chat`, temperature 0.1, JSON mode). Search: **SerpAPI**, with an optional headless Playwright Google → DuckDuckGo fallback.

**Deployment caveat that directly affects search:** a search run is started by `POST /api/search-runs`, which returns `202` and then **keeps working in the same Node process** (`src/lib/search/runManager.ts`). That requires a long-lived server (Docker/EC2: see `Dockerfile`, `deploy/`). The last ~10 commits target **Vercel / Wasmer Edge**. On a serverless host the run freezes after the 202 and is reported as failed once its heartbeat is 120 s stale. If search "doesn't work" in production, check this first (see §7, G15).

---

## 2. End-to-end pipeline

```
Requisition (JD file / pasted text / agent chat)
   │
   ▼
[A] Intake & structuring ............ src/lib/ai/client.ts  parseJDWithAI / heuristicParseJD
   │   DeepSeek JD_STRUCTURING prompt + deterministic heuristic, merged field by field
   ▼
MergedConstraints  (recruiter edits in ConstraintsForm, or agent fills it)
   │
   ▼
[B] Vocabulary ...................... deriveQueryTerms (heuristic)  ⊕  DeepSeek XRAY_QUERY_TERMS
   │   mergeQueryTerms(): AI may only ADD synonyms/spellings; hard constraints stay pinned
   ▼
QueryTerms
   │
   ▼
[C] Template filling ................ src/lib/search/xrayTemplates.ts  buildQueryBundle
   │   15 approved templates × selected platforms; each fitted to Google's 32-word budget
   ▼
XRayQuery[] (the "bundle", 4–15 queries)
   │
   ▼
[D] Review ........................... QueryPreviewModal: edit / delete / add custom, choose depth 1–10 pages
   │   (validation exists in queryValidation.ts but is NOT applied here or at run time; see G1)
   ▼
[E] Execution ........................ runManager → x-raySearchService → serp.ts
   │   each query searched individually, 3 at a time; SerpAPI paged 10 results/page up to depth
   ▼
RawSearchResult[] per query (title, url, snippet, thumbnail, position)
   │
   ▼
[F] Indexing ......................... serpIndexer.ts  indexSerpResult
   │   reject non-profile URLs and non-person titles; parse name/headline/location/skills/seniority
   ▼
[G] Scoring .......................... utils/scoring.ts  calculateRelevanceScore (0–100, deterministic)
   ▼
[H] Dedupe & persist ................. utils/deduplication.ts + db/sessions.ts persistRunCandidates
       canonical-URL dedupe + conservative fuzzy name+location; upsert per (job, canonical URL)
```

---

## 3. Stage details: requisition to query bundle

### 3.1 [A] Intake: `MergedConstraints`

`parseJDWithAI` (`src/lib/ai/client.ts:353`):
1. `looksLikeJobDescription` rejects text under 25 words, text with no role/requirements language, or text that looks like a résumé.
2. `heuristicParseJD` (`:424`) always runs. It uses regex for the title (labelled line → "hiring a X" → first short line containing a role noun), role type, seniority, years, city (via the location table), and skills from a fixed list `KNOWN_HARD_SKILLS` (~100 entries). Skills found inside a "requirements / must have" block become must-haves (max 5); the rest become nice-to-haves.
3. With a DeepSeek key, the `JD_STRUCTURING_SYSTEM_PROMPT` (`src/lib/ai/prompts.ts:1`) extracts the same fields plus `target_organizations` / `excluded_organizations`. `mergeStructured` prefers the AI value field by field and falls back to the heuristic value.
4. `constraintsFromStructuredJD` (`:272`) normalises location through `parseLocation`, fills the years band from seniority when missing, picks **default platforms by role type**, and warns when there is no searchable hard skill or no location.

The `MergedConstraints` fields that drive search (`src/lib/types/index.ts:70`):

| Field | Used for |
|---|---|
| `job_title` | role synonyms, `intitle:` title anchoring, headline scoring |
| `role_type` | default platforms, adjacent/discipline terms |
| `seniority` (`Junior…Executive \| Any`) | extra title variant, `AROUND(5)` proximity template, scoring |
| `location`, `remote_eligible` | location terms, geo-TLD, scoring. "Remote" is never put in a query |
| `must_have_skills` | AND'd skill clause (soft skills stripped). Max 2 reach the query |
| `nice_to_have_skills` | **scoring only**, never in queries |
| `domain` | stand-in "topic" clause when there are no hard skills; scoring |
| `additional_details` | free text → `required_phrases` (OR group on every query) and `exclude_terms` (negated on every query) |
| `target_organizations` / `organization_scope` | OR group on every query; `intitle:(…)` on LinkedIn when scope = `current` |
| `excluded_organizations` | `-"name"` on every query |
| `selected_platforms` | which templates run |
| `results_cap` | stored on the run, **never enforced** (G6) |

Default platforms (`defaultPlatformsForRole`, `client.ts:106`):
- Engineering → LinkedIn, GitHub, StackOverflow, Wellfound, MultiSite
- Design → LinkedIn, Behance, Dribbble, Wellfound, Resumes
- Everything else → LinkedIn, Wellfound, **Xing**, Resumes (Xing is included regardless of location; see G8)

### 3.2 [B] Vocabulary: `QueryTerms`

`QueryTerms` (`src/lib/search/xrayTemplates.ts:17`) is the only input templates see:

```
role_synonyms[]        3–6 title variants; [0] is the JD title itself
must_have_skills[]     hard skills only (isSoftSkill() strips ~60 soft skills + /skills?|ability|mindset/)
domain_terms[]         industry phrases; stand in for skills when there are none
skill_synonyms{}       { React: ['ReactJS','React.js'] }
role_adjacent_terms[]  lower-case GitHub-bio words ('backend','machine learning')
discipline_terms[]     Behance/Dribbble disciplines ('UI Design','Brand Identity')
seniority_term         one word for AROUND(5), or null (Mid/Any → null)
location_terms[]       city + alias spellings (never 'Remote')
remote                 bool (informational; not used in any query)
geo_tld                '.de', '.in', '.co.uk', … or '' → xing_geo skipped
required_phrases[]     from additional_details; 'a|b' = alternatives
exclude_terms[]        from additional_details only
target_orgs[], excluded_orgs[], org_scope
```

**Heuristic vocabulary** `deriveQueryTerms` (`:774`):
- `roleVariants`: title, seniority-prefixed title, one swap (Engineer↔Developer, UX↔Product Designer, Data Scientist→ML Engineer, DevOps→SRE, PM→Product Owner), the base title without seniority, and "Lead X" for Senior/Staff/Lead. Titles outside these patterns (e.g. "AI Consultant", "Account Executive") get **only one variant**.
- `SKILL_SYNONYMS`: a small fixed table (~27 entries).
- `parseLocation` (`src/lib/search/location.ts:188`): a table of ~70 cities with aliases, ~24 countries with ccTLDs, and region groups (NCR, DACH, Bay Area). Unknown towns pass through as raw terms.
- `parseAdditionalDetails` (`:683`) is a deliberately conservative parser. Quoted phrases and "must have/mention X" become required phrases; "only X or Y" becomes the alternatives group `X|Y`; a sentence starting "no/not/exclude/avoid/without" turns every list item into an exclusion. Sentences containing prefer/ideally/e.g./such as/like are ignored.

**AI vocabulary:** `XRAY_QUERY_TERMS_SYSTEM_PROMPT` (`prompts.ts:54`) tells DeepSeek it **does not write query strings**. It only supplies vocabulary.

**Merge rules** `mergeQueryTerms` (`:844`). These are trust boundaries:
- `must_have_skills` stay **pinned** to the recruiter's list. The AI can only add synonyms for skills already on it (max 3 each).
- AI `role_synonyms` are used only if it returns ≥2; `base[0]` (the JD title) is always kept first.
- AI `exclude_terms` survive only if `isGroundedIn` the recruiter's details text (shared ≥4-char stem) and are not a respelling of a heuristic exclusion. With an empty details box, the AI can add no exclusions.
- `target_orgs`, `excluded_orgs` and `org_scope` cannot be changed by the AI.
- AI `location_terms`, `discipline_terms`, `role_adjacent_terms` and `seniority_term` replace the heuristic values when present. AI `geo_tld` is accepted if it matches `^\.[a-z]{2,}(\.[a-z]{2,})?$`.
- `required_phrases` are a union (AI ∪ heuristic), max 3.

### 3.3 [C] Templates

The **only** place a query string is ever assembled is `XRAY_TEMPLATES` (`xrayTemplates.ts:293`): 15 templates over 9 platforms. `buildQueryBundle` (`:536`) emits one query per applicable template per selected platform. A template returns `null` (and is skipped) when it doesn't apply.

**Clause helpers** (what each `{…}` becomes):

| Helper | Rule |
|---|---|
| `orGroup(terms, max)` | `("a" OR "b")`, or `"a"` for one term; every term is quoted |
| `rolesClause` | OR of up to 5 role synonyms |
| `baseRolesClause` | OR of up to 4 synonyms with seniority words stripped |
| `skillsClause` (`:133`) | **First 2** must-have skills, each as `("skill" OR "synonym")`, AND'd by a space. If >1 skill is ≥3 words long, the whole clause becomes one OR group of up to 4. The 3rd and later skills are **silently dropped** from queries |
| `topicClause` | `skillsClause`, or else an OR of up to 3 `domain_terms` |
| `locationClause` | OR of up to 3 location spellings; never "Remote" |
| `requiredClause` | ONE OR group of all required phrases (`a\|b` expanded), max 4 |
| `excludeClause` | `-word` / `-"multi word"` for up to 6 exclusions + 4 excluded orgs |
| `orgClause` | OR of up to 6 target orgs; on LinkedIn with scope `current` → `intitle:(…)`. Inserted right after the leading `site:`/`filetype:` operator |

**The 15 templates** (L = includes the location clause):

| id | Platform | Shape | Skipped when |
|---|---|---|---|
| `linkedin_broad` | LinkedIn | `site:linkedin.com/in/ {roles} {topic} {required} {location}ᴸ -intitle:job -intitle:hiring -intitle:recruiter {excl}` | — |
| `linkedin_title` | LinkedIn | `site:linkedin.com/in/ intitle:{baseRoles} {topic} {required} -intitle:job … {excl}` | — |
| `linkedin_proximity` | LinkedIn | `site:linkedin.com/in/ "{seniority}" AROUND(5) {baseRoles} {topic} {required} {excl}` | no seniority term |
| `linkedin_pdf` | LinkedIn | `site:linkedin.com/in/ {roles} {required} filetype:pdf {excl}` | — (see G2) |
| `github_bio` | GitHub | `site:github.com {skills} {adjacent} {required} -intitle:job {excl}` | no hard skills |
| `github_location` | GitHub | `site:github.com {skills} {required} {location}ᴸ {excl}` | no hard skills or no location |
| `stackoverflow_skills` | StackOverflow | `site:stackoverflow.com/users {skills} {required} {excl}` | no hard skills |
| `stackoverflow_passive` | StackOverflow | same + `-"looking for job" -hiring` | no hard skills |
| `wellfound_role` | Wellfound | `site:wellfound.com {roles} {topic} {required} {location}ᴸ {excl}` | — |
| `behance_discipline` | Behance | `site:behance.net {disciplines} {topic} {required} {excl}` | — |
| `dribbble_discipline` | Dribbble | `site:dribbble.com {disciplines} {topic} {required} {excl}` | — |
| `xing_profile` | Xing | `site:xing.com/profile {roles} {topic} {required} {excl}` | — |
| `xing_geo` | Xing | `site:{geo_tld} {roles} {topic} {required} {excl}` | empty `geo_tld` |
| `resume_pdf` | Resumes | `filetype:pdf {roles} {topic} {required} ("resume" OR "CV" OR "curriculum vitae") {location}ᴸ {excl}` | — |
| `resume_presentations` | Resumes | `(filetype:ppt OR site:slideshare.net) {skillsAsTopics\|domain} {required} intitle:{baseRoles} {excl}` | — |
| `multisite_pass` | MultiSite | `(site:linkedin.com/in/ OR site:github.com OR site:stackoverflow.com/users) {roles} {topic} {required} {excl}` | — |

Only **4 of 15** templates carry location. Bundle sizes: Engineering defaults ≈ 10 queries, Design ≈ 9, other ≈ 8–9.

### 3.4 The 32-word budget

Google ignores everything after the 32nd word, and every word inside a quoted phrase counts (`countGoogleWords`, `:232`: strips parens, splits on whitespace, so operators count as one word each). `fitToBudget` (`:247`) rebuilds each template with progressively trimmed vocabulary until it fits, in this order: drop skill synonyms → 3 role synonyms → 1 location / 2 domain terms → 2 skills → 2 roles/disciplines/adjacent → 3 exclusions / 2 excluded orgs → 4 target orgs → 2 required phrases → 3 target orgs → 1 role + 1 skill. Cosmetic breadth goes first; recruiter intent goes last.

### 3.5 [D] Validation and review

`src/lib/search/queryValidation.ts` is a thorough pure validator. **Errors:** empty, <10 or >2048 chars, unbalanced quotes/parens, empty groups, no `site:`/`filetype:`/`inurl:` anchor, malformed or not-allowed `site:` host for the platform (bare ccTLDs only for Xing), doubled/dangling operators, bare `-`. **Bundle-level errors:** near-duplicate (token-set Jaccard ≥ 0.92), over 15 queries per run, over 4 per platform. **Warnings:** >32 words, deprecated operators.

**It is only called by `POST /api/search/estimate`, and no UI code calls that route. `POST /api/search-runs` and `runManager` never validate.** A query hand-edited in the modal goes to SerpAPI as typed (G1).

In the Query Preview modal (`src/components/ingestion/QueryPreviewModal.tsx`), each row shows the template label, the approved pattern, a pill view of the query, and a live `n / 32 words` counter. A custom query defaults to LinkedIn. **Depth** (1–10 pages, default 5) is one global setting for every query; the footer shows `≤ queries × depth` credits.

---

## 4. Stage details: execution

### 4.1 Run orchestration

- `POST /api/search-runs` (`src/app/api/search-runs/route.ts`) resolves the user's stored SerpAPI key (falling back to the env `SERPAPI_KEY`) and refuses if there is none. It then calls `startSearchRun`.
- `startSearchRun` (`runManager.ts:50`) saves constraints and bundle to the session, sets the session to `searching`, creates a `SearchRun` row plus one `SearchRunQuery` per query (storing a djb2 hash of the canonical query string that nothing reads yet), then fires `driveRun` without awaiting it and returns the run id.
- `executeXRaySearch` (`x-raySearchService.ts:123`):
  - `sanitizeQueries`: unknown platforms (e.g. a retired "Naukri" in an old session) and empty strings → `skipped`.
  - `mapWithConcurrency(…, SERP_CONCURRENCY = 3)`.
  - **Abort** is co-operative: checked before each query starts. A query already sent is allowed to finish, because it is already paid for.
  - Progress hooks write each query's start and finish to the DB. The UI polls `GET /api/search-runs` every 1.5 s.

### 4.2 SerpAPI call (`src/lib/search/serp.ts`)

Request params (`fetchSerpApiPage`, `:89`): `engine` (`google`, or `google_light` via env), `q`, `num=10`, `start`, `hl=en`, `safe=off`. **No `gl`, `google_domain`, `location` or `lr`**, so every search runs from SerpAPI's default (US) vantage point regardless of the requisition's country (G4). Timeout 55 s.

Paging (`searchWithSerpApi`, `:148`): fetch page 1. Stop if it returned 0 results, more than 10 results, or no `serpapi_pagination.next`. Otherwise walk `start=10,20,…` until `maxPagesPerQuery` (default 5, env `SERP_MAX_PAGES_PER_QUERY`, hard cap 10), until a page adds no new URL, or until there is no next link. **Credits = pages fetched.** A query with 23 real results costs 3 credits. A query with thousands of loosely matching results always costs the full depth, however few of those results survive indexing (G7).

Errors: SerpAPI's "hasn't returned any results" counts as an empty page, not an error. Other errors get up to 3 attempts with 2–3 s and 4–5 s backoff, then fall back to Playwright (headless Google with `num=100`, then DuckDuckGo HTML; one page; usually captcha-walled; DDG ignores most operators). `describeSearchInformation` captures Google's own explanation of an empty result (`organic_results_state`, `total_results`, `spelling_fix`), so the run receipt can explain why a query returned 0.

### 4.3 [F] Indexing a result → candidate (`src/lib/search/serpIndexer.ts`)

`indexSerpResult` (`:315`). The platform is re-derived from the URL (`detectPlatformFromUrl`), because MultiSite, Xing-geo and Resumes return mixed hosts. A result is **dropped** only if it fails one of these:
1. **URL gate** `isCandidateProfileUrl` (`:59`): global path blocklist (`/jobs/`, `/company/`, `/pulse/`, `/posts/`, `/search`, `/login`, …), plus per platform: LinkedIn needs `/in/<slug>`; GitHub's first path segment must not be reserved (repo URLs are kept and collapsed to the owner); StackOverflow needs `/users/<id>`; Dribbble rejects `/shots/` and `/tags/`; Behance rejects `/galleries` and `/joblist`; Wellfound rejects `/jobs` and `/role/`; Xing requires `/profile/` on xing.com but accepts any other host from the geo sweep.
2. **Title gates**: `isNonPersonTitle` rejects job-post words (hiring, jobs, vacancy, apply, internship, naukri…) and article/template words (guide, tips, top N, template, sample, course…, tested per dash-separated segment). For **low-precision sources** (Resumes, non-Xing hosts from `site:.tld`, `github.io`) the title must also `looksLikePersonTitle`: it must start with 2–4 capitalised words, not an all-caps acronym, and not an org word (Inc, Ltd, Technologies, University, Agency…).
3. A parsed name that is itself an org name is rejected.

Extraction uses **only** the title + snippet: name/headline from the title format ("Name – Title – Company | LinkedIn"); skills = regex match of must-have **and** nice-to-have skills in title+snippet; location = LinkedIn snippet lead ("Bengaluru, Karnataka, India · …"), else the city table, else "Remote", else a country, else `Location not specified`; seniority word from the headline; years from "N+ years"; `data_completeness` is a 0–1 heuristic. `scrape_status` is always `snippet_only`.

### 4.4 [G] Scoring (`src/lib/utils/scoring.ts:40`, deterministic, no LLM)

| Component | Max | Rule |
|---|---|---|
| Must-have skills | 35 | matched hard must-haves ÷ all hard must-haves × 35. With **no** hard must-haves: 28 if a domain word is in headline/skills, else 17 |
| Nice-to-have | 10 | matched ÷ (nice-to-have + soft must-haves) × 10; 7 if the list is empty |
| Title + seniority | 20 | title: 12 exact base title in headline, 10 core noun + modifier, 6 core noun (or engineer↔developer), 0 otherwise. Seniority: 8 match, 7 senior-ish, 6 if Any, 4 unknown, 2 contradicted |
| Location | 15 | 15 same city (alias-aware) or remote-OK; 11 same country; 8 unknown; 4 mismatch |
| Domain | 10 | 10 if a domain string is in headline/skills, else 8 |
| Organisation | 10 | 10 if no orgs required, or a target org in the title (current employer); 9/6 if only in the snippet (scope any/current); 0 if none found or an excluded org appears |

Tiers: **Strong ≥ 70, Potential 40–69, Low < 40** (`src/lib/utils/tier.ts`). Scores are used **only for sorting and filtering**. By contract, a low score never removes a candidate.

Note: must-have evidence comes from the snippet, which often omits skills the query forced onto the page. Strong profiles can therefore score lower than they should (G14).

### 4.5 [H] Dedupe & persistence

- `deduplicateCandidates` (`src/lib/utils/deduplication.ts:59`): exact canonical URL (LinkedIn country subdomains folded, GitHub repo → owner, SO `/users/<id>`), then a fuzzy match (Levenshtein ≤ 2 on the name **and** overlapping location), applied only when both names are real, multi-word names and both locations are known. On a merge, skills are unioned and the higher score is kept.
- `persistRunCandidates` (`src/lib/db/sessions.ts:266`): upsert on `(jobId, profileUrlCanonical)`, so re-running a session refreshes existing cards (location is overwritten only when the new run found one) and adds new ones. The session becomes `complete`. **`results_cap` is not applied anywhere.**
- Run status: `completed` (all queries completed), `partial`, `failed`, or `aborted`. The receipt stores per-query `resultCount` (organic results), `keptCount` (indexed), `creditCost`, provider and error/notice. **This per-query yield data is the raw material for optimisation (§8.5).**

---

## 5. Cost model (today)

```
credits per run  ≤  Σ over queries  min(depth, pages until a short page / no next link)
default depth    =  5 pages  (= up to 50 results per query)
typical bundle   =  8–10 queries
worst case       ≈  40–50 credits per run at default depth (150 at max depth 10 × 15 queries)
```

There is no cache, so re-running an identical query costs the same again. The `SerpQueryCache`, `CreditPeriod` and `CreditLedger` tables exist in `prisma/schema.prisma` but **no code reads or writes them**. There is no budget check before a run.

---

## 6. Real generator output (heuristic path, no DeepSeek)

Generated by calling `generateQueryBundleForConstraints` + `validateBundle` on three requisitions. With a DeepSeek key, role synonyms, location spellings and disciplines would be richer; the structure would be identical.

**Case 1: Senior Backend Engineer, Bengaluru; must-have Go, Kubernetes, PostgreSQL; domain FinTech; details "No agencies or freelancers."** (10 queries, all pass validation)
```
[linkedin_broad 28w]  site:linkedin.com/in/ ("Senior Backend Engineer" OR "Backend Developer" OR "Backend Engineer" OR "Lead Backend Engineer") ("Go" OR "Golang") ("Kubernetes" OR "K8s") ("Bengaluru" OR "Bangalore") -intitle:job -intitle:hiring -intitle:recruiter -agencies -freelancers
[linkedin_title 18w]  site:linkedin.com/in/ intitle:("Backend Engineer" OR "Backend Developer") ("Go" OR "Golang") ("Kubernetes" OR "K8s") -intitle:job -intitle:hiring -intitle:recruiter -agencies -freelancers
[linkedin_proximity]  site:linkedin.com/in/ "Senior" AROUND(5) ("Backend Engineer" OR "Backend Developer") ("Go" OR "Golang") ("Kubernetes" OR "K8s") -agencies -freelancers
[linkedin_pdf]        site:linkedin.com/in/ ("Senior Backend Engineer" OR …) filetype:pdf -agencies -freelancers
[github_bio]          site:github.com ("Go" OR "Golang") ("Kubernetes" OR "K8s") ("backend" OR "developer" OR "fintech") -intitle:job -agencies -freelancers
[github_location]     site:github.com ("Go" OR "Golang") ("Kubernetes" OR "K8s") ("Bengaluru" OR "Bangalore") -agencies -freelancers
[stackoverflow_*]     site:stackoverflow.com/users ("Go" OR "Golang") ("Kubernetes" OR "K8s") [-"looking for job" -hiring] -agencies -freelancers
[wellfound_role]      site:wellfound.com (4 titles) ("Go" OR "Golang") ("Kubernetes" OR "K8s") ("Bengaluru" OR "Bangalore") -agencies -freelancers
[multisite_pass]      (site:linkedin.com/in/ OR site:github.com OR site:stackoverflow.com/users) (4 titles) ("Go" OR "Golang") ("Kubernetes" OR "K8s") -agencies -freelancers
```
Observations: PostgreSQL silently dropped (2-skill cap); 6 of 10 queries have no location, so they return profiles worldwide for a Bengaluru role; `"Go"` is a near-useless quoted term; exclusions are literal plurals; `linkedin_pdf` targets PDFs on a host that serves none.

**Case 2: AI Consultant, Kolkata; must-haves were all soft skills; domain AI / GenAI.** (8 queries)
```
[linkedin_broad]   site:linkedin.com/in/ "AI Consultant" ("Artificial Intelligence" OR "Machine Learning" OR "Generative AI") ("Kolkata" OR "Calcutta") -intitle:job -intitle:hiring -intitle:recruiter
[linkedin_pdf]     site:linkedin.com/in/ "AI Consultant" filetype:pdf
[xing_profile]     site:xing.com/profile "AI Consultant" (…AI terms…)          ← Xing for a Kolkata role
[xing_geo]         site:.in "AI Consultant" (…AI terms…)                       ← entire .in web
[resume_pdf]       filetype:pdf "AI Consultant" (…) ("resume" OR "CV" OR "curriculum vitae") ("Kolkata" OR "Calcutta")
…
```
Observations: soft-skill stripping and domain fallback work as designed. Only one title variant without the AI; Xing is wasted spend for India.

**Case 3: Account Executive, London; must-have B2B Sales, Salesforce; currently at Salesforce or HubSpot; exclude Acme; details: Must mention "SaaS". Not interested in interns.**
```
[linkedin_broad]  site:linkedin.com/in/ intitle:("Salesforce" OR "HubSpot") "Account Executive" "B2B Sales" "Salesforce" "SaaS" ("London" OR "Greater London") -intitle:job -intitle:hiring -intitle:recruiter -interns -Acme
[xing_geo]        site:.co.uk ("Salesforce" OR "HubSpot") "Account Executive" "B2B Sales" "Salesforce" "SaaS" -interns -Acme
```
Observations: "Salesforce" is both a target org and a must-have skill, so HubSpot employees must also mention Salesforce. That's a redundant, over-narrow AND. Every must-have, required phrase and org stacks into one very narrow conjunction. For a **US** location the geo-TLD is `.com` (`location.ts:32`), which produces `site:.com …`. That passes validation and is almost unscoped.

`parseAdditionalDetails("Prefer fintech. Must have payments experience. Only BCG or Bain. No agencies, freelancers or interns.")` → `required_phrases: ["BCG|Bain", "payments"]`, `exclude_terms: ["agencies","freelancers","interns"]`. Required phrases are OR'd, so "payments" **or** BCG/Bain satisfies the requirement, which is weaker than what the recruiter wrote.

---

## 7. Known gaps that hurt search quality or cost

Ranked by impact on "the search works and spends credits well". **Confirmed** = verified in code (and in §6 output). **Verify** = behaviour of Google itself that should be checked with a one-credit probe before acting on it.

| # | Gap | Evidence | Status |
|---|---|---|---|
| G1 | **Validation is never enforced.** Malformed, duplicate or hand-broken queries reach SerpAPI and cost credits. | `validateBundle` is used only in `/api/search/estimate`, which no client calls; `runManager`/`search-runs` don't validate | Confirmed |
| G2 | **`linkedin_pdf` is structurally empty.** `site:linkedin.com/in/` pages are HTML profiles; `filetype:pdf` there should return ~0. It runs on every LinkedIn bundle. | template at `xrayTemplates.ts:350` | Verify (high confidence) |
| G3 | **Location is absent from 11 of 15 templates**, so most queries for a city-bound role return worldwide results. Scoring demotes them, but the credits are spent. | §3.3 table | Confirmed |
| G4 | **No SerpAPI geo parameters** (`gl`, `google_domain`, `location`). Google ranks from a US vantage point, which hurts local ranking for India/EU/UK roles. | `serp.ts:96` | Confirmed (impact: verify) |
| G5 | **No query cache, credit ledger or budget.** Schema tables exist but are unused; identical re-runs pay again. | grep shows no references | Confirmed |
| G6 | `results_cap` is collected in the UI and stored, never applied. | `ConstraintsForm.tsx:289`, `runManager.ts:68` | Confirmed |
| G7 | **Depth is uniform and blind to yield.** Every query walks up to N pages even when page 1 showed that 0 of 10 results survive indexing. | `searchWithSerpApi` stops only on a short page, no new URL, or no next link | Confirmed |
| G8 | **Geo-TLD and Xing misuse.** Xing is a default for every non-eng/design role; the AI prompt says to use `.de` when the location is unknown (`prompts.ts:81`); US maps to `.com`. | §6 cases 2–3 | Confirmed |
| G9 | **Skill selection is positional, not discriminative.** The first 2 must-haves in JD order are AND'd, the rest dropped. Generic or ambiguous skills ("Go", "SQL", "Excel", "REST") can take the slots of rare, discriminating ones. | `skillsClause` | Confirmed |
| G10 | **Clause collisions and over-stacking.** An org that is also a skill is AND'd twice; must-haves + required phrase + org + location can all stack into one ultra-narrow query, with nothing to relax it automatically when it returns 0. | §6 case 3 | Confirmed |
| G11 | **Exclusions are literal recruiter wording** (`-agencies`, `-interns`) and apply to every query. Plural forms may not exclude singular mentions, and a broad negative on LinkedIn can remove real candidates who merely mention the word. | `excludeClause`; §6 | Verify (Google `-` stemming) |
| G12 | **Weak heuristic title synonyms** for non-engineering titles when DeepSeek is unavailable or fails (one variant for "AI Consultant", "Account Executive"). | `roleVariants` swaps list | Confirmed |
| G13 | **No per-requisition planning.** Every applicable template runs at the same depth, in the same order, whatever the requisition's archetype, location or scarcity. | `buildQueryBundle` | Confirmed |
| G14 | **Scoring evidence is snippet-only**, while queries enforce terms on the full page. A profile that matched `("Go" OR "Golang") ("Kubernetes" OR "K8s")` may show neither in its snippet and lose up to 35 points. Must-have scoring also counts all hard must-haves while the query enforced only 2. | `scoring.ts:54-89` | Confirmed |
| G15 | **Background runs need a long-lived process.** The recent Vercel/Wasmer Edge commits conflict with `driveRun`'s fire-and-forget design. | `runManager.ts:19-32`, git log | Confirmed design risk; deployment target unknown |
| G16 | `AROUND(5)` is undocumented Google behaviour, applied here to a parenthesised OR group; DuckDuckGo ignores it. `intitle:(A OR B)` grouping is also only loosely supported. | templates | Verify |
| G17 | Wellfound / Dribbble yield is likely low: bare `site:wellfound.com` mixes company and job pages (individual profiles typically live under `/u/<handle>`, to verify); Dribbble results are mostly `/shots/`, which the indexer rejects. | indexer gates | Verify |
| G18 | Doc drift. `HANDOFF.md` says concurrency 4 and up to 16 queries (code: 3 and 15). The PRD lists Naukri/Indeed/Bitbucket (retired) and an LLM scoring pass (scoring is deterministic). The `serp.ts` header says page 1 asks for 100 (it asks for 10). A comment says "one retry" (code makes 3 attempts). | — | Confirmed |

---

## 8. Planning framework for optimal per-requisition queries

The goal: **maximise unique, on-target profiles per credit.** "On-target" means a profile that passes the indexer and would land in the Strong/Potential tiers. Everything below is a proposal for the planning agents. Nothing here is implemented.

### 8.1 Step 1: classify the requisition (archetype)

| Archetype | Signal in `MergedConstraints` | Implication |
|---|---|---|
| **A. Technical IC** | role_type Engineering, ≥2 concrete hard skills | GitHub/SO useful; skills are strong discriminators; LinkedIn title + skill + location is the precision core |
| **B. Design** | role_type Design | Behance/Dribbble profile pages, LinkedIn title; disciplines over tools |
| **C. Non-technical / soft-skill** | 0 hard must-haves after `isSoftSkill`, domain present | Title + domain + location on LinkedIn carry everything; GitHub/SO are useless; resumes moderately useful |
| **D. Org-constrained** | `target_organizations` non-empty | Org clause is the strongest filter. Reduce other ANDs; use `intitle:` org only when scope = current |
| **E. Leadership / exec** | seniority Lead/Executive, or titles like Head/Director/VP | Small population: title variants matter more than skills; presentations/SlideShare become relevant |
| **F. Location-critical** | specific city, not remote | Location must be in every LinkedIn query (or use a country subdomain, §8.3); geo params on SerpAPI |
| **G. Remote / multi-country** | remote_eligible with no city, or several countries | Drop location from queries; lean on title + skill precision; never use geo-TLD sweeps |

A requisition can match several archetypes (e.g. A + D + F).

### 8.2 Step 2: choose platforms deliberately

- Never include **Xing** unless the country is Germany, Austria or Switzerland (or the recruiter asked for it). Never run `xing_geo` with `.com`, and never with a `.de` the AI picked by default for an unknown location.
- GitHub/SO only when there are concrete technical skills (already enforced by `null` returns), and preferably only where the skill is something developers publish (languages, frameworks, infra), not tools like Jira.
- Drop `linkedin_pdf` (or prove with one probe that it ever returns anything).
- Behance/Dribbble only for visual/brand/UI disciplines; for UX research or service design, LinkedIn dominates.
- MultiSite duplicates LinkedIn/GitHub/SO coverage. Run it only when the bundle omits one of those platforms, or as a final recall pass.

### 8.3 Step 3: choose terms that discriminate

**Titles**
- Build a *title ladder*: exact JD title → base title (seniority stripped) → 2–4 genuine market synonyms → (for recall only) adjacent titles. Quote titles; they're the strongest LinkedIn signal because the page title is "Name – Title – Company".
- For Executive/Lead roles, include the "Head of X" / "Director of X" / "VP X" forms explicitly rather than relying on `AROUND(5)`.

**Skills**
- Rank must-haves by **discriminative power**, not JD order: rare, specific skills first (e.g. "Kafka", "Terraform", "Figma"); demote generic ones ("SQL", "Excel", "Agile", "REST", "Git") that nearly every profile in the field carries. Two discriminating skills AND'd beats three generic ones.
- Replace ambiguous one-word skills with their unambiguous forms: `"Go"` → `"Golang"` (or `"Go developer"`); `"R"` → `"R programming"` / `"RStudio"`; `"C"` → `"C programming"`; `"Rust"` is fine; `"Spark"` → `"Apache Spark"`.
- Never put a target organisation's name in the skill clause as well (dedupe across clauses; see §6 case 3).
- Use the 3rd+ must-haves in *alternate* queries (a different skill pair per query) instead of dropping them silently. This spreads coverage across the AND space.

**Location (city-bound roles)**
- Put city spellings in **every** LinkedIn and Wellfound query, not only `linkedin_broad`. The LinkedIn snippet leads with the profile location, so the term matches reliably.
- Consider LinkedIn **country subdomains** as a cheap, high-precision location filter: e.g. `site:in.linkedin.com/in/` for India or `site:uk.linkedin.com/in/` for the UK. The validator already accepts `*.linkedin.com`, and the indexer already folds subdomains into one canonical URL. **Verify** with a probe that Google still indexes public profiles under these hosts for the target country.
- Pass SerpAPI `gl` (country code) and/or `google_domain` (e.g. `google.co.in`) from the parsed country. This is a small change in `fetchSerpApiPage`.
- Never put "Remote" in a query (current behaviour is correct: it matches almost everyone).

**Required phrases & exclusions**
- Treat "must mention X" and "only BCG or Bain" as **separate AND'd groups**, not one OR group. Today they are OR'd together (see the `parseAdditionalDetails` example at the end of §6). Keep `a|b` alternatives as OR inside their own group.
- Normalise exclusions to a stem-safe form, and add singular/plural pairs only where both are short: `-agency -agencies`, `-intern -interns`. Or keep exclusions off recall-oriented queries where they mainly cut real candidates. Keep the rule that **only recruiter-written exclusions** are allowed (§9).
- Keep `-intitle:job -intitle:hiring -intitle:recruiter` on LinkedIn; the indexer gates catch the remaining job posts.

### 8.4 Step 4: a precision ladder instead of a flat bundle

For each selected platform, plan queries as tiers rather than "every template once":

```
P1  High precision  (run first, deepest)
    LinkedIn: site:<country>.linkedin.com/in/ intitle:("Exact Title" OR "Base Title") <skill1> <skill2> <city> -intitle:job -intitle:hiring -intitle:recruiter
P2  Medium          (run if P1 yields < target)
    LinkedIn broad: title synonyms OR'd (not intitle), 1–2 skills, city
    Alternate skill pairs: (skill1, skill3), (skill2, skill3)
P3  Recall          (run only if P1+P2 under-fill)
    resume_pdf with city; github_location; multisite; adjacent titles
```

Each tier has an expected yield, and the planner moves down the ladder only while the run is under its target candidate count (this is a natural use of `results_cap`, see G6).

### 8.5 Step 5: probe, measure, adapt (the biggest credit lever)

1. **Probe page 1 of every P1/P2 query** (1 credit each). After the page, compute:
   - `organic` = results returned; `total_results` from `search_information` (already captured in `notice`, but as a string; store it as a number);
   - `yield` = indexed ÷ organic (profile-shaped and person-titled);
   - `onTarget` = Strong + Potential among the indexed.
2. **Branch:**
   - `organic == 0` → **relax** one notch: drop the weakest skill → drop the required phrase → widen the title from intitle to plain → drop the location (last). Re-probe once. Cap relaxations at 2 per query.
   - `yield < ~30%` on page 1 → **don't page deeper**. Tighten instead (add `intitle:`, add location, use the country subdomain), or abandon the query.
   - `yield` high and `total_results` large → page deeper, up to depth.
   - The run's unique on-target count has reached `results_cap` → stop scheduling new pages or queries.
3. **Per-query depth** replaces the single global depth. Default: P1 = 5 pages, P2 = 3, P3 = 1–2.
4. **Cache** every SerpAPI page by `(engine, canonical query, start, gl)` with a TTL (e.g. 7 days) in `SerpQueryCache`. Count a cache hit as 0 credits. `canonicalizeQueryString` is already designed as the cache key.
5. **Pre-run budget check**: read `plan_searches_left` (already available via `verifySerpApiKey`) and size the plan to fit.

### 8.6 Step 6: learn which templates work

Every run already stores per-query `resultCount`, `keptCount` and `creditCost` in `SearchRunQuery`. Add the per-query count of Strong/Potential candidates (via `sourceQueryId` on `Candidate`) and the count of **new** unique candidates (not already found by an earlier query). Then aggregate by `(query_type, archetype, country)` to get:
- `indexed per credit`, `on-target per credit`, `new-unique per credit`.

Use these to reorder and prune templates per archetype over time. For example, if `stackoverflow_passive` almost never adds unique profiles beyond `stackoverflow_skills`, stop running both.

### 8.7 Step 7: make the run path safe

- Run `validateBundle` inside `POST /api/search-runs` (or `startSearchRun`) and skip `ok: false` queries as `skipped` with their issue messages. This mirrors what `/api/search/estimate` already computes.
- Show validation issues live in the Query Preview modal (the builder already has an `isBalanced` hint).
- Add bundle-level checks for the new rules: no `site:.com`, no Xing outside DACH, no clause duplication between orgs and skills.

### 8.8 Planner output contract (suggested)

If a planning agent is introduced, keep the current trust model: **the agent proposes vocabulary and a plan; code assembles the strings.** A suggested per-requisition plan object:

```jsonc
{
  "archetype": ["technical_ic", "location_critical"],
  "country": { "name": "India", "gl": "in", "linkedin_subdomain": "in" },
  "platforms": ["LinkedIn", "GitHub", "Wellfound"],
  "title_ladder": { "exact": ["Senior Backend Engineer"], "base": ["Backend Engineer"], "synonyms": ["Backend Developer", "Server-side Engineer"] },
  "skills_ranked": [ { "skill": "Kubernetes", "aliases": ["K8s"], "discriminative": "high" },
                     { "skill": "Go", "aliases": ["Golang"], "query_form": "Golang", "discriminative": "high" },
                     { "skill": "PostgreSQL", "aliases": ["Postgres"], "discriminative": "medium" } ],
  "skill_pairs": [["Kubernetes","Go"], ["Go","PostgreSQL"]],
  "location_terms": ["Bengaluru", "Bangalore"],
  "required_groups": [],                // each group AND'd; alternatives OR'd inside
  "exclusions": ["agency", "agencies", "freelancer", "freelancers"],   // recruiter-grounded only
  "tiers": [ { "tier": "P1", "templates": ["linkedin_title_loc"], "depth": 5 },
             { "tier": "P2", "templates": ["linkedin_broad", "wellfound_role"], "depth": 3 },
             { "tier": "P3", "templates": ["github_location", "resume_pdf"], "depth": 1 } ],
  "target_candidates": 50,
  "credit_budget": 25
}
```

---

## 9. Invariants a redesign must keep

These are deliberate product decisions encoded in the code and comments:

1. **Code assembles query strings; the LLM only supplies vocabulary.** Templates are the single place strings are built, so the bundle can never drift outside approved shapes or platforms.
2. **The recruiter's hard constraints are pinned.** The model cannot add must-have skills, organisations or exclusions. Model exclusions survive only if grounded in the recruiter's own words (`isGroundedIn`).
3. **No hallucinated or fetched data.** Candidates come only from SERP title/snippet/URL. No profile scraping, no login-wall access.
4. **A low score never hides a candidate.** Only non-profile URLs, non-person titles and true duplicates are removed. Filtering is the recruiter's choice in the UI.
5. **Each query is searched individually** and has its own receipt row (credits, results, kept, error/notice). Never merge queries into one mega-query.
6. **No protected characteristics** (age, gender, race, religion, nationality, disability, family status) in any term. See `xray-search-query-generator.skill` → `references/guardrails.md`.
7. **"Remote" is never a query term.** Soft skills are never query terms.
8. **Respect Google's 32-word limit**, and trim breadth before intent.
9. **Consent before spend** in the agent flow: no queries before full scope plus an explicit go-ahead.
10. **Abort never wastes a paid call**: a query in flight finishes; no new ones start.

---

## 10. Open questions for the product owner

1. **Where is production deployed?** If it's Vercel/Wasmer Edge, background runs need a queue before anything else matters (G15).
2. **Target candidate count per run**: should `results_cap` become the stopping rule for the adaptive executor (§8.5)?
3. **Credit budget per run**: a fixed cap, a fraction of `plan_searches_left`, or recruiter-chosen?
4. **Required phrases semantics**: should "must mention X" plus "only BCG or Bain" mean X AND (BCG OR Bain)? Today it means X OR BCG OR Bain.
5. **Country focus**: which countries matter most? Most city/alias tables are India-heavy, then DACH/UK/US. This decides where LinkedIn-subdomain and `gl` probing should start.
6. **Is DeepSeek always available in production?** If not, the heuristic title-synonym table (G12) needs expanding for non-engineering roles.

---

## 11. File map (search-relevant)

| Concern | File |
|---|---|
| Types (`MergedConstraints`, `XRayQuery`, `CandidateProfile`) | `src/lib/types/index.ts` |
| JD parsing, platform defaults, AI vocabulary call | `src/lib/ai/client.ts` |
| LLM prompts (JD structuring, query vocabulary, agent, outreach) | `src/lib/ai/prompts.ts` |
| Vocabulary, templates, word budget, details parser, merge rules | `src/lib/search/xrayTemplates.ts` |
| Platform registry & URL → platform | `src/lib/search/platforms.ts` |
| Location table & parsing | `src/lib/search/location.ts` |
| Validator (not wired into the run path) | `src/lib/search/queryValidation.ts`, `src/app/api/search/estimate/route.ts` |
| Pill tokenizer used by the editors | `src/lib/search/queryTokens.ts` |
| Depth config | `src/lib/search/serpConfig.ts` |
| SerpAPI client, paging, retries, fallback | `src/lib/search/serp.ts`, `src/lib/search/playwrightSearch.ts` |
| Orchestrator (concurrency, abort, dedupe, stats) | `src/lib/search/x-raySearchService.ts` |
| Background run worker | `src/lib/search/runManager.ts`, `src/lib/db/searchRuns.ts`, `src/lib/search/runTypes.ts` |
| SERP result → candidate | `src/lib/search/serpIndexer.ts` |
| Scoring / tiers / dedupe | `src/lib/utils/scoring.ts`, `src/lib/utils/tier.ts`, `src/lib/utils/deduplication.ts` |
| Persistence | `src/lib/db/sessions.ts` (`persistRunCandidates`) |
| Agent scope & phases | `src/lib/agent/engine.ts`, `src/lib/agent/scope.ts` |
| UI: constraints, query review, run trigger | `src/components/ingestion/ConstraintsForm.tsx`, `src/components/ingestion/QueryPreviewModal.tsx`, `src/app/(app)/dashboard/page.tsx` |
| Unused metering tables | `prisma/schema.prisma` (`SerpQueryCache`, `CreditPeriod`, `CreditLedger`) |
| Original sourcing skill (operator cheatsheet, guardrails) | `xray-search-query-generator.skill` (zip) |
| Older context (partly outdated, see G18) | `CandidateRadar_PRD.md`, `HANDOFF.md` |
