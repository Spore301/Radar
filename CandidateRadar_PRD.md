# CandidateRadar — Product Requirements Document
**Version:** 1.0  
**Author:** CandidateRadar Product Team  
**Date:** September 2026  
**Status:** Draft for Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [User Personas](#4-user-personas)
5. [Product Architecture Overview](#5-product-architecture-overview)
6. [Engine 1 — Ingestion Engine](#6-engine-1--ingestion-engine)
7. [Engine 2 — AI Parsing Engine](#7-engine-2--ai-parsing-engine)
8. [Engine 3 — Web Search & Scrape Engine](#8-engine-3--web-search--scrape-engine)
9. [Engine 4 — Outreach Tracking](#9-engine-4--outreach-tracking)
10. [User Interface & Flows](#10-user-interface--flows)
11. [AI Agent System Prompts](#11-ai-agent-system-prompts)
12. [Design System — Miro Design Language](#12-design-system--miro-design-language)
13. [Data Models](#13-data-models)
14. [API & Integration Contracts](#14-api--integration-contracts)
15. [Security & Privacy](#15-security--privacy)
16. [Non-Functional Requirements](#16-non-functional-requirements)
17. [Phased Rollout Plan](#17-phased-rollout-plan)
18. [Open Questions & Risks](#18-open-questions--risks)

---

## 1. Executive Summary

**CandidateRadar** is a SaaS-grade, AI-powered candidate discovery platform built for recruiters, hiring managers, and talent teams. A user uploads a Job Description (JD) and optional search constraints; the platform's AI parsing engine extracts structured signals from the JD, constructs precise X-Ray search queries, runs them across major job boards (LinkedIn, Naukri, Indeed), talent-specific platforms (GitHub, Bitbucket for tech; Behance, Dribbble for design), and the open web (portfolios, public resumes). Results are deduplicated, ranked by relevance, and presented in a SaaS dashboard where each candidate card links back to the original source for outreach.

The product has four core engines that work in sequence:

```
[Ingestion Engine] → [AI Parsing Engine] → [Web Search & Scrape Engine] → [Outreach Tracker]
```

---

## 2. Problem Statement

### 2.1 Current Pain Points

| Pain | Impact |
|---|---|
| Recruiters manually write Boolean/X-Ray queries | 30–60 min per role, error-prone |
| Candidate data scattered across LinkedIn, GitHub, Naukri, Behance, etc. | Siloed; no unified view |
| Search results not ranked against the JD | Irrelevant candidates surface at the top |
| No structured outreach log tied to candidate discovery | Follow-ups tracked in spreadsheets |
| AI tools hallucinate candidate profiles | Wastes recruiter time; erodes trust |

### 2.2 Opportunity

A well-constrained AI agent that parses JDs with strict, structured prompts — and is explicitly prohibited from generating fictional candidate data — can cut sourcing time by 60–80% while maintaining accuracy recruiters can trust.

---

## 3. Goals & Success Metrics

### 3.1 Primary Goals

- Reduce time-to-shortlist from JD upload to 10 qualified candidates under **15 minutes**
- Eliminate manual Boolean/X-Ray query writing
- Give recruiters a single pane of glass across all candidate sources
- Zero hallucinated candidate profiles

### 3.2 KPIs

| Metric | Target (MVP) | Target (6 months) |
|---|---|---|
| JD parse accuracy (skill extraction F1) | ≥ 90% | ≥ 95% |
| X-Ray query relevance (human review) | ≥ 80% queries rated "good" | ≥ 90% |
| Candidate deduplication rate | ≥ 85% cross-platform dupes caught | ≥ 95% |
| Outreach tracking adoption | 40% of discovered candidates logged | 70% |
| Recruiter NPS | ≥ 40 | ≥ 55 |

---

## 4. User Personas

### 4.1 Primary — The In-House Recruiter
- **Role:** TA Specialist / HR Generalist at a 50–500 person company
- **Frequency:** 3–5 active JDs per week
- **Pain:** Spends 50%+ of day on sourcing, not assessment
- **Needs:** Fast query generation, candidate cards they can act on, outreach status

### 4.2 Secondary — The Hiring Manager
- **Role:** Engineering Lead, Design Lead
- **Frequency:** Occasional (1–2 JDs per quarter)
- **Pain:** Doesn't understand Boolean search; wants role-relevant candidates surfaced automatically
- **Needs:** Simple upload, curated shortlist, ability to add soft constraints ("prefer open-source contributors")

### 4.3 Tertiary — The Agency Recruiter
- **Role:** Independent or boutique staffing firm
- **Frequency:** 10–20 active JDs simultaneously
- **Pain:** Context-switching between roles; outreach tracking in spreadsheets
- **Needs:** Multi-JD workspace, candidate tagging, export

---

## 5. Product Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CandidateRadar SaaS                          │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │  Ingestion   │──▶│  AI Parsing  │──▶│  Search & Scrape     │    │
│  │  Engine      │   │  Engine      │   │  Engine              │    │
│  │              │   │              │   │                      │    │
│  │ - File upload│   │ - JD struct. │   │ - X-Ray query exec   │    │
│  │ - PDF/DOCX   │   │ - Skill ext. │   │ - LinkedIn / Naukri  │    │
│  │   parse      │   │ - Query gen  │   │ - GitHub / Behance   │    │
│  │ - Constraint │   │ - Constraint │   │ - Portfolio scrape   │    │
│  │   form       │   │   merge      │   │ - Deduplication      │    │
│  └──────────────┘   └──────────────┘   └──────────┬───────────┘    │
│                                                    │                │
│  ┌──────────────────────────────────────────────── ▼ ─────────────┐ │
│  │                   Outreach Tracking Engine                      │ │
│  │  - Status pipeline (New → Contacted → Replied → Shortlisted)   │ │
│  │  - Notes, tags, custom fields                                  │ │
│  │  - Export to ATS / CSV                                         │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │  Auth Layer  │   │  Job Mgmt    │   │  Settings / API Keys │    │
│  └──────────────┘   └──────────────┘   └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.1 Tech Stack Recommendation

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Component Library | shadcn/ui (Miro color tokens applied) |
| Backend | Node.js (Express) or Python (FastAPI) |
| AI Engine | Anthropic Claude API (claude-sonnet-4-6) |
| Web Search | SerpAPI / Brave Search API + custom scraper |
| PDF/DOCX Parsing | pdf-parse, mammoth.js |
| Database | PostgreSQL (Supabase) |
| File Storage | Supabase Storage / S3 |
| Queue | BullMQ (Redis) for scrape jobs |
| Auth | Clerk or Supabase Auth |

---

## 6. Engine 1 — Ingestion Engine

### 6.1 Purpose

Accept a job description in multiple formats, validate it, extract raw text, and pair it with user-defined constraints before passing it downstream to the AI Parsing Engine.

### 6.2 Inputs Accepted

| Input Type | Format | Max Size |
|---|---|---|
| Job Description File | PDF, DOCX, TXT | 10 MB |
| Paste-in JD | Plain text (textarea) | 20,000 chars |
| JD URL | Public URL | — |
| Constraints Form | Structured UI (see §6.4) | — |

### 6.3 File Processing Pipeline

```
Raw Upload
    │
    ▼
Virus Scan (ClamAV or S3 policy)
    │
    ▼
Format Detection → PDF / DOCX / TXT
    │
    ▼
Text Extraction
  PDF → pdfplumber / pdf-parse
  DOCX → mammoth.js
  TXT → direct
    │
    ▼
Sanitisation (strip PII if test mode, normalise whitespace)
    │
    ▼
Language Detection (langdetect)
  ├── English → proceed
  └── Non-English → translate via DeepL / Claude, flag in UI
    │
    ▼
Pass raw_jd_text + constraints to AI Parsing Engine
```

### 6.4 Constraints Form — Field Specification

The AI pre-populates all fields based on the JD. The user can override before initiating search.

| Field | Type | AI Pre-populated? | Example |
|---|---|---|---|
| Job Title | Text | ✅ | "Senior Product Designer" |
| Seniority Level | Single Select | ✅ | Junior / Mid / Senior / Staff / Lead |
| Years of Experience | Range Slider | ✅ | 3–7 years |
| Location | Multi-Select + Remote Toggle | ✅ | "Bangalore, India" + Open to Remote |
| Skills (Must-Have) | Tag Input | ✅ | Figma, React, Tailwind |
| Skills (Nice-to-Have) | Tag Input | ✅ | Framer, Lottie |
| Domain / Industry | Multi-Select | ✅ | FinTech, SaaS |
| Education | Single Select | Partial | B.Tech CS / Any Degree / Not Required |
| Preferred Source Platforms | Multi-Select (checkboxes) | ✅ (role-based) | LinkedIn, GitHub, Dribbble |
| Salary Range | Range (optional) | ❌ | ₹18L–₹28L |
| Additional Soft Constraints | Freetext | ❌ | "Has open-source contributions" |
| Results Cap | Number Input | Default: 50 | Max candidates to surface |

**Platform Selection Logic (AI-driven, user can edit):**

```
if role_type == "Engineering":
    default_platforms = [LinkedIn, GitHub, Bitbucket, Naukri, Indeed, StackOverflow]
elif role_type == "Design":
    default_platforms = [LinkedIn, Behance, Dribbble, Naukri, Indeed]
elif role_type == "Marketing / Growth":
    default_platforms = [LinkedIn, Indeed, Personal Blogs / Substack]
else:
    default_platforms = [LinkedIn, Naukri, Indeed]
```

### 6.5 Validation Rules

- JD must be > 200 words; under 200 words → warning banner, still allow proceed
- At least one source platform must be selected
- If no file/text/URL provided → block submission with inline error

### 6.6 UX Behaviour

- Drag-and-drop upload zone (dashed border, Miro accent blue on hover)
- Inline loading state: "Extracting text from your JD…" → progress bar
- Once text is extracted, the Constraints Form appears with AI-populated fields highlighted in a soft yellow tint with a ✨ icon indicating AI suggestion
- User can click any field to override before hitting **"Generate Queries & Search"**

---

## 7. Engine 2 — AI Parsing Engine

### 7.1 Purpose

Parse the raw JD text + user constraints into structured signals, generate precise X-Ray search queries, produce keyword sets, and classify the role — all without hallucinating skills, seniority, or requirements that are not present in the source material.

### 7.2 Parsing Pipeline

```
raw_jd_text + constraints
        │
        ▼
Step 1: JD Structuring Pass
  → Extract: title, seniority, skills, experience, location, domain
  → Output: structured_jd JSON
        │
        ▼
Step 2: Constraint Merge
  → Merge user constraints with structured_jd
  → User overrides win; mark overridden fields
  → Output: merged_context JSON
        │
        ▼
Step 3: X-Ray Query Generation
  → Generate platform-specific X-Ray queries
  → Output: query_bundle[]
        │
        ▼
Step 4: Keyword Set Generation
  → Synonyms, acronyms, adjacent skills
  → Output: keyword_map{}
        │
        ▼
Pass to Search & Scrape Engine
```

### 7.3 Structured Output Schema — `structured_jd`

```json
{
  "job_title": "string",
  "role_type": "Engineering | Design | Marketing | Sales | Operations | Other",
  "seniority": "Junior | Mid | Senior | Staff | Lead | Executive",
  "years_of_experience": { "min": 3, "max": 7 },
  "location": {
    "primary": "string",
    "remote_eligible": true
  },
  "skills": {
    "must_have": ["string"],
    "nice_to_have": ["string"],
    "inferred_adjacent": ["string"]
  },
  "domain": ["string"],
  "education": "string | null",
  "responsibilities_summary": "string (max 150 words)",
  "confidence_scores": {
    "seniority": 0.0–1.0,
    "skills_must_have": 0.0–1.0
  },
  "extraction_warnings": ["string"]
}
```

### 7.4 X-Ray Query Schema — `query_bundle`

```json
[
  {
    "platform": "LinkedIn",
    "query_type": "X-Ray Google",
    "query_string": "site:linkedin.com/in \"Senior Product Designer\" \"Figma\" \"Design System\" \"SaaS\" Bangalore",
    "notes": "Targets senior designers in Bangalore with Figma and Design Systems experience"
  },
  {
    "platform": "GitHub",
    "query_type": "X-Ray Google",
    "query_string": "site:github.com \"React\" \"TypeScript\" stars:>50 location:India",
    "notes": "Surfaces active React/TS contributors based in India"
  }
]
```

### 7.5 Keyword Map Schema

```json
{
  "primary_title_variants": ["Product Designer", "UX Designer", "UI/UX Designer"],
  "skill_synonyms": {
    "Figma": ["Sketch", "Adobe XD"],
    "React": ["ReactJS", "React.js"]
  },
  "domain_keywords": ["SaaS", "B2B", "dashboard", "enterprise product"],
  "seniority_signals": ["lead", "senior", "5+ years", "staff designer"],
  "negative_keywords": ["intern", "fresher", "entry level"]
}
```

### 7.6 Confidence & Warning System

- Fields extracted with confidence < 0.70 are flagged with an amber badge in the UI
- If no explicit seniority signal is found, the AI must **not guess** — it sets `seniority: null` and raises an extraction warning
- Warnings are displayed in the Constraints Form as inline alerts so the user can manually correct

---

## 8. Engine 3 — Web Search & Scrape Engine

### 8.1 Purpose

Execute X-Ray queries across selected platforms, scrape candidate profile data from returned URLs, deduplicate across sources, score each candidate against the JD, and surface ranked results.

### 8.2 Search Pipeline

```
query_bundle[] + keyword_map + platform_selection
        │
        ▼
Job Queue (BullMQ / Redis)
  → One job per platform per query
        │
        ▼
For each job:
  Step A: Execute Search
    → SerpAPI / Brave Search API
    → query_string fired as Google X-Ray search
    → Returns: list of URLs + snippets
        │
        ▼
  Step B: URL Filtering
    → Strip URLs not matching target platform domain
    → Strip job listing pages (filter /jobs/, /careers/)
    → Retain profile URLs only
        │
        ▼
  Step C: Scrape Profile Page
    → Puppeteer / Playwright headless scrape
    → Extract: name, headline, location, skills, experience, summary, profile_url
    → Fallback: use snippet if scrape blocked (respect robots.txt)
        │
        ▼
  Step D: Candidate Normalisation
    → Map scraped data to CandidateProfile schema
    → Deduplicate by name + location fuzzy match (Levenshtein ≤ 2) OR email if available
        │
        ▼
  Step E: Relevance Scoring
    → AI Scoring Pass (see §8.4)
    → Output: score 0–100
        │
        ▼
Results Surface to Dashboard
```

### 8.3 CandidateProfile Schema

```json
{
  "candidate_id": "uuid",
  "name": "string",
  "headline": "string",
  "location": "string",
  "profile_url": "string (source link)",
  "platform": "LinkedIn | GitHub | Naukri | Behance | Dribbble | Indeed | Web",
  "avatar_url": "string | null",
  "skills_detected": ["string"],
  "experience_years_estimated": "number | null",
  "summary_snippet": "string (max 300 chars)",
  "match_score": 0–100,
  "match_breakdown": {
    "skills_match": 0–100,
    "seniority_match": 0–100,
    "location_match": 0–100,
    "domain_match": 0–100
  },
  "raw_scraped_data": {},
  "source_query": "string",
  "discovered_at": "ISO timestamp",
  "status": "New | Reviewed | Saved | Contacted | Rejected"
}
```

### 8.4 Relevance Scoring — AI Scoring Pass

A second AI call scores each candidate against the structured JD. This call is strictly constrained to comparing extracted data — it does **not** browse the internet or generate new information about the candidate.

**Scoring Weights:**

| Dimension | Weight |
|---|---|
| Skills match (must-have) | 40% |
| Skills match (nice-to-have) | 15% |
| Seniority alignment | 20% |
| Location / remote fit | 15% |
| Domain / industry overlap | 10% |

Score < 40 → shown in "Low Match" section (collapsed by default)  
Score 40–69 → "Potential Match"  
Score 70–100 → "Strong Match" (surfaced at top)

### 8.5 Platform Coverage Matrix

| Platform | Search Method | Scrape Depth | Role Type |
|---|---|---|---|
| LinkedIn | X-Ray Google | Snippet (full scrape if user provides cookie) | All |
| Naukri | X-Ray Google | Snippet + public profile | All |
| Indeed | X-Ray Google | Snippet | All |
| GitHub | X-Ray Google + GitHub Search API | Full public profile | Engineering |
| Bitbucket | X-Ray Google | Public profile page | Engineering |
| StackOverflow | X-Ray Google | Public profile | Engineering |
| Behance | X-Ray Google + Behance API | Public portfolio | Design |
| Dribbble | X-Ray Google | Public profile | Design |
| Personal Sites / Portfolios | Google Search | Full scrape | All |

### 8.6 Rate Limiting & Ethics

- Respect `robots.txt` for all scraped platforms
- Minimum 2s delay between scrape requests per domain
- LinkedIn scraping: snippet-only by default; deep scrape only if user provides authenticated session cookie (user's responsibility, clearly communicated in UI)
- No storage of scraped PII beyond the session unless user explicitly saves a candidate profile

### 8.7 Scrape Failure Handling

- If scrape returns HTTP 403 / 429 → log `scrape_status: blocked`, surface snippet-only card with a "Manual visit" CTA
- If scrape returns empty body → retry once after 5s, then mark `scrape_status: failed`
- All failures surfaced in a dashboard status count: "12 profiles fetched · 3 snippet-only · 2 failed"

---

## 9. Engine 4 — Outreach Tracking

### 9.1 Purpose

Give the recruiter a lightweight CRM layer attached to each discovered candidate, so outreach actions, notes, and status are tracked without leaving the tool.

### 9.2 Outreach Pipeline (Kanban + Table View)

```
New → Reviewed → Saved → Outreach Sent → Replied → Shortlisted → Archived
```

### 9.3 Per-Candidate Outreach Panel

Accessible from the Candidate Detail drawer:

| Field | Type |
|---|---|
| Status | Dropdown (pipeline stages above) |
| Outreach Channel | Tag: LinkedIn DM / Email / WhatsApp / Call |
| Outreach Date | Date Picker |
| Message Template Used | Dropdown (saved templates) |
| Notes | Rich text (markdown) |
| Next Follow-up Date | Date Picker with reminder |
| Tags | Custom tag input |

### 9.4 Message Template Engine

- User can save outreach message templates per role type
- Templates support variables: `{{candidate_name}}`, `{{role_title}}`, `{{company_name}}`
- AI-assisted template generation: user describes tone ("warm but direct, 3 sentences") → AI drafts a template
- Template preview renders variable substitution live

### 9.5 Dashboard-Level Outreach View

A separate tab ("Outreach Pipeline") shows:
- Kanban board: candidates as cards grouped by pipeline stage
- Table view: sortable by status, outreach date, match score
- Filters: by JD / role, status, platform, tag
- Export: CSV, PDF summary report

### 9.6 Notifications (future scope)

- Email digest: daily summary of follow-up reminders
- In-app notification: when a follow-up date is due

---

## 10. User Interface & Flows

### 10.1 Global Navigation

```
Sidebar (collapsible):
├── Dashboard (home — all active JDs)
├── Active Searches
│   └── [JD Name] → Candidates view
├── Outreach Pipeline
├── Saved Candidates
├── Templates
├── Settings
└── Help / Docs
```

### 10.2 Flow 1 — New JD Search

```
Step 1: Upload / Paste JD
   └── Drag-drop zone OR paste textarea OR URL input
   └── CTA: "Analyse JD"

Step 2: Review Constraints Form
   └── AI pre-populated fields (editable)
   └── Platform selector (checkboxes + icons)
   └── Additional soft constraints (freetext)
   └── Results cap slider
   └── CTA: "Generate Queries & Search"

Step 3: Query Preview Modal
   └── Shows generated X-Ray queries per platform
   └── User can edit, delete, or add queries manually
   └── CTA: "Run Search" | "Edit"

Step 4: Live Search Progress
   └── Progress bar per platform
   └── Live count: "23 candidates found so far..."
   └── Cancel option

Step 5: Results Dashboard
   └── Default: "Strong Match" tab active
   └── Candidate cards in grid/list toggle
   └── Sort: Match Score (desc) | Discovered At | Name
   └── Filter panel: platform, seniority, location, status
```

### 10.3 Candidate Card (Grid View)

```
┌──────────────────────────────────────┐
│ [Avatar]  Name                       │
│           Headline / Role            │
│           📍 Location  🔗 Platform   │
│                                      │
│ ████████░░  82 Match Score           │
│                                      │
│ [Figma] [React] [Design Systems]     │
│                                      │
│ [View Profile]  [Save]  [···]        │
└──────────────────────────────────────┘
```

### 10.4 Candidate Detail Drawer

Slides in from right (80% height, 480px width on desktop):

```
[Avatar]  Full Name
          Headline
          📍 Location · 🔗 Platform · Discovered via: X-Ray LinkedIn

[Open Source Profile]  ← Links to scraped URL

─── Match Analysis ──────────────────
  Skills Match      ████████░░  80%
  Seniority Fit     ██████████  100%
  Location Fit      ███████░░░  70%
  Domain Overlap    █████░░░░░  50%
  Overall Score     82 / 100

─── Detected Skills ─────────────────
  [Figma] [React] [Design Systems] [Framer]

─── Experience Snippet ──────────────
  3 sentences max, extracted from profile

─── Outreach ────────────────────────
  Status: [Dropdown]
  Channel: [Tag selector]
  Date: [Date picker]
  Notes: [Rich text]
  [Generate Outreach Message ✨]

─── Actions ─────────────────────────
  [Shortlist]  [Reject]  [Add to Pipeline]
```

### 10.5 Query Editor Panel

- Accessible from "Edit Queries" in the flow
- Each query shown as an editable text field with platform icon
- "Add query" button to manually write a new query
- "Regenerate all" button triggers a fresh AI query generation pass
- Queries that the user manually edits are tagged with a ✏️ "Edited" badge

---

## 11. AI Agent System Prompts

This section defines the exact system prompts and prompt architecture for each AI call. Anti-hallucination guardrails are baked into the prompt constraints.

### 11.1 Prompt Architecture Principles

1. **Strict grounding:** AI may only reference information present in the input text. It must never generate or assume information not in the JD or user constraints.
2. **Explicit refusal:** If a required field cannot be determined from the input, the AI outputs `null` and includes the field in `extraction_warnings[]` — it never guesses.
3. **Schema enforcement:** Every AI response is in JSON. If the response cannot be parsed as the target schema, the system retries once with an appended correction instruction.
4. **Confidence scores:** AI self-reports confidence on key fields. Scores below threshold trigger UI warnings.
5. **No profile generation:** The AI is explicitly told it cannot generate, infer, or fabricate candidate profiles, skills, or experiences.

---

### 11.2 System Prompt — JD Structuring Pass (Step 1)

```
SYSTEM:
You are a precise, structured data extraction engine for a talent sourcing platform.

Your task is to parse a Job Description text and extract structured fields. 
You operate under STRICT constraints:

RULES — you must follow every one of these:
1. Extract ONLY information explicitly stated in the JD text provided. 
   Do NOT infer, guess, or generate information that is not present.
2. If a field cannot be determined with confidence ≥ 0.70 from the text, 
   set it to null and add it to extraction_warnings[].
3. For skills[], include ONLY skills mentioned by name or clear implication 
   (e.g. "build React components" → React). Do NOT add adjacent skills 
   the JD does not mention.
4. For seniority, use these signals ONLY: explicit title ("Senior"), 
   years of experience range, or level language ("lead", "staff", "principal"). 
   If none of these are present, set seniority to null.
5. Do NOT summarise, rephrase, or add commentary. Return only valid JSON 
   matching the schema below.
6. If the input appears to not be a job description, set 
   extraction_warnings[] to ["INPUT_NOT_JD"] and all fields to null.

OUTPUT FORMAT (return only this JSON, no markdown, no explanation):
{
  "job_title": string | null,
  "role_type": "Engineering" | "Design" | "Marketing" | "Sales" | "Operations" | "Other" | null,
  "seniority": "Junior" | "Mid" | "Senior" | "Staff" | "Lead" | "Executive" | null,
  "years_of_experience": { "min": number | null, "max": number | null },
  "location": { "primary": string | null, "remote_eligible": boolean | null },
  "skills": {
    "must_have": [string],
    "nice_to_have": [string]
  },
  "domain": [string],
  "education": string | null,
  "responsibilities_summary": string (max 150 words, factual extraction only),
  "confidence_scores": {
    "seniority": number (0.0–1.0),
    "skills_must_have": number (0.0–1.0)
  },
  "extraction_warnings": [string]
}

USER:
<JD_TEXT>
{raw_jd_text}
</JD_TEXT>
```

---

### 11.3 System Prompt — X-Ray Query Generation (Step 3)

```
SYSTEM:
You are an expert technical recruiter and Boolean search specialist. 
Your task is to generate precise X-Ray search queries for Google, 
based on a structured job context.

RULES:
1. Generate queries ONLY based on the structured_jd and merged_constraints 
   provided. Do NOT add requirements, skills, or qualifications not present 
   in the input.
2. For each selected platform, generate 1–3 queries. 
   Each query must be syntactically valid as a Google X-Ray search.
3. X-Ray query format: site:platform.com "keyword1" "keyword2" location
4. Include negative keywords where appropriate (e.g., -"looking for" 
   -"hiring" to exclude job postings from LinkedIn).
5. Vary query specificity: generate at least one broad query and 
   one narrow query per platform to maximise coverage.
6. Do NOT generate queries for platforms not in selected_platforms[].
7. Return only valid JSON. No markdown, no explanation.

PLATFORM QUERY TEMPLATES:
- LinkedIn: site:linkedin.com/in "{{title_variant}}" "{{skill1}}" "{{location}}"
- GitHub: site:github.com "{{skill}}" location:"{{location}}" language:{{lang}}
- Behance: site:behance.net "{{title_variant}}" "{{tool}}"
- Dribbble: site:dribbble.com/{{skill_tag}}
- Naukri: site:naukri.com "{{title_variant}}" "{{skill1}}" "{{location}}"
- Indeed: site:in.indeed.com/resume "{{title_variant}}" "{{skill1}}"

OUTPUT FORMAT:
[
  {
    "platform": string,
    "query_type": "X-Ray Google",
    "query_string": string,
    "query_intent": string (one sentence describing what this query targets),
    "expected_result_type": "Profile" | "Portfolio" | "Resume"
  }
]

USER:
<STRUCTURED_JD>
{structured_jd_json}
</STRUCTURED_JD>

<MERGED_CONSTRAINTS>
{merged_constraints_json}
</MERGED_CONSTRAINTS>

<SELECTED_PLATFORMS>
{selected_platforms_list}
</SELECTED_PLATFORMS>
```

---

### 11.4 System Prompt — Keyword Map Generation

```
SYSTEM:
You are a recruitment keyword specialist. Generate a comprehensive keyword 
map for sourcing candidates for the role described below.

RULES:
1. Only generate synonyms and adjacent terms for skills EXPLICITLY 
   mentioned in the input. Do NOT add skills not in the JD.
2. Synonyms must be genuine industry-standard alternatives 
   (e.g., "React" → "ReactJS", "React.js"). 
   Do NOT include aspirational or speculative skills.
3. For negative_keywords, include terms that would indicate a 
   non-matching profile (e.g., "intern", "trainee", "entry-level" 
   if role is Senior).
4. primary_title_variants must include only common industry-standard 
   alternative job titles that genuinely match the role described.
5. Return only valid JSON. No markdown.

OUTPUT FORMAT:
{
  "primary_title_variants": [string],
  "skill_synonyms": { "skill": [synonym] },
  "domain_keywords": [string],
  "seniority_signals": [string],
  "negative_keywords": [string]
}

USER:
<STRUCTURED_JD>
{structured_jd_json}
</STRUCTURED_JD>
```

---

### 11.5 System Prompt — Candidate Relevance Scoring

```
SYSTEM:
You are a candidate-JD matching engine. You will be given a structured 
job description and a candidate's scraped profile data. Your task is to 
score how well the candidate matches the role.

CRITICAL RULES — violating these is a system failure:
1. You may ONLY reference information present in candidate_data{} 
   and structured_jd{}. 
2. You MUST NOT generate, infer, or assume any skills, experience, 
   or qualifications not explicitly present in candidate_data.
3. If candidate_data is sparse or incomplete, reflect this in 
   lower confidence scores — do NOT fill gaps with assumptions.
4. You are scoring a REAL person based on REAL scraped data. 
   Never fabricate match rationale.
5. The match_rationale must cite specific evidence from candidate_data 
   (e.g., "Candidate lists Figma in skills section").
6. Return only valid JSON. No markdown, no preamble.

SCORING WEIGHTS:
- skills_match (must-have): 40 points max
- skills_match (nice-to-have): 15 points max
- seniority_alignment: 20 points max
- location_fit: 15 points max
- domain_overlap: 10 points max
Total: 100 points

OUTPUT FORMAT:
{
  "overall_score": number (0–100),
  "match_breakdown": {
    "skills_must_have_score": number (0–40),
    "skills_nice_to_have_score": number (0–15),
    "seniority_score": number (0–20),
    "location_score": number (0–15),
    "domain_score": number (0–10)
  },
  "match_rationale": string (max 100 words, cite evidence from candidate_data),
  "missing_signals": [string],
  "data_completeness": number (0.0–1.0, how complete was the scraped data)
}

USER:
<STRUCTURED_JD>
{structured_jd_json}
</STRUCTURED_JD>

<CANDIDATE_DATA>
{candidate_scraped_data_json}
</CANDIDATE_DATA>
```

---

### 11.6 System Prompt — Outreach Message Generation

```
SYSTEM:
You are an expert recruiter helping write personalised outreach messages.
You will generate a short outreach message to a candidate based on 
their profile and the role context.

RULES:
1. Only reference information explicitly present in candidate_data 
   and job_context. Do NOT fabricate achievements, skills, or experiences.
2. Message must be {tone} in tone (see USER input).
3. Message must be between 80–150 words.
4. Include a subject line if channel is email.
5. Do NOT use generic filler phrases like "I came across your profile" 
   unless asked. Be specific to the candidate's actual background.
6. End with a clear, low-commitment CTA (e.g., "Would you be open to 
   a quick 15-min chat?").
7. Return only valid JSON. No markdown.

OUTPUT FORMAT:
{
  "subject_line": string | null,
  "message_body": string,
  "word_count": number
}

USER:
<JOB_CONTEXT>
{job_title}, {company_name}, {key_selling_points}
</JOB_CONTEXT>

<CANDIDATE_DATA>
{candidate_profile_summary}
</CANDIDATE_DATA>

<TONE>
{user_tone_description}
</TONE>

<CHANNEL>
{LinkedIn DM | Email | WhatsApp}
</CHANNEL>
```

---

### 11.7 Prompt Retry & Error Handling Logic

```
function callAIWithRetry(prompt, schema, maxRetries = 2):
  for attempt in 1..maxRetries:
    response = callClaudeAPI(prompt)
    parsed = tryParseJSON(response)
    
    if parsed is valid:
      if validateAgainstSchema(parsed, schema):
        return parsed
      else:
        prompt += "\n\nYour previous response did not match the required schema. 
                   Return ONLY valid JSON matching the schema. 
                   Do not include any explanation or markdown."
    else:
      prompt += "\n\nYour previous response was not valid JSON. 
                 Return ONLY a raw JSON object. No backticks, 
                 no markdown, no explanation."
  
  // After max retries
  return { error: "PARSE_FAILURE", raw_response: response }
```

---

## 12. Design System — Miro Design Language

*Note: This section will be updated when Miro .md and .html design files are uploaded. The following tokens are placeholder mappings to be confirmed against those files.*

### 12.1 Core Design Principles (Miro-Aligned)

- **Clarity over decoration:** Every element serves a function
- **Confident whitespace:** Generous padding, clear hierarchy
- **Accessible contrast:** WCAG AA minimum for all text
- **Consistent density:** SaaS-grade information density — not sparse, not cluttered

### 12.2 Color Tokens (Placeholder — to be confirmed from Miro files)

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#4262FF` | CTAs, active states, links |
| `--color-primary-light` | `#EEF0FF` | Highlighted AI-filled fields |
| `--color-success` | `#1CA97B` | Strong match badge |
| `--color-warning` | `#F0A500` | Confidence warning, medium match |
| `--color-danger` | `#E84040` | Error states, low match |
| `--color-neutral-900` | `#1A1A2E` | Primary text |
| `--color-neutral-500` | `#6C6C89` | Secondary text, labels |
| `--color-neutral-100` | `#F4F5F7` | Page background |
| `--color-surface` | `#FFFFFF` | Card background |
| `--color-border` | `#E2E4EA` | Card borders, dividers |

### 12.3 Typography

| Style | Font | Size | Weight | Usage |
|---|---|---|---|---|
| Display | Miro system sans | 32px | 700 | Page headers |
| Heading 1 | Miro system sans | 24px | 600 | Section headers |
| Heading 2 | Miro system sans | 18px | 600 | Card titles |
| Body | Miro system sans | 14px | 400 | Default body |
| Caption | Miro system sans | 12px | 400 | Labels, badges |
| Code | Monospace | 13px | 400 | Query strings |

### 12.4 Spacing Scale

`4px · 8px · 12px · 16px · 24px · 32px · 48px · 64px`  
Grid: 12-column · Gutter: 24px · Margin: 32px

### 12.5 Component Inventory

| Component | Usage |
|---|---|
| Button (Primary, Secondary, Ghost, Destructive) | CTAs throughout |
| Badge (Success, Warning, Error, Neutral) | Match score, status |
| Card | Candidate cards, JD summary card |
| Drawer (right-slide) | Candidate detail panel |
| Progress Bar | Match score bars, search progress |
| Tag / Chip | Skills, platform labels |
| Dropdown | Status selector, filter |
| Multi-select Checkbox | Platform picker |
| Toast Notification | Errors, success states |
| Modal | Query editor, confirmation dialogs |
| Skeleton Loader | While search results load |
| Empty State | No results, no JDs yet |

### 12.6 Motion Principles

- Drawer enter: `transform: translateX(100%) → 0, 250ms ease-out`
- Card appear: `opacity: 0 → 1, translateY(8px → 0), 200ms, staggered 40ms per card`
- Progress bar: CSS `transition: width 300ms ease`
- No gratuitous animation — motion serves state change communication

---

## 13. Data Models

### 13.1 `Job` Table

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users |
| title | TEXT | |
| raw_jd_text | TEXT | |
| structured_jd | JSONB | |
| merged_constraints | JSONB | |
| query_bundle | JSONB | |
| keyword_map | JSONB | |
| status | ENUM | draft / searching / complete / archived |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### 13.2 `Candidate` Table

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| job_id | UUID | FK → jobs |
| name | TEXT | |
| headline | TEXT | |
| location | TEXT | |
| profile_url | TEXT | |
| platform | TEXT | |
| avatar_url | TEXT | nullable |
| skills_detected | TEXT[] | |
| experience_years_estimated | INT | nullable |
| summary_snippet | TEXT | |
| match_score | INT | 0–100 |
| match_breakdown | JSONB | |
| raw_scraped_data | JSONB | |
| scrape_status | ENUM | success / snippet_only / failed |
| outreach_status | ENUM | new / reviewed / saved / contacted / replied / shortlisted / archived |
| discovered_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### 13.3 `OutreachLog` Table

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| candidate_id | UUID | FK → candidates |
| channel | TEXT | LinkedIn / Email / WhatsApp / Call |
| sent_at | TIMESTAMPTZ | |
| message_body | TEXT | |
| notes | TEXT | |
| follow_up_date | DATE | nullable |
| tags | TEXT[] | |

### 13.4 `MessageTemplate` Table

| Field | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users |
| name | TEXT | |
| channel | TEXT | |
| body | TEXT | supports `{{variable}}` |
| role_type | TEXT | nullable; template type hint |

---

## 14. API & Integration Contracts

### 14.1 Internal REST API (Backend ↔ Frontend)

| Endpoint | Method | Description |
|---|---|---|
| `/api/jobs` | POST | Create new job + upload JD |
| `/api/jobs/:id` | GET | Fetch job + current status |
| `/api/jobs/:id/parse` | POST | Trigger AI parse pass |
| `/api/jobs/:id/queries` | GET | Fetch generated queries |
| `/api/jobs/:id/queries` | PUT | Save user-edited queries |
| `/api/jobs/:id/search` | POST | Initiate search |
| `/api/jobs/:id/search/status` | GET | Poll search progress |
| `/api/jobs/:id/candidates` | GET | Fetch paginated candidates |
| `/api/candidates/:id` | GET | Fetch single candidate detail |
| `/api/candidates/:id/status` | PATCH | Update outreach status |
| `/api/candidates/:id/outreach` | POST | Log outreach action |
| `/api/templates` | GET / POST | Manage message templates |

### 14.2 External API Dependencies

| Service | Purpose | Auth |
|---|---|---|
| Anthropic Claude API | JD parsing, query gen, scoring, outreach drafts | API Key |
| SerpAPI / Brave Search | Execute Google X-Ray queries | API Key |
| Puppeteer / Playwright | Scrape profile pages | Self-hosted |
| Supabase | DB + Auth + Storage | Service role key |
| DeepL API | JD translation (non-English) | API Key |

### 14.3 Webhook Events (for ATS integrations, future)

- `candidate.shortlisted` → push to Greenhouse / Lever
- `outreach.replied` → update ATS candidate status

---

## 15. Security & Privacy

### 15.1 Data Handling

- JD files encrypted at rest (AES-256)
- Scraped candidate data stored only if user explicitly saves the candidate
- Unsaved candidate data purged after 24 hours from job completion
- No scraped PII shared across users or used for model training

### 15.2 Auth & Access Control

- JWT-based auth (Clerk or Supabase Auth)
- Row-level security on all DB tables (users only access their own jobs/candidates)
- API keys stored as environment secrets, never exposed to frontend

### 15.3 Ethical Sourcing Disclosure

- Platform-level ToS notice shown in settings: "You are responsible for compliance with the Terms of Service of each platform you search."
- LinkedIn note: "LinkedIn prohibits automated scraping. By enabling deep scrape, you accept responsibility for your account usage."
- GDPR: data deletion endpoint available (`DELETE /api/users/me/data`)

---

## 16. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Search results first card visible < 10s from query start |
| Scalability | Handle 1,000 concurrent job searches (horizontal worker scaling) |
| Availability | 99.5% uptime SLA |
| Latency | AI parse pass < 8s for a 2,000-word JD |
| Search throughput | ≥ 50 candidates surfaced within 5 minutes for a standard role |
| Browser support | Chrome, Firefox, Safari (latest 2 versions); responsive down to 1024px |
| Accessibility | WCAG 2.1 AA |
| Rate limits | Respect SerpAPI limits; back-off implemented |

---

## 17. Phased Rollout Plan

### Phase 1 — MVP (Weeks 1–8)

- Ingestion Engine: file upload + paste, PDF/DOCX parsing, constraints form
- AI Parsing Engine: JD structuring + query generation (LinkedIn + GitHub)
- Search Engine: SerpAPI X-Ray queries, snippet surfacing, basic deduplication
- Results Dashboard: card grid, match score display, candidate detail drawer
- Basic outreach status (dropdown only)

**Exit Criteria:** 5 beta recruiters sourcing real candidates with positive feedback

### Phase 2 — Expansion (Weeks 9–16)

- Full platform coverage (Naukri, Indeed, Behance, Dribbble, Bitbucket)
- Puppeteer scrape layer (deep profile data)
- AI relevance scoring (full scoring pass)
- Outreach tracking with notes + follow-up reminders
- Message template engine + AI draft

### Phase 3 — Scale (Weeks 17–24)

- Multi-JD workspace (agency-grade)
- Export to CSV / PDF
- ATS webhook integrations (Greenhouse, Lever)
- Analytics: time-to-hire sourcing metrics
- Saved search profiles (reusable constraint templates)

---

## 18. Open Questions & Risks

| # | Question | Owner | Priority |
|---|---|---|---|
| 1 | LinkedIn ToS compliance — how deep do we allow scraping? | Legal / Product | High |
| 2 | Will SerpAPI provide sufficient query volume at scale? Evaluate Brave Search as fallback. | Engineering | High |
| 3 | How to handle profile data accuracy when scrape only yields snippet? | Product | Medium |
| 4 | Should match score be user-configurable (change weights)? | Product | Medium |
| 5 | Naukri / Indian job board API availability — public scraping may be rate-limited aggressively | Engineering | High |
| 6 | Miro design system token file needs to be provided to lock final UI tokens | Design | High |
| 7 | Multi-language JDs (e.g., Hindi, German) — DeepL integration scope for MVP? | Product | Low |
| 8 | Resume PDF attachments on portfolio sites — do we parse those too? | Engineering | Low |

---

*End of PRD v1.0 — CandidateRadar*  
*Next milestone: Design file upload + Miro token integration → UI spec finalization*
