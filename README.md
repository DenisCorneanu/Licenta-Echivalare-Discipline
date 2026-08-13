# Course Equivalence Assistant

**A smart web app that turns a 10–15 minute manual academic paperwork task into a 1–3 minute review.**

Built as a Bachelor's thesis project at the **West University of Timișoara, Faculty of Computer Science**, this system helps university course-equivalence committees compare a student's transcript against a target curriculum and automatically propose which courses match — while keeping a human in control of the final decision.

> 📄 Full technical write-up (thesis, in Romanian) available on request / in this repo.

---

## The Problem

Every time a student transfers programs, resumes studies, or changes curricula, a committee has to manually compare their transcript against a new set of required courses. That means:

- Reading through messy, hand-transcribed course names ("Sport 1" vs "Sport I" vs "SPORT I" — same course, three spellings)
- Spotting abbreviations and historical course names ("Inginerie software" vs "Inginerie soft")
- Making sure the same completed course isn't reused to cover two different requirements
- Doing all of this by hand, for every student, every year

At the Faculty of Computer Science alone, this happens for **~200 students a year**. At larger faculties, it can be **~500**. Each case takes a committee member **10–15 minutes**.

## The Solution

This app automates the repetitive part — matching and organizing — while leaving the actual academic judgment call to the committee. No black-box decisions, no data leaving the building, no course ever silently reused.

In testing, most cases that used to take **10–15 minutes** were completed in **1–2 minutes**, with the trickiest cases topping out around **3 minutes** — roughly a **70–93% time reduction**.

---

## What It Does

- **Reads transcripts automatically** — upload an XLSX or CSV file and the app extracts course names, grades, and credits
- **Normalizes messy course names** — handles capitalization, diacritics, spacing, and Roman vs. Arabic numerals so "Sport I" and "sport 1" are recognized as the same thing
- **Matches courses intelligently**, using a layered strategy:
  1. Explicit rules confirmed by the committee
  2. Exact matches after normalization
  3. Configurable aliases (e.g. "Inginerie software" ≈ "Inginerie soft")
  4. Course families with configurable level rules (e.g. telling "English II" apart from "English IV" — without mistaking "4 weeks × 6h/day" for a course level)
  5. Fuzzy name comparison for everything else, backed by ECTS credit info as a supporting signal
- **Prevents double-booking** — a global one-to-one assignment (via the **Hungarian algorithm**, run in two passes) guarantees the same completed course can never be used to satisfy two different requirements
- **Flags what needs a human eye** — results are sorted into **Automatic**, **Needs review**, and **No match**, so the committee only has to focus on the uncertain cases
- **Tracks unsaved changes** and blocks export until everything is confirmed, so the final document always matches what was actually reviewed
- **Generates the final document** — a ready-to-use `.docx` file, filled in automatically from the university's official template
- **Admin panel** for managing faculties, programs, historical templates, and matching rules — no code changes needed to update the rules

---

## How the Matching Actually Works

Instead of relying only on exact text matches (too rigid) or a black-box AI model (expensive, and risky for personal student data), the app combines:

- **Rule-based logic** for known, committee-approved relationships
- **Text similarity** (Jaccard-based comparison) for everything else
- **The Hungarian algorithm** to solve the matching as a global optimization problem — maximizing overall match quality while guaranteeing no course is assigned twice

This keeps every decision **explainable**: for any result, you can see exactly which mechanism produced it and why. Confidence thresholds were deliberately set conservatively — when in doubt, the system asks a human instead of guessing.

A local, AI/LLM-based semantic matching approach was also evaluated during design, but was left out of this version due to cost and, more importantly, **data privacy** — transcripts contain personal student data that shouldn't be sent to an external service. Everything in this app runs **100% locally**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | SQLite |
| Matching / parsing engine | Python (openpyxl for XLSX, python-docx for Word templates) |
| File uploads | Multer |

**Architecture:** a React frontend talks to an Express/Node backend over a JSON API. The backend orchestrates local Python processes that do the heavy lifting — parsing transcripts, running the matching algorithm, and generating the final Word document — and persists everything in SQLite.

```
Frontend (React)  ──HTTP/JSON──▶  Backend (Node/Express)  ──spawns──▶  Python modules
                                          │                              (parser, matcher,
                                          ▼                               DOCX exporter)
                                       SQLite
```

---

## Project Structure

```
├── backend/     # Node.js/Express API, SQLite, orchestrates Python processes
├── frontend/    # React + Vite app (Operator flow + Admin panel)
└── resurse_test/ # Anonymized sample transcripts used for testing
```

---

## Getting Started

**Requirements:** Node.js & npm, Python 3.10+, and the dependencies in `backend/requirements.txt`.

### Backend

```bash
cd backend
npm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The backend runs on port `4000`; the frontend URL is shown by Vite once it starts.

---

## How It Was Tested

The app was validated on **45 anonymized transcripts** across three recognition variants (IR1, IR2, IR3), including older transcripts (5–7 years old) and documents from other programs, to stress-test edge cases. A member of the university's actual course-equivalence committee took part in testing and confirmed the manual process timing used as a baseline.

Testing covered file parsing (XLSX/CSV), matching accuracy, duplicate prevention, unsaved-state protection, DOCX export correctness, and portability (the whole project was moved to a different directory and re-tested from scratch).

---

## What's Next

- **Batch processing** — handle multiple students in a queue instead of one at a time
- **Smarter handling of elective/transversal courses** (DCTs), which can range from "Accounting for Non-Accountants" to "History of the Samurai" and don't fit neatly into rule-based matching
- **Institutional authentication** — the current login is intentionally simplified for demo purposes
- A more visual explanation of *why* a specific match was proposed
- Exploring a local (privacy-preserving) semantic matching model as a complement to the rule-based approach

---

## About This Project

This project was developed as a Bachelor's thesis at the **West University of Timișoara – Faculty of Computer Science**, under the coordination of **lect. univ. dr. Ioan Dragan**.

**Author:** Corneanu Denis
