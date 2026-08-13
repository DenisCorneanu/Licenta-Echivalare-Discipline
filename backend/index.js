const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

// Python command cross-platform.
// Prioritatea este:
// 1. variabila de mediu PYTHON_EXECUTABLE / PYTHON;
// 2. mediul virtual local backend/.venv;
// 3. Python-ul disponibil global.
function resolvePythonExecutable() {
  const configured =
    process.env.PYTHON_EXECUTABLE || process.env.PYTHON;

  if (configured && String(configured).trim()) {
    return String(configured).trim();
  }

  const localVirtualEnvironment =
    process.platform === 'win32'
      ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '.venv', 'bin', 'python');

  if (fs.existsSync(localVirtualEnvironment)) {
    return localVirtualEnvironment;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

const PY = resolvePythonExecutable();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- DB ----------
const DB_PATH = path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS faculties (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY,
  faculty_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY(faculty_id) REFERENCES faculties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS program_variants (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  study_year INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id, code),
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS program_templates (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL,
  variant_id INTEGER,
  version TEXT,
  is_active INTEGER DEFAULT 0,
  docx_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,
  FOREIGN KEY(variant_id) REFERENCES program_variants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL,
  year INTEGER,
  semester INTEGER,
  name TEXT NOT NULL,
  name_norm TEXT,
  ects REAL,
  identifier TEXT,
  UNIQUE(template_id, name_norm),
  FOREIGN KEY(template_id) REFERENCES program_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS course_aliases (
  id INTEGER PRIMARY KEY,
  identifier TEXT NOT NULL,
  alias_name TEXT NOT NULL,
  alias_norm TEXT NOT NULL
);

-- Reguli explicite, legate direct de disciplina tinta dintr-un template.
-- Sunt separate de aliasurile vechi bazate pe identifier.
CREATE TABLE IF NOT EXISTS course_equivalency_rules (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_norm TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'academic',
  decision_status TEXT NOT NULL DEFAULT 'needs_review',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id, source_norm),
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_equivalency_rules_lookup
ON course_equivalency_rules(course_id, source_norm, is_active);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL,
  student_name TEXT,
  xlsx_path TEXT,
  status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(template_id) REFERENCES program_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcript_lines (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_norm TEXT,
  ects REAL,
  grade REAL,
  grade_raw TEXT,
  academic_status TEXT,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS course_matches (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  transcript_line_id INTEGER,
  confidence REAL,
  source TEXT NOT NULL DEFAULT 'auto',
  decided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, course_id),
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS course_match_audit (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  old_transcript_line_id INTEGER,
  new_transcript_line_id INTEGER,
  old_source TEXT,
  new_source TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
);
`);

// ---------- DB migrations for scoring and explainability ----------
function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => column.name);

  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

ensureColumn(
  'transcript_lines',
  'year_of_study',
  'year_of_study INTEGER'
);

ensureColumn(
  'transcript_lines',
  'grade_raw',
  'grade_raw TEXT'
);

ensureColumn(
  'transcript_lines',
  'academic_status',
  'academic_status TEXT'
);

ensureColumn(
  'runs',
  'destination_program',
  'destination_program TEXT'
);

ensureColumn(
  'runs',
  'continuation_cohort',
  'continuation_cohort TEXT'
);

ensureColumn(
  'runs',
  'original_filename',
  'original_filename TEXT'
);

ensureColumn(
  'programs',
  'is_active',
  'is_active INTEGER NOT NULL DEFAULT 1'
);

ensureColumn(
  'program_templates',
  'original_filename',
  'original_filename TEXT'
);

ensureColumn(
  'program_templates',
  'variant_id',
  'variant_id INTEGER'
);

db.exec(`
CREATE TABLE IF NOT EXISTS program_matching_aliases (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL,
  canonical_name TEXT NOT NULL,
  canonical_norm TEXT NOT NULL,
  alias_name TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id, alias_norm),
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_program_matching_aliases_lookup
ON program_matching_aliases(program_id, alias_norm, is_active);

CREATE TABLE IF NOT EXISTS program_matching_families (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  level_policy TEXT NOT NULL DEFAULT 'same_if_present',
  decision_status TEXT NOT NULL DEFAULT 'needs_review',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id, code),
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_program_matching_families_program
ON program_matching_families(program_id, is_active, code);

CREATE TABLE IF NOT EXISTS program_matching_family_terms (
  id INTEGER PRIMARY KEY,
  family_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  term_norm TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'contains_phrase',
  is_exclusion INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(family_id, term_norm, is_exclusion),
  FOREIGN KEY(family_id) REFERENCES program_matching_families(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_program_matching_family_terms_lookup
ON program_matching_family_terms(
  family_id,
  is_exclusion,
  is_active,
  term_norm
);

CREATE TABLE IF NOT EXISTS program_matching_direct_rules (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_norm TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_norm TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'forward',
  decision_status TEXT NOT NULL DEFAULT 'needs_review',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id, source_norm, target_norm, direction),
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_program_matching_direct_rules_lookup
ON program_matching_direct_rules(
  program_id,
  source_norm,
  target_norm,
  is_active
);
`);

function normalizeVariantCodeForMigration(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function deriveVariantFromTemplateName(template) {
  const value = String(template.version || '').trim();
  const match = value.match(/(?:^|\b)([A-Za-z]{1,6})\s*[-_ ]?\s*([1-9])(?:\b|[-_ ])/);

  if (match) {
    const code = normalizeVariantCodeForMigration(`${match[1]}${match[2]}`);
    return {
      code,
      name: code,
      study_year: Number(match[2]),
    };
  }

  return {
    code: 'GENERAL',
    name: 'General',
    study_year: null,
  };
}

function migrateTemplatesToProgramVariants() {
  const templates = db.prepare(`
    SELECT id, program_id, version
    FROM program_templates
    WHERE variant_id IS NULL
    ORDER BY program_id, id
  `).all();

  if (!templates.length) return;

  const insertVariant = db.prepare(`
    INSERT OR IGNORE INTO program_variants(
      program_id,
      code,
      name,
      study_year,
      is_active
    )
    VALUES (?, ?, ?, ?, 1)
  `);

  const getVariant = db.prepare(`
    SELECT id
    FROM program_variants
    WHERE program_id = ? AND code = ?
  `);

  const updateTemplate = db.prepare(`
    UPDATE program_templates
    SET variant_id = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    for (const template of templates) {
      const derived = deriveVariantFromTemplateName(template);

      insertVariant.run(
        template.program_id,
        derived.code,
        derived.name,
        derived.study_year
      );

      const variant = getVariant.get(template.program_id, derived.code);

      if (variant) {
        updateTemplate.run(variant.id, template.id);
      }
    }
  });

  transaction();
}

migrateTemplatesToProgramVariants();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_program_variants_program
  ON program_variants(program_id, is_active, study_year, code);

  CREATE INDEX IF NOT EXISTS idx_program_templates_variant
  ON program_templates(variant_id, is_active);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_template_per_variant
  ON program_templates(variant_id)
  WHERE variant_id IS NOT NULL AND is_active = 1;
`);

ensureColumn(
  'course_matches',
  'suggested_transcript_line_id',
  'suggested_transcript_line_id INTEGER'
);

ensureColumn(
  'course_matches',
  'decision_status',
  "decision_status TEXT NOT NULL DEFAULT 'no_match'"
);

ensureColumn(
  'course_matches',
  'match_reason',
  'match_reason TEXT'
);

ensureColumn(
  'course_matches',
  'score_details',
  'score_details TEXT'
);

// Marcheaza bine si corect datele create
db.exec(`
  UPDATE course_matches
  SET decision_status = CASE
    WHEN source = 'manual' THEN 'manual'
    WHEN transcript_line_id IS NOT NULL THEN 'auto'
    ELSE 'no_match'
  END
  WHERE decision_status IS NULL
     OR decision_status = ''
     OR (decision_status = 'no_match' AND transcript_line_id IS NOT NULL);
`);

const repairDuplicateMatches = db.transaction(() => {
  const duplicateGroups = db.prepare(`
    SELECT run_id, transcript_line_id
    FROM course_matches
    WHERE transcript_line_id IS NOT NULL
    GROUP BY run_id, transcript_line_id
    HAVING COUNT(*) > 1
  `).all();

  const getMatchesForLine = db.prepare(`
    SELECT id, course_id, transcript_line_id, source
    FROM course_matches
    WHERE run_id = ? AND transcript_line_id = ?
    ORDER BY decided_at DESC, id DESC
  `);

  const clearDuplicate = db.prepare(`
    UPDATE course_matches
    SET transcript_line_id = NULL,
        suggested_transcript_line_id = NULL,
        confidence = NULL,
        source = 'system',
        decision_status = 'no_match',
        match_reason = 'Potrivire eliminata: aceeasi disciplina era folosita de doua ori.',
        score_details = NULL,
        decided_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const addCleanupAudit = db.prepare(`
    INSERT INTO course_match_audit (
      run_id,
      course_id,
      old_transcript_line_id,
      new_transcript_line_id,
      old_source,
      new_source,
      action
    )
    VALUES (?, ?, ?, NULL, ?, 'system', 'system_cleanup_duplicate')
  `);

  let fixedCount = 0;

  for (const group of duplicateGroups) {
    const matches = getMatchesForLine.all(
      group.run_id,
      group.transcript_line_id
    );

    // Pastreaza cea mai recenta decizie si anuleaza restul.
    for (const duplicate of matches.slice(1)) {
      clearDuplicate.run(duplicate.id);

      addCleanupAudit.run(
        group.run_id,
        duplicate.course_id,
        duplicate.transcript_line_id,
        duplicate.source
      );

      fixedCount += 1;
    }
  }

  return fixedCount;
});

const fixedDuplicateMatches = repairDuplicateMatches();

if (fixedDuplicateMatches > 0) {
  console.warn(
    `Au fost corectate ${fixedDuplicateMatches} potriviri duplicate din baza de date.`
  );
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_course_matches_one_transcript_per_run
  ON course_matches(run_id, transcript_line_id)
  WHERE transcript_line_id IS NOT NULL;
`);

const insTranscriptLine = db.prepare(`
  INSERT INTO transcript_lines(
    run_id,
    name,
    name_norm,
    ects,
    grade,
    grade_raw,
    academic_status,
    year_of_study
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertMatchStmt = db.prepare(`
  INSERT INTO course_matches(
    run_id,
    course_id,
    transcript_line_id,
    suggested_transcript_line_id,
    confidence,
    source,
    decision_status,
    match_reason,
    score_details
  )
  VALUES (
    @run_id,
    @course_id,
    @transcript_line_id,
    @suggested_transcript_line_id,
    @confidence,
    @source,
    @decision_status,
    @match_reason,
    @score_details
  )
  ON CONFLICT(run_id, course_id) DO UPDATE SET
    transcript_line_id = excluded.transcript_line_id,
    suggested_transcript_line_id = excluded.suggested_transcript_line_id,
    confidence = excluded.confidence,
    source = excluded.source,
    decision_status = excluded.decision_status,
    match_reason = excluded.match_reason,
    score_details = excluded.score_details,
    decided_at = CURRENT_TIMESTAMP
`);

// ---------- helpers ----------
function getTemplateCourses(templateId) {
  return db.prepare(`
    SELECT id, name, name_norm, ects, year, semester, identifier
    FROM courses
    WHERE template_id=?
    ORDER BY year, semester, id
  `).all(templateId);
}

const ROMAN_NUMERALS = {
  vi: '6',
  iv: '4',
  iii: '3',
  ii: '2',
  v: '5',
  i: '1',
};

const AUTO_THRESHOLD = 0.88;
const REVIEW_THRESHOLD = 0.62;

function foldText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function romanToArabic(value) {
  return String(value || '').replace(
    /\b(vi|iv|iii|ii|v|i)\b/gi,
    (token) => ROMAN_NUMERALS[token.toLowerCase()] || token
  );
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripSpecializationSuffix(value) {
  return String(value || '').replace(
    /\s[-–]\s*(?:ia|sc|is|rob|ai)(?:\s*,\s*(?:ia|sc|is|rob|ai))*\s*$/i,
    ' '
  );
}

function canonicalCourseName(value) {
  let text = foldText(value);

  // In exporturi, aceste expresii descriu statusul, nu disciplina.
  text = stripSpecializationSuffix(text);
  text = text.replace(/\([^)]*\)/g, ' ');
  text = text.replace(
    /\b(?:echivalata|echivalat|recunoscuta|recunoscut)\b/g,
    ' '
  );
  text = text.replace(/\bnota\s+\d+(?:[.,]\d+)?\b/g, ' ');
  text = romanToArabic(text);
  text = text.replace(/[^a-z0-9\s]/g, ' ');

  return normalizeSpaces(text);
}

function extractAbbreviations(value) {
  const abbreviations = [];

  for (const raw of String(value || '').matchAll(/\(([^)]{1,40})\)/g)) {
    const candidate = canonicalCourseName(raw[1]);

    if (candidate && candidate.length <= 20) {
      abbreviations.push(candidate);
    }
  }

  return [...new Set(abbreviations)];
}

function detectLevel(canonicalName) {
  const name = normalizeSpaces(canonicalName);

  if (!name) {
    return null;
  }

  // Nivelul academic trebuie sa fie un sufix al denumirii.
  // Nu interpretam ca nivel numere din durate precum:
  // "4 sapt x 6 ore/zi" sau "120 ore/semestru".
  const match = name.match(
    /\b([1-6])(?:\s+(?:optional|facultativ|obligatoriu))?\s*$/
  );

  return match ? Number(match[1]) : null;
}

function detectFamily(canonicalName) {
  const name = String(canonicalName || '');

  if (
    name.includes('limba straina') ||
    name.includes('limba engleza') ||
    name.includes('english language')
  ) {
    return 'language';
  }

  if (
    name.includes('educatie fizica') ||
    name.includes('physical education')
  ) {
    return 'physical_education';
  }

  if (
    name.includes('stagiu de practica') ||
    name.startsWith('practica ')
  ) {
    return 'practice';
  }

  if (
    name.includes('consiliere') ||
    name.includes('orientare in cariera')
  ) {
    return 'counselling';
  }

  return null;
}

function analyseDisciplineName(name) {
  const canonical = canonicalCourseName(name);

  return {
    raw: String(name || ''),
    canonical,
    abbreviations: extractAbbreviations(name),
    family: detectFamily(canonical),
    level: detectLevel(canonical),
  };
}

function splitCourseOptions(courseName) {
  const rawOptions = String(courseName || '')
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const options = rawOptions.map(analyseDisciplineName);

  return options.length > 0
    ? options
    : [analyseDisciplineName(courseName)];
}

function tokenSet(value) {
  return new Set(
    String(value || '')
      .split(/\s+/g)
      .filter(Boolean)
  );
}

function tokenJaccard(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);

  if (!left.size || !right.size) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;

  return union === 0 ? 0 : intersection / union;
}

function tokenContainment(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);

  if (!left.size || !right.size) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const smaller = Math.min(left.size, right.size);

  return smaller === 0 ? 0 : intersection / smaller;
}

function diceCoefficient(a, b) {
  const left = String(a || '').replace(/\s/g, '');
  const right = String(b || '').replace(/\s/g, '');

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const pairs = new Map();

  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }

  let matches = 0;

  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = pairs.get(pair) || 0;

    if (count > 0) {
      pairs.set(pair, count - 1);
      matches += 1;
    }
  }

  return (2 * matches) / (left.length + right.length - 2);
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function scoreNamePair(courseOption, transcript) {
  const courseName = courseOption.canonical;
  const transcriptName = transcript.canonical;

  if (!courseName || !transcriptName) {
    return {
      score: 0,
      reason: 'Denumire lipsa dupa normalizare.',
      details: {},
    };
  }

  if (
    courseOption.family &&
    transcript.family &&
    courseOption.family !== transcript.family
  ) {
    return {
      score: 0,
      reason: 'Familii de discipline incompatibile.',
      details: {
        course_family: courseOption.family,
        transcript_family: transcript.family,
      },
    };
  }

  if (
    courseOption.family &&
    courseOption.family === transcript.family
  ) {
    if (
      courseOption.level !== null &&
      transcript.level !== null &&
      courseOption.level !== transcript.level
    ) {
      return {
        score: 0,
        reason: 'Aceeasi familie, dar nivel diferit.',
        details: {
          family: courseOption.family,
          course_level: courseOption.level,
          transcript_level: transcript.level,
        },
      };
    }

    if (
      courseOption.level !== null &&
      transcript.level !== null &&
      courseOption.level === transcript.level
    ) {
      return {
        score: 0.96,
        reason: `Familie speciala identificata: ${courseOption.family}, nivel ${courseOption.level}.`,
        details: {
          family: courseOption.family,
          level: courseOption.level,
          name_score: 0.96,
        },
      };
    }

    if (
      courseOption.family === 'practice' ||
      courseOption.family === 'counselling'
    ) {
      return {
        score: 0.9,
        reason: `Familie speciala identificata: ${courseOption.family}.`,
        details: {
          family: courseOption.family,
          name_score: 0.9,
        },
      };
    }
  }

  if (courseName === transcriptName) {
    return {
      score: 0.98,
      reason: 'Denumire identica dupa normalizare.',
      details: {
        exact_name: true,
        name_score: 0.98,
      },
    };
  }

  const jaccard = tokenJaccard(courseName, transcriptName);
  const containment = tokenContainment(courseName, transcriptName);
  const dice = diceCoefficient(courseName, transcriptName);

  let score = 0.55 * jaccard + 0.25 * containment + 0.2 * dice;

  const sharedAbbreviation = courseOption.abbreviations.some((abbr) =>
    transcript.abbreviations.includes(abbr)
  );

  if (sharedAbbreviation && score >= 0.45) {
    score += 0.08;
  }

  // "Programare I" si "Programare II" nu trebuie acceptate ca echivalente.
  if (
    courseOption.level !== null &&
    transcript.level !== null &&
    courseOption.level !== transcript.level
  ) {
    score *= 0.25;
  }

  return {
    score: roundScore(score),
    reason: sharedAbbreviation
      ? 'Denumire apropiata si abreviere comuna.'
      : 'Similaritate calculata pe tokeni si caractere.',
    details: {
      jaccard: roundScore(jaccard),
      containment: roundScore(containment),
      dice: roundScore(dice),
      shared_abbreviation: sharedAbbreviation,
      name_score: roundScore(score),
    },
  };
}

function ectsAdjustment(courseEcts, transcriptEcts) {
  const courseValue = Number(courseEcts);
  const transcriptValue = Number(transcriptEcts);

  if (!Number.isFinite(courseValue) || !Number.isFinite(transcriptValue)) {
    return { adjustment: 0, note: 'ECTS indisponibil.' };
  }

  const difference = Math.abs(courseValue - transcriptValue);

  if (difference < 0.01) {
    return { adjustment: 0.03, note: 'ECTS identice.' };
  }

  if (difference >= 3) {
    return { adjustment: -0.05, note: `Diferenta ECTS mare (${difference}).` };
  }

  return { adjustment: -0.015, note: `Diferenta ECTS (${difference}).` };
}

function buildAliasesByCourse(courses) {
  const aliases = db
    .prepare(`
      SELECT identifier, alias_name, alias_norm
      FROM course_aliases
    `)
    .all();

  const coursesByIdentifier = new Map();

  for (const course of courses) {
    if (!course.identifier) {
      continue;
    }

    if (!coursesByIdentifier.has(course.identifier)) {
      coursesByIdentifier.set(course.identifier, []);
    }

    coursesByIdentifier.get(course.identifier).push(course.id);
  }

  const aliasesByCourse = new Map(courses.map((course) => [course.id, []]));

  for (const alias of aliases) {
    const courseIds = coursesByIdentifier.get(alias.identifier) || [];
    const aliasKey = canonicalCourseName(alias.alias_name || alias.alias_norm);

    if (!aliasKey) {
      continue;
    }

    for (const courseId of courseIds) {
      aliasesByCourse.get(courseId).push(aliasKey);
    }
  }

  return aliasesByCourse;
}


function buildRulesByCourse(courses) {
  const rulesByCourse = new Map(
    courses.map((course) => [course.id, new Map()])
  );

  if (courses.length === 0) {
    return rulesByCourse;
  }

  const courseIds = courses.map((course) => course.id);
  const placeholders = courseIds.map(() => '?').join(', ');

  const rules = db.prepare(`
    SELECT
      id,
      course_id,
      source_name,
      source_norm,
      rule_type,
      decision_status,
      notes
    FROM course_equivalency_rules
    WHERE is_active = 1
      AND course_id IN (${placeholders})
    ORDER BY id ASC
  `).all(...courseIds);

  for (const rule of rules) {
    const sourceNorm = canonicalCourseName(
      rule.source_norm || rule.source_name
    );

    if (!sourceNorm || !rulesByCourse.has(rule.course_id)) {
      continue;
    }

    rulesByCourse.get(rule.course_id).set(sourceNorm, {
      ...rule,
      source_norm: sourceNorm,
    });
  }

  return rulesByCourse;
}


function programMatchingPairKey(sourceNorm, targetNorm) {
  return `${sourceNorm}\u0000${targetNorm}`;
}

function programMatchingTermMatches(nameNorm, termNorm, matchMode) {
  const name = canonicalCourseName(nameNorm);
  const term = canonicalCourseName(termNorm);

  if (!name || !term) {
    return false;
  }

  if (matchMode === 'exact') {
    return name === term;
  }

  if (matchMode === 'starts_with') {
    return name === term || name.startsWith(`${term} `);
  }

  const paddedName = ` ${name} `;
  const paddedTerm = ` ${term} `;

  return paddedName.includes(paddedTerm);
}

function buildProgramAliasResolver(aliasRows) {
  const parent = new Map();

  const ensure = (value) => {
    if (value && !parent.has(value)) {
      parent.set(value, value);
    }
  };

  const find = (value) => {
    ensure(value);

    let current = value;

    while (parent.get(current) !== current) {
      current = parent.get(current);
    }

    let cursor = value;

    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor);
      parent.set(cursor, current);
      cursor = next;
    }

    return current;
  };

  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  };

  for (const row of aliasRows) {
    const canonicalNorm = canonicalCourseName(
      row.canonical_norm || row.canonical_name
    );
    const aliasNorm = canonicalCourseName(
      row.alias_norm || row.alias_name
    );

    if (!canonicalNorm || !aliasNorm) {
      continue;
    }

    ensure(canonicalNorm);
    ensure(aliasNorm);
    union(canonicalNorm, aliasNorm);
  }

  return {
    equivalent(left, right) {
      const leftNorm = canonicalCourseName(left);
      const rightNorm = canonicalCourseName(right);

      if (!leftNorm || !rightNorm) {
        return false;
      }

      if (!parent.has(leftNorm) || !parent.has(rightNorm)) {
        return false;
      }

      return find(leftNorm) === find(rightNorm);
    },
  };
}

function buildProgramMatchingRuntime(programId) {
  const parsedProgramId = Number(programId);

  if (!Number.isInteger(parsedProgramId) || parsedProgramId <= 0) {
    return {
      program_id: null,
      aliases: [],
      alias_resolver: buildProgramAliasResolver([]),
      families: [],
      direct_rules_by_pair: new Map(),
      counts: {
        aliases: 0,
        families: 0,
        family_terms: 0,
        direct_rules: 0,
      },
    };
  }

  const aliases = db.prepare(`
    SELECT *
    FROM program_matching_aliases
    WHERE program_id = ?
      AND is_active = 1
    ORDER BY id ASC
  `).all(parsedProgramId);

  const families = db.prepare(`
    SELECT *
    FROM program_matching_families
    WHERE program_id = ?
      AND is_active = 1
    ORDER BY id ASC
  `).all(parsedProgramId);

  const familyIds = families.map((family) => family.id);
  let familyTerms = [];

  if (familyIds.length > 0) {
    const placeholders = familyIds.map(() => '?').join(', ');

    familyTerms = db.prepare(`
      SELECT *
      FROM program_matching_family_terms
      WHERE family_id IN (${placeholders})
        AND is_active = 1
      ORDER BY id ASC
    `).all(...familyIds);
  }

  const termsByFamily = new Map(
    families.map((family) => [
      family.id,
      {
        included: [],
        exclusions: [],
      },
    ])
  );

  for (const term of familyTerms) {
    const bucket = termsByFamily.get(term.family_id);

    if (!bucket) {
      continue;
    }

    const normalizedTerm = canonicalCourseName(
      term.term_norm || term.term
    );

    if (!normalizedTerm) {
      continue;
    }

    const normalizedRow = {
      ...term,
      term_norm: normalizedTerm,
    };

    if (term.is_exclusion) {
      bucket.exclusions.push(normalizedRow);
    } else {
      bucket.included.push(normalizedRow);
    }
  }

  const directRules = db.prepare(`
    SELECT *
    FROM program_matching_direct_rules
    WHERE program_id = ?
      AND is_active = 1
    ORDER BY id ASC
  `).all(parsedProgramId);

  const directRulesByPair = new Map();

  const addDirectRule = (sourceNorm, targetNorm, rule) => {
    const key = programMatchingPairKey(sourceNorm, targetNorm);

    if (!directRulesByPair.has(key)) {
      directRulesByPair.set(key, []);
    }

    directRulesByPair.get(key).push(rule);
  };

  for (const rule of directRules) {
    const sourceNorm = canonicalCourseName(
      rule.source_norm || rule.source_name
    );
    const targetNorm = canonicalCourseName(
      rule.target_norm || rule.target_name
    );

    if (!sourceNorm || !targetNorm) {
      continue;
    }

    const normalizedRule = {
      ...rule,
      source_norm: sourceNorm,
      target_norm: targetNorm,
    };

    addDirectRule(sourceNorm, targetNorm, normalizedRule);

    if (rule.direction === 'bidirectional') {
      addDirectRule(targetNorm, sourceNorm, normalizedRule);
    }
  }

  const decisionPriority = {
    blocked: 3,
    auto: 2,
    needs_review: 1,
  };

  for (const rules of directRulesByPair.values()) {
    rules.sort((left, right) => {
      const priorityDifference =
        (decisionPriority[right.decision_status] || 0) -
        (decisionPriority[left.decision_status] || 0);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return Number(right.id) - Number(left.id);
    });
  }

  return {
    program_id: parsedProgramId,
    aliases,
    alias_resolver: buildProgramAliasResolver(aliases),
    families: families.map((family) => ({
      ...family,
      included_terms:
        termsByFamily.get(family.id)?.included || [],
      exclusion_terms:
        termsByFamily.get(family.id)?.exclusions || [],
    })),
    direct_rules_by_pair: directRulesByPair,
    counts: {
      aliases: aliases.length,
      families: families.length,
      family_terms: familyTerms.length,
      direct_rules: directRules.length,
    },
  };
}

function findProgramDirectRule(
  runtime,
  sourceNorm,
  targetNorm
) {
  if (!runtime?.direct_rules_by_pair) {
    return null;
  }

  const key = programMatchingPairKey(
    canonicalCourseName(sourceNorm),
    canonicalCourseName(targetNorm)
  );

  return runtime.direct_rules_by_pair.get(key)?.[0] || null;
}

function inspectProgramFamilyName(runtime, family, nameNorm) {
  const canonical = canonicalCourseName(nameNorm);

  if (!canonical) {
    return {
      family,
      canonical,
      included: false,
      excluded: false,
      matched_term: null,
      exclusion_term: null,
    };
  }

  const exclusionTerm = family.exclusion_terms.find((term) =>
    programMatchingTermMatches(
      canonical,
      term.term_norm,
      term.match_mode
    )
  );

  if (exclusionTerm) {
    return {
      family,
      canonical,
      included: false,
      excluded: true,
      matched_term: null,
      exclusion_term: exclusionTerm,
    };
  }

  const matchedTerm = family.included_terms.find((term) =>
    programMatchingTermMatches(
      canonical,
      term.term_norm,
      term.match_mode
    )
  );

  return {
    family,
    canonical,
    included: Boolean(matchedTerm),
    excluded: false,
    matched_term: matchedTerm || null,
    exclusion_term: null,
  };
}

function evaluateProgramFamilyPair(
  runtime,
  courseOption,
  transcript
) {
  if (!runtime?.families?.length) {
    return null;
  }

  const successful = [];
  const exclusionBlocks = [];
  const courseMemberships = [];
  const transcriptMemberships = [];

  for (const family of runtime.families) {
    const courseState = inspectProgramFamilyName(
      runtime,
      family,
      courseOption.canonical
    );
    const transcriptState = inspectProgramFamilyName(
      runtime,
      family,
      transcript.canonical
    );

    if (courseState.included) {
      courseMemberships.push(family.code);
    }

    if (transcriptState.included) {
      transcriptMemberships.push(family.code);
    }

    if (
      (courseState.included && transcriptState.excluded) ||
      (transcriptState.included && courseState.excluded)
    ) {
      exclusionBlocks.push({
        family,
        courseState,
        transcriptState,
      });
      continue;
    }

    if (!courseState.included || !transcriptState.included) {
      continue;
    }

    const courseLevel = courseOption.level;
    const transcriptLevel = transcript.level;
    const levelPolicy = family.level_policy || 'same_if_present';

    if (levelPolicy === 'same_required') {
      if (courseLevel === null || transcriptLevel === null) {
        successful.push({
          blocked: true,
          family,
          reason:
            `Familia ${family.name}: nivelul este obligatoriu pe ambele denumiri.`,
          details: {
            family_id: family.id,
            family_code: family.code,
            family_name: family.name,
            level_policy: levelPolicy,
            course_level: courseLevel,
            transcript_level: transcriptLevel,
          },
        });
        continue;
      }

      if (courseLevel !== transcriptLevel) {
        successful.push({
          blocked: true,
          family,
          reason:
            `Familia ${family.name}: nivelurile sunt diferite.`,
          details: {
            family_id: family.id,
            family_code: family.code,
            family_name: family.name,
            level_policy: levelPolicy,
            course_level: courseLevel,
            transcript_level: transcriptLevel,
          },
        });
        continue;
      }
    }

    if (
      levelPolicy === 'same_if_present' &&
      courseLevel !== null &&
      transcriptLevel !== null &&
      courseLevel !== transcriptLevel
    ) {
      successful.push({
        blocked: true,
        family,
        reason:
          `Familia ${family.name}: nivelurile explicite sunt diferite.`,
        details: {
          family_id: family.id,
          family_code: family.code,
          family_name: family.name,
          level_policy: levelPolicy,
          course_level: courseLevel,
          transcript_level: transcriptLevel,
        },
      });
      continue;
    }

    const levelMissing =
      levelPolicy === 'same_if_present' &&
      (courseLevel === null || transcriptLevel === null);

    const configuredDecision =
      family.decision_status === 'auto'
        ? 'auto'
        : 'needs_review';

    const effectiveDecision =
      configuredDecision === 'auto' && levelMissing
        ? 'needs_review'
        : configuredDecision;

    successful.push({
      blocked: false,
      family,
      score: effectiveDecision === 'auto' ? 0.96 : 0.87,
      decision_status: effectiveDecision,
      reason:
        effectiveDecision === 'auto'
          ? `Familie configurata: ${family.name}.`
          : levelMissing && configuredDecision === 'auto'
            ? `Familie configurata: ${family.name}; un nivel lipseste, necesita verificare.`
            : `Familie configurata pentru verificare: ${family.name}.`,
      details: {
        family_id: family.id,
        family_code: family.code,
        family_name: family.name,
        configured_decision: configuredDecision,
        effective_decision: effectiveDecision,
        level_policy: levelPolicy,
        course_level: courseLevel,
        transcript_level: transcriptLevel,
        course_term: courseState.matched_term?.term || null,
        transcript_term:
          transcriptState.matched_term?.term || null,
      },
    });
  }

  const validMatches = successful
    .filter((result) => !result.blocked)
    .sort((left, right) => right.score - left.score);

  if (validMatches.length > 0) {
    return validMatches[0];
  }

  const blockedFamilyMatch = successful.find(
    (result) => result.blocked
  );

  if (blockedFamilyMatch) {
    return blockedFamilyMatch;
  }

  if (exclusionBlocks.length > 0) {
    const blocked = exclusionBlocks[0];

    return {
      blocked: true,
      family: blocked.family,
      reason:
        `Potrivire blocata de exceptia familiei ${blocked.family.name}.`,
      details: {
        family_id: blocked.family.id,
        family_code: blocked.family.code,
        family_name: blocked.family.name,
        course_exclusion:
          blocked.courseState.exclusion_term?.term || null,
        transcript_exclusion:
          blocked.transcriptState.exclusion_term?.term || null,
      },
    };
  }

  const commonFamilies = courseMemberships.filter((code) =>
    transcriptMemberships.includes(code)
  );

  if (
    courseMemberships.length > 0 &&
    transcriptMemberships.length > 0 &&
    commonFamilies.length === 0
  ) {
    return {
      blocked: true,
      family: null,
      reason: 'Familii configurate incompatibile.',
      details: {
        course_families: courseMemberships,
        transcript_families: transcriptMemberships,
      },
    };
  }

  return null;
}

function directRuleCandidate(rule, isPackage) {
  if (!rule) {
    return null;
  }

  if (rule.decision_status === 'blocked') {
    return {
      score: 0,
      reason: 'Potrivire blocata prin regula directa.',
      details: {
        program_matching_source: 'direct_rule',
        direct_rule_id: rule.id,
        direct_rule_status: rule.decision_status,
        direct_rule_direction: rule.direction,
        direct_rule_source: rule.source_name,
        direct_rule_target: rule.target_name,
        direct_rule_notes: rule.notes || null,
        blocked: true,
        package: isPackage,
      },
      matchedOption: null,
    };
  }

  const isAuto = rule.decision_status === 'auto';

  return {
    score: isAuto ? 1 : 0.87,
    reason: isAuto
      ? 'Regula directa aprobata pentru Auto.'
      : 'Regula directa configurata pentru verificare.',
    details: {
      program_matching_source: 'direct_rule',
      direct_rule_id: rule.id,
      direct_rule_status: rule.decision_status,
      direct_rule_direction: rule.direction,
      direct_rule_source: rule.source_name,
      direct_rule_target: rule.target_name,
      direct_rule_notes: rule.notes || null,
      name_score: isAuto ? 1 : 0.87,
      package: isPackage,
    },
    matchedOption: null,
  };
}


function scoreCourseAgainstTranscript(
  course,
  transcriptLine,
  aliasesByCourse,
  rulesByCourse,
  programMatchingRuntime
) {
  const transcript = analyseDisciplineName(transcriptLine.name);
  const options = splitCourseOptions(course.name);
  const isPackage = options.length > 1;
  const legacyAliases = aliasesByCourse.get(course.id) || [];
  const legacyRule = rulesByCourse
    ?.get(course.id)
    ?.get(transcript.canonical);

  // 1. Regulile directe configurate pe program au prioritate maxima.
  for (const option of options) {
    const directRule = findProgramDirectRule(
      programMatchingRuntime,
      transcript.canonical,
      option.canonical
    );

    if (directRule) {
      const directCandidate = directRuleCandidate(
        directRule,
        isPackage
      );

      return {
        ...directCandidate,
        matchedOption: option,
        details: {
          ...(directCandidate.details || {}),
          matched_option: option.raw,
          matching_config_program_id:
            programMatchingRuntime?.program_id || null,
        },
      };
    }
  }

  // 2. Regulile vechi, legate de o disciplina tinta concreta, raman active.
  if (legacyRule) {
    const isAuto = legacyRule.decision_status === 'auto';

    return {
      score: isAuto ? 1 : 0.87,
      reason: isAuto
        ? `Regula veche aprobata (${legacyRule.rule_type}).`
        : `Regula veche configurata pentru verificare (${legacyRule.rule_type}).`,
      details: {
        program_matching_source: 'legacy_course_rule',
        rule_id: legacyRule.id,
        rule_type: legacyRule.rule_type,
        rule_status: legacyRule.decision_status,
        rule_source_name: legacyRule.source_name,
        rule_notes: legacyRule.notes || null,
        name_score: isAuto ? 1 : 0.87,
        package: isPackage,
      },
      matchedOption: null,
    };
  }

  let best = null;

  for (const option of options) {
    let scored = null;
    let fixedDecision = false;

    // 3. Egalitatea dupa normalizare este in continuare cea mai clara
    // potrivire nominala si nu necesita configurare in Admin.
    if (option.canonical === transcript.canonical) {
      scored = {
        score: 0.98,
        reason: 'Denumire identica dupa normalizare.',
        details: {
          program_matching_source: 'exact_name',
          exact_name: true,
          name_score: 0.98,
        },
      };
    }

    // 4. Aliasurile noi sunt bidirectionale: toate denumirile din acelasi
    // grup reprezinta aceeasi disciplina.
    if (
      !scored &&
      programMatchingRuntime?.alias_resolver?.equivalent(
        option.canonical,
        transcript.canonical
      )
    ) {
      scored = {
        score: 0.99,
        reason: 'Alias configurat pentru programul academic.',
        details: {
          program_matching_source: 'program_alias',
          alias: true,
          name_score: 0.99,
          matching_config_program_id:
            programMatchingRuntime.program_id,
        },
      };
    }

    // 5. Aliasurile vechi pe identifier raman fallback.
    if (
      !scored &&
      legacyAliases.includes(transcript.canonical)
    ) {
      scored = {
        score: 0.99,
        reason: 'Alias vechi configurat pentru aceasta disciplina.',
        details: {
          program_matching_source: 'legacy_alias',
          alias: true,
          name_score: 0.99,
        },
      };
    }

    // 6. Familiile configurate se aplica inaintea familiei hardcodate si
    // a scorului fuzzy. Exceptiile si incompatibilitatile blocheaza perechea.
    if (!scored) {
      const familyResult = evaluateProgramFamilyPair(
        programMatchingRuntime,
        option,
        transcript
      );

      if (familyResult?.blocked) {
        scored = {
          score: 0,
          reason: familyResult.reason,
          details: {
            program_matching_source: 'program_family',
            ...(familyResult.details || {}),
            blocked: true,
            name_score: 0,
          },
        };
        fixedDecision = true;
      } else if (familyResult) {
        scored = {
          score: familyResult.score,
          reason: familyResult.reason,
          details: {
            program_matching_source: 'program_family',
            ...(familyResult.details || {}),
            name_score: familyResult.score,
          },
        };
        fixedDecision = true;
      }
    }

    // 7. Fallback complet la comportamentul anterior:
    // familii hardcodate + Jaccard + containment + Dice.
    if (!scored) {
      scored = scoreNamePair(option, transcript);
    }

    const ects = ectsAdjustment(course.ects, transcriptLine.ects);
    let finalScore = fixedDecision
      ? scored.score
      : scored.score + ects.adjustment;

    // Pentru un pachet, doar o potrivire foarte clara pe una dintre optiuni
    // poate fi acceptata automat. Similaritatile vagi raman la review.
    if (isPackage && scored.score < 0.92) {
      finalScore = Math.min(finalScore, 0.78);
    }

    const candidate = {
      score: roundScore(finalScore),
      reason: scored.reason,
      details: {
        ...scored.details,
        ects_adjustment: fixedDecision ? 0 : ects.adjustment,
        ects_note: fixedDecision
          ? 'Decizie configurata; ECTS nu modifica pragul.'
          : ects.note,
        package: isPackage,
        matched_option: option.raw,
        matching_config_counts:
          programMatchingRuntime?.counts || null,
      },
      matchedOption: option,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      score: 0,
      reason: 'Nu exista optiune comparabila.',
      details: {},
      matchedOption: null,
    };
  }

  if (isPackage) {
    best.reason = best.score >= AUTO_THRESHOLD
      ? `Potrivire exacta pe optiunea din pachet: ${best.matchedOption.raw}.`
      : `Pachet de discipline: ${best.reason} Necesita verificare.`;
  }

  return best;
}

function hungarianMinCost(costs) {
  const rowCount = costs.length;

  if (rowCount === 0) {
    return [];
  }

  const columnCount = costs[0].length;

  if (rowCount > columnCount) {
    throw new Error('Hungarian requires at least as many columns as rows.');
  }

  const u = Array(rowCount + 1).fill(0);
  const v = Array(columnCount + 1).fill(0);
  const p = Array(columnCount + 1).fill(0);
  const way = Array(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array(columnCount + 1).fill(Infinity);
    const used = Array(columnCount + 1).fill(false);

    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Infinity;
      let column1 = 0;

      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) {
          continue;
        }

        const current =
          costs[row0 - 1][column - 1] - u[row0] - v[column];

        if (current < minValue[column]) {
          minValue[column] = current;
          way[column] = column0;
        }

        if (minValue[column] < delta) {
          delta = minValue[column];
          column1 = column;
        }
      }

      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }

      column0 = column1;
    } while (p[column0] !== 0);

    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = Array(rowCount).fill(-1);

  for (let column = 1; column <= columnCount; column += 1) {
    if (p[column] !== 0) {
      assignment[p[column] - 1] = column - 1;
    }
  }

  return assignment;
}

function maximumWeightAssignment(weights) {
  if (weights.length === 0) {
    return [];
  }

  const maximum = Math.max(0, ...weights.flat());
  const costs = weights.map((row) =>
    row.map((weight) => maximum - weight)
  );

  return hungarianMinCost(costs);
}


function summarizeMatchDecisions(rows) {
  const stats = {
    auto: 0,
    manual: 0,
    needs_review: 0,
    no_match: 0,
  };

  for (const row of rows) {
    const status = row.decision_status || 'no_match';

    if (Object.prototype.hasOwnProperty.call(stats, status)) {
      stats[status] += 1;
    } else {
      stats.no_match += 1;
    }
  }

  stats.accepted = stats.auto + stats.manual;
  stats.total = rows.length;

  return stats;
}

function apiError(status, message) {

  const error = new Error(message);
  error.status = status;
  return error;
}

// ---------- UPLOADS ----------
// ---------- UPLOADS ----------
const upBase = path.join(__dirname, 'uploads');
const upStudents = path.join(upBase, 'students');
const upTemplates = path.join(upBase, 'templates');
const upOutputs = path.join(upBase, 'outputs');

for (const p of [upBase, upStudents, upTemplates, upOutputs]) {
  fs.mkdirSync(p, { recursive: true });
}

function isPathInsideDirectory(filePath, directoryPath) {
  if (!filePath || !directoryPath) return false;

  const candidate = path.resolve(filePath);
  const root = path.resolve(directoryPath);
  const relative = path.relative(root, candidate);

  return (
    relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    )
  );
}

function toPortableStoredPath(filePath) {
  if (!filePath) return null;

  const absolutePath = path.resolve(filePath);

  if (!isPathInsideDirectory(absolutePath, upBase)) {
    return String(filePath);
  }

  // In baza de date salvam cai precum:
  // uploads/templates/fisier.docx
  // Nu salvam C:\Users\...\backend\uploads\...
  return path
    .relative(__dirname, absolutePath)
    .split(path.sep)
    .join('/');
}

function getStoredFileCandidates(storedPath, preferredDirectory) {
  const rawPath = String(storedPath || '').trim();

  if (!rawPath) return [];

  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidate) return;

    const resolved = path.resolve(candidate);

    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  if (path.isAbsolute(rawPath)) {
    // Compatibilitate cu valorile absolute deja existente in data.db.
    addCandidate(rawPath);
  } else {
    const normalizedRelative = rawPath.replace(/[\\/]+/g, path.sep);

    // Formatul portabil nou: relativ la folderul backend.
    addCandidate(path.join(__dirname, normalizedRelative));

    // Compatibilitate defensiva cu eventuale cai relative vechi.
    addCandidate(normalizedRelative);
  }

  if (preferredDirectory) {
    // Dupa mutarea proiectului, o cale absoluta veche nu mai exista.
    // Fisierul este cautat in directorul gestionat, pastrand numele unic
    // generat la upload.
    addCandidate(
      path.join(preferredDirectory, path.basename(rawPath))
    );
  }

  return candidates;
}

function resolveStoredFilePath(storedPath, preferredDirectory) {
  const candidates = getStoredFileCandidates(
    storedPath,
    preferredDirectory
  );

  return (
    candidates.find((candidate) => fs.existsSync(candidate))
    || candidates[0]
    || null
  );
}

function resolveTemplateFilePath(storedPath) {
  return resolveStoredFilePath(storedPath, upTemplates);
}

function resolveTranscriptFilePath(storedPath) {
  return resolveStoredFilePath(storedPath, upStudents);
}

const MAX_UPLOAD_SIZE = 15 * 1024 * 1024; // 15 MB

function getFileExtension(fileName = '') {
  return path.extname(String(fileName)).toLowerCase();
}

function readFilePrefix(filePath, length = 4096) {
  const fd = fs.openSync(filePath, 'r');

  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function looksLikeZipContainer(filePath) {
  const prefix = readFilePrefix(filePath, 4);

  // XLSX și DOCX sunt arhive ZIP intern.
  return prefix.length >= 2 && prefix[0] === 0x50 && prefix[1] === 0x4b;
}

function looksLikeTextFile(filePath) {
  const prefix = readFilePrefix(filePath);

  if (prefix.length === 0) return false;

  let controlBytes = 0;

  for (const byte of prefix) {
    if (
      byte === 0x00 ||
      byte < 0x09 ||
      (byte > 0x0d && byte < 0x20)
    ) {
      controlBytes += 1;
    }
  }

  return controlBytes / prefix.length < 0.05;
}

function removeUploadedFile(file) {
  if (!file?.path) return;

  try {
    fs.unlinkSync(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(
        'Nu am putut șterge upload-ul invalid:',
        error.message
      );
    }
  }
}

function createUploader(destination, allowedExtensions, label) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),

    filename: (_req, file, cb) => {
      const ext = getFileExtension(file.originalname);

      // Păstrăm extensia, important pentru XLSX/DOCX.
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: MAX_UPLOAD_SIZE,
      files: 1,
    },

    fileFilter: (_req, file, cb) => {
      const ext = getFileExtension(file.originalname);

      if (!allowedExtensions.has(ext)) {
        return cb(
          new Error(
            `${label}: extensie neacceptată (${ext || 'fără extensie'}).`
          )
        );
      }

      cb(null, true);
    },
  });
}

const uploadStudents = createUploader(
  upStudents,
  new Set(['.xlsx', '.csv']),
  'Foaia matricolă acceptă doar fișiere .xlsx sau .csv'
);

const uploadTemplates = createUploader(
  upTemplates,
  new Set(['.docx']),
  'Template-ul acceptă doar fișiere .docx'
);

function validateUploadedFile(file, kind) {
  if (!file || file.size <= 0) {
    return 'Fișierul încărcat este gol.';
  }

  const ext = getFileExtension(file.originalname);

  if (kind === 'transcript') {
    if (ext === '.xlsx' && !looksLikeZipContainer(file.path)) {
      return 'Fișierul declarat .xlsx nu pare un workbook Excel valid.';
    }

    if (ext === '.csv' && !looksLikeTextFile(file.path)) {
      return 'Fișierul declarat .csv nu pare un fișier text CSV valid.';
    }
  }

  if (kind === 'template' && !looksLikeZipContainer(file.path)) {
    return 'Fișierul declarat .docx nu pare un document Word valid.';
  }

  return null;
}

app.use('/uploads', express.static(upBase));


// ---------- ADMIN API ----------

function adminText(value) {
  return String(value || '').trim();
}

function parsePositiveId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function templateFileExists(template) {
  const templatePath = resolveTemplateFilePath(template?.docx_path);

  return Boolean(templatePath && fs.existsSync(templatePath));
}

const adminBackupDirectory = path.join(__dirname, 'backups');
fs.mkdirSync(adminBackupDirectory, { recursive: true });

const ADMIN_ENTITY_TYPES = new Set(['faculty', 'program', 'variant', 'template']);

function adminSafeFilename(value, fallback = 'backup') {
  const safe = adminText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return safe || fallback;
}

function adminSafeArchiveFileName(value, fallback) {
  const originalName = path.basename(adminText(value) || fallback);
  const extension = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, extension);

  return `${adminSafeFilename(baseName, 'fisier')}${extension}`;
}

function selectAdminRowsByIds(tableName, columnName, ids, orderBy = 'id') {
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(', ');

  return db.prepare(`
    SELECT *
    FROM ${tableName}
    WHERE ${columnName} IN (${placeholders})
    ORDER BY ${orderBy}
  `).all(...ids);
}

function getAdminEntityScope(entityType, entityId) {
  if (!ADMIN_ENTITY_TYPES.has(entityType)) {
    throw apiError(400, 'Tipul elementului pentru stergere este invalid.');
  }

  let faculty = null;
  let programs = [];
  let variants = [];
  let templates = [];
  let entityName = '';

  if (entityType === 'faculty') {
    faculty = db.prepare(`
      SELECT *
      FROM faculties
      WHERE id = ?
    `).get(entityId);

    if (!faculty) {
      throw apiError(404, 'Facultatea nu exista.');
    }

    programs = db.prepare(`
      SELECT *
      FROM programs
      WHERE faculty_id = ?
      ORDER BY id
    `).all(entityId);

    const programIds = programs.map((program) => program.id);
    variants = selectAdminRowsByIds(
      'program_variants',
      'program_id',
      programIds
    );
    templates = selectAdminRowsByIds(
      'program_templates',
      'program_id',
      programIds
    );
    entityName = faculty.name;
  }

  if (entityType === 'program') {
    const program = db.prepare(`
      SELECT *
      FROM programs
      WHERE id = ?
    `).get(entityId);

    if (!program) {
      throw apiError(404, 'Programul nu exista.');
    }

    faculty = db.prepare(`
      SELECT *
      FROM faculties
      WHERE id = ?
    `).get(program.faculty_id);

    programs = [program];
    variants = db.prepare(`
      SELECT *
      FROM program_variants
      WHERE program_id = ?
      ORDER BY id
    `).all(entityId);
    templates = db.prepare(`
      SELECT *
      FROM program_templates
      WHERE program_id = ?
      ORDER BY id
    `).all(entityId);
    entityName = program.name;
  }

  if (entityType === 'variant') {
    const variant = db.prepare(`
      SELECT *
      FROM program_variants
      WHERE id = ?
    `).get(entityId);

    if (!variant) {
      throw apiError(404, 'Anul / tipul nu exista.');
    }

    const program = db.prepare(`
      SELECT *
      FROM programs
      WHERE id = ?
    `).get(variant.program_id);

    faculty = program
      ? db.prepare(`
          SELECT *
          FROM faculties
          WHERE id = ?
        `).get(program.faculty_id)
      : null;

    programs = program ? [program] : [];
    variants = [variant];
    templates = db.prepare(`
      SELECT *
      FROM program_templates
      WHERE variant_id = ?
      ORDER BY id
    `).all(entityId);
    entityName = variant.code;
  }

  if (entityType === 'template') {
    const template = db.prepare(`
      SELECT *
      FROM program_templates
      WHERE id = ?
    `).get(entityId);

    if (!template) {
      throw apiError(404, 'Template-ul nu exista.');
    }

    const program = db.prepare(`
      SELECT *
      FROM programs
      WHERE id = ?
    `).get(template.program_id);

    faculty = program
      ? db.prepare(`
          SELECT *
          FROM faculties
          WHERE id = ?
        `).get(program.faculty_id)
      : null;

    programs = program ? [program] : [];
    variants = template.variant_id
      ? db.prepare(`
          SELECT *
          FROM program_variants
          WHERE id = ?
        `).all(template.variant_id)
      : [];
    templates = [template];
    entityName = template.version || `Template ${template.id}`;
  }

  const templateIds = templates.map((template) => template.id);
  const courses = selectAdminRowsByIds(
    'courses',
    'template_id',
    templateIds
  );
  const courseIds = courses.map((course) => course.id);
  const rules = selectAdminRowsByIds(
    'course_equivalency_rules',
    'course_id',
    courseIds
  );
  const runs = selectAdminRowsByIds(
    'runs',
    'template_id',
    templateIds
  );
  const runIds = runs.map((run) => run.id);
  const transcriptLines = selectAdminRowsByIds(
    'transcript_lines',
    'run_id',
    runIds
  );
  const matches = selectAdminRowsByIds(
    'course_matches',
    'run_id',
    runIds
  );
  const audits = selectAdminRowsByIds(
    'course_match_audit',
    'run_id',
    runIds
  );

  const includeProgramMatchingConfig =
    entityType === 'faculty' || entityType === 'program';
  const matchingProgramIds = includeProgramMatchingConfig
    ? programs.map((program) => program.id)
    : [];
  const matchingAliases = selectAdminRowsByIds(
    'program_matching_aliases',
    'program_id',
    matchingProgramIds
  );
  const matchingFamilies = selectAdminRowsByIds(
    'program_matching_families',
    'program_id',
    matchingProgramIds
  );
  const matchingFamilyIds = matchingFamilies.map((family) => family.id);
  const matchingFamilyTerms = selectAdminRowsByIds(
    'program_matching_family_terms',
    'family_id',
    matchingFamilyIds
  );
  const matchingDirectRules = selectAdminRowsByIds(
    'program_matching_direct_rules',
    'program_id',
    matchingProgramIds
  );

  return {
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName,
    faculty,
    programs,
    variants,
    templates,
    courses,
    rules,
    runs,
    transcript_lines: transcriptLines,
    course_matches: matches,
    course_match_audit: audits,
    program_matching_aliases: matchingAliases,
    program_matching_families: matchingFamilies,
    program_matching_family_terms: matchingFamilyTerms,
    program_matching_direct_rules: matchingDirectRules,
  };
}

function isManagedUploadPath(filePath) {
  return isPathInsideDirectory(filePath, upBase);
}

function buildAdminFileEntries(scope) {
  const entries = [];
  const missing = [];
  const external = [];
  const seenPaths = new Set();

  const addFile = ({ sourcePath, archivePath, kind, rowId }) => {
    if (!sourcePath) return;

    const resolvedPath =
      kind === 'template'
        ? resolveTemplateFilePath(sourcePath)
        : kind === 'transcript'
          ? resolveTranscriptFilePath(sourcePath)
          : resolveStoredFilePath(sourcePath, upBase);

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      missing.push({ kind, row_id: rowId, stored_path: sourcePath });
      return;
    }

    if (seenPaths.has(resolvedPath)) return;
    seenPaths.add(resolvedPath);

    entries.push({
      type: 'file',
      source_path: resolvedPath,
      archive_path: archivePath,
      kind,
      row_id: rowId,
    });

    if (!isManagedUploadPath(resolvedPath)) {
      external.push({ kind, row_id: rowId, stored_path: sourcePath });
    }
  };

  for (const template of scope.templates) {
    const fileName = adminSafeArchiveFileName(
      template.original_filename || template.docx_path,
      `template_${template.id}.docx`
    );

    addFile({
      sourcePath: template.docx_path,
      archivePath: `files/templates/${template.id}_${fileName}`,
      kind: 'template',
      rowId: template.id,
    });
  }

  for (const run of scope.runs) {
    const fileName = adminSafeArchiveFileName(
      run.original_filename || run.xlsx_path,
      `foaie_matricola_${run.id}.xlsx`
    );

    addFile({
      sourcePath: run.xlsx_path,
      archivePath: `files/foi_matricole/${run.id}_${fileName}`,
      kind: 'transcript',
      rowId: run.id,
    });
  }

  return { entries, missing, external };
}

function getAdminScopeCounts(scope, fileInfo) {
  return {
    program_count: scope.programs.length,
    variant_count: scope.variants.length,
    template_count: scope.templates.length,
    course_count: scope.courses.length,
    rule_count: scope.rules.length,
    run_count: scope.runs.length,
    transcript_line_count: scope.transcript_lines.length,
    match_count: scope.course_matches.length,
    audit_count: scope.course_match_audit.length,
    matching_alias_count: scope.program_matching_aliases.length,
    matching_family_count: scope.program_matching_families.length,
    matching_family_term_count: scope.program_matching_family_terms.length,
    matching_direct_rule_count: scope.program_matching_direct_rules.length,
    backup_file_count: fileInfo.entries.length,
    missing_file_count: fileInfo.missing.length,
    external_file_count: fileInfo.external.length,
  };
}

function makePortableAdminData(scope, fileInfo) {
  const templateFileMap = new Map();
  const transcriptFileMap = new Map();

  for (const entry of fileInfo.entries) {
    if (entry.kind === 'template') {
      templateFileMap.set(entry.row_id, entry.archive_path);
    }

    if (entry.kind === 'transcript') {
      transcriptFileMap.set(entry.row_id, entry.archive_path);
    }
  }

  const templates = scope.templates.map((template) => {
    const { docx_path: _docxPath, ...portable } = template;

    return {
      ...portable,
      backup_file: templateFileMap.get(template.id) || null,
    };
  });

  const runs = scope.runs.map((run) => {
    const { xlsx_path: _xlsxPath, ...portable } = run;

    return {
      ...portable,
      backup_file: transcriptFileMap.get(run.id) || null,
    };
  });

  return {
    faculty: scope.faculty,
    programs: scope.programs,
    program_variants: scope.variants,
    templates,
    courses: scope.courses,
    course_equivalency_rules: scope.rules,
    runs,
    transcript_lines: scope.transcript_lines,
    course_matches: scope.course_matches,
    course_match_audit: scope.course_match_audit,
    program_matching_aliases: scope.program_matching_aliases,
    program_matching_families: scope.program_matching_families,
    program_matching_family_terms: scope.program_matching_family_terms,
    program_matching_direct_rules: scope.program_matching_direct_rules,
  };
}

function createAdminBackupZip(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'admin_backup.py');
    const child = spawn(PY, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', fail);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim()
          || `Generatorul backup-ului s-a oprit cu codul ${code}.`
        )
      );
    });

    child.stdin.on('error', fail);
    child.stdin.end(JSON.stringify(payload));
  });
}

async function buildAdminBackup(scope) {
  const fileInfo = buildAdminFileEntries(scope);
  const counts = getAdminScopeCounts(scope, fileInfo);
  const portableData = makePortableAdminData(scope, fileInfo);
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, '-');
  const typeLabels = {
    faculty: 'Facultate',
    program: 'Program',
    variant: 'An',
    template: 'Template',
  };
  const safeEntityName = adminSafeFilename(
    scope.entity_name,
    `${scope.entity_type}_${scope.entity_id}`
  );
  const downloadName = `Backup_${typeLabels[scope.entity_type]}_${safeEntityName}_${timestamp}.zip`;
  const outputPath = path.join(adminBackupDirectory, downloadName);

  const manifest = {
    backup_version: 1,
    created_at: createdAt,
    entity_type: scope.entity_type,
    entity_id: scope.entity_id,
    entity_name: scope.entity_name,
    contains_personal_data: counts.run_count > 0,
    counts,
    missing_files: fileInfo.missing,
    external_files_copied_but_not_deleted: fileInfo.external,
    notes: [
      'Backup-ul poate contine nume de studenti si foi matricole.',
      'Aliasurile vechi globale nu sunt sterse si nu sunt incluse.',
      'Fisierele din afara folderului uploads sunt copiate in backup, dar nu sunt sterse de pe disc.',
    ],
  };

  const entries = [
    {
      type: 'json',
      archive_path: 'manifest.json',
      data: manifest,
    },
    {
      type: 'text',
      archive_path: 'README.txt',
      data:
        'Backup administrativ pentru aplicatia de echivalare.\n'
        + 'Consulta manifest.json pentru continut, avertismente si numaratori.\n'
        + 'Fisierele pot include date personale si trebuie pastrate in siguranta.\n',
    },
  ];

  for (const [name, data] of Object.entries(portableData)) {
    entries.push({
      type: 'json',
      archive_path: `data/${name}.json`,
      data,
    });
  }

  entries.push(...fileInfo.entries);

  await createAdminBackupZip({
    output_path: outputPath,
    entries,
  });

  return {
    output_path: outputPath,
    download_name: downloadName,
    counts,
    file_info: fileInfo,
  };
}

function deleteManagedAdminFiles(fileInfo) {
  const deleted = [];
  const skipped = [];
  const failed = [];

  for (const entry of fileInfo.entries) {
    const sourcePath = entry.source_path;

    if (!isManagedUploadPath(sourcePath)) {
      skipped.push(sourcePath);
      continue;
    }

    try {
      if (fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath);
        deleted.push(sourcePath);
      }
    } catch (error) {
      failed.push({ path: sourcePath, error: error.message });
    }
  }

  return { deleted, skipped, failed };
}

function deleteAdminEntityFromDatabase(scope) {
  const transaction = db.transaction(() => {
    if (scope.entity_type === 'faculty') {
      db.prepare('DELETE FROM faculties WHERE id = ?').run(scope.entity_id);
      return;
    }

    if (scope.entity_type === 'program') {
      db.prepare('DELETE FROM programs WHERE id = ?').run(scope.entity_id);
      return;
    }

    if (scope.entity_type === 'variant') {
      db.prepare(`
        DELETE FROM program_templates
        WHERE variant_id = ?
      `).run(scope.entity_id);

      db.prepare(`
        DELETE FROM program_variants
        WHERE id = ?
      `).run(scope.entity_id);
      return;
    }

    db.prepare('DELETE FROM program_templates WHERE id = ?').run(
      scope.entity_id
    );
  });

  transaction();
}

function sendAdminError(res, error) {
  const status = Number(error?.status) || 500;
  const message =
    status >= 500
      ? 'Operatia administrativa a esuat.'
      : error.message;

  return res.status(status).json({
    error: message,
    details: status >= 500 ? error.message : undefined,
  });
}

app.get('/api/admin/delete-preview/:entityType/:id', (req, res) => {
  try {
    const entityId = parsePositiveId(req.params.id);

    if (!entityId) {
      throw apiError(400, 'ID-ul elementului este invalid.');
    }

    const scope = getAdminEntityScope(req.params.entityType, entityId);
    const fileInfo = buildAdminFileEntries(scope);
    const counts = getAdminScopeCounts(scope, fileInfo);

    res.json({
      entity_type: scope.entity_type,
      entity_id: scope.entity_id,
      entity_name: scope.entity_name,
      counts,
      contains_personal_data: counts.run_count > 0,
      external_files_will_be_preserved: fileInfo.external.length,
      missing_files: fileInfo.missing.length,
    });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

app.get('/api/admin/backup/:entityType/:id', async (req, res) => {
  try {
    const entityId = parsePositiveId(req.params.id);

    if (!entityId) {
      throw apiError(400, 'ID-ul elementului este invalid.');
    }

    const scope = getAdminEntityScope(req.params.entityType, entityId);
    const backup = await buildAdminBackup(scope);

    return res.download(backup.output_path, backup.download_name);
  } catch (error) {
    return sendAdminError(res, error);
  }
});

app.post('/api/admin/delete/:entityType/:id', async (req, res) => {
  try {
    const entityId = parsePositiveId(req.params.id);

    if (!entityId) {
      throw apiError(400, 'ID-ul elementului este invalid.');
    }

    const mode = adminText(req.body.mode);

    if (!['backup_and_delete', 'delete'].includes(mode)) {
      throw apiError(400, 'Modul de stergere este invalid.');
    }

    const scope = getAdminEntityScope(req.params.entityType, entityId);
    const confirmationName = adminText(req.body.confirmation_name);

    if (confirmationName !== adminText(scope.entity_name)) {
      throw apiError(
        400,
        'Denumirea introdusa pentru confirmare nu este identica.'
      );
    }

    let backup = null;
    const fileInfo = buildAdminFileEntries(scope);

    if (mode === 'backup_and_delete') {
      backup = await buildAdminBackup(scope);
    }

    deleteAdminEntityFromDatabase(scope);
    const fileCleanup = deleteManagedAdminFiles(fileInfo);

    if (mode === 'backup_and_delete') {
      return res.download(backup.output_path, backup.download_name);
    }

    return res.json({
      ok: true,
      deleted: {
        entity_type: scope.entity_type,
        entity_id: scope.entity_id,
        entity_name: scope.entity_name,
      },
      file_cleanup: {
        deleted_count: fileCleanup.deleted.length,
        preserved_external_count: fileCleanup.skipped.length,
        failed_count: fileCleanup.failed.length,
      },
    });
  } catch (error) {
    return sendAdminError(res, error);
  }
});

app.post('/api/faculties', (req, res) => {
  const name = adminText(req.body.name);

  if (!name) {
    return res.status(400).json({ error: 'Numele facultatii este obligatoriu.' });
  }

  const existing = db.prepare(`
    SELECT id
    FROM faculties
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
  `).get(name);

  if (existing) {
    return res.status(409).json({
      error: 'Exista deja o facultate cu acest nume.',
    });
  }

  const result = db.prepare(`
    INSERT INTO faculties(name)
    VALUES (?)
  `).run(name);

  res.json({
    id: result.lastInsertRowid,
    name,
    program_count: 0,
    active_program_count: 0,
  });
});

app.get('/api/faculties', (_req, res) => {
  const faculties = db.prepare(`
    SELECT
      f.id,
      f.name,
      COUNT(p.id) AS program_count,
      COALESCE(SUM(CASE WHEN p.is_active = 1 THEN 1 ELSE 0 END), 0)
        AS active_program_count
    FROM faculties f
    LEFT JOIN programs p ON p.faculty_id = f.id
    GROUP BY f.id, f.name
    ORDER BY LOWER(f.name), f.id
  `).all();

  res.json(faculties);
});

app.put('/api/faculties/:id', (req, res) => {
  const facultyId = parsePositiveId(req.params.id);
  const name = adminText(req.body.name);

  if (!facultyId) {
    return res.status(400).json({ error: 'ID facultate invalid.' });
  }

  if (!name) {
    return res.status(400).json({ error: 'Numele facultatii este obligatoriu.' });
  }

  const faculty = db.prepare(`
    SELECT id
    FROM faculties
    WHERE id = ?
  `).get(facultyId);

  if (!faculty) {
    return res.status(404).json({ error: 'Facultatea nu exista.' });
  }

  const duplicate = db.prepare(`
    SELECT id
    FROM faculties
    WHERE id <> ?
      AND LOWER(TRIM(name)) = LOWER(TRIM(?))
  `).get(facultyId, name);

  if (duplicate) {
    return res.status(409).json({
      error: 'Exista deja o facultate cu acest nume.',
    });
  }

  db.prepare(`
    UPDATE faculties
    SET name = ?
    WHERE id = ?
  `).run(name, facultyId);

  res.json({ id: facultyId, name });
});

app.delete('/api/faculties/:id', (req, res) => {
  const facultyId = parsePositiveId(req.params.id);

  if (!facultyId) {
    return res.status(400).json({ error: 'ID facultate invalid.' });
  }

  const faculty = db.prepare(`
    SELECT id, name
    FROM faculties
    WHERE id = ?
  `).get(facultyId);

  if (!faculty) {
    return res.status(404).json({ error: 'Facultatea nu exista.' });
  }

  const programCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM programs
    WHERE faculty_id = ?
  `).get(facultyId).count;

  if (programCount > 0) {
    return res.status(409).json({
      error:
        'Facultatea are programe. Sterge programele neutilizate sau '
        + 'dezactiveaza programele pe care vrei sa le pastrezi.',
    });
  }

  db.prepare(`
    DELETE FROM faculties
    WHERE id = ?
  `).run(facultyId);

  res.json({ ok: true });
});

app.get('/api/faculties/:id/export', (req, res) => {
  const facultyId = parsePositiveId(req.params.id);

  if (!facultyId) {
    return res.status(400).json({ error: 'ID facultate invalid.' });
  }

  const faculty = db.prepare(`
    SELECT id, name
    FROM faculties
    WHERE id = ?
  `).get(facultyId);

  if (!faculty) {
    return res.status(404).json({ error: 'Facultatea nu exista.' });
  }

  const programs = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.is_active,
      (
        SELECT COUNT(*)
        FROM program_templates pt
        WHERE pt.program_id = p.id
      ) AS template_count
    FROM programs p
    WHERE p.faculty_id = ?
    ORDER BY LOWER(p.name), p.id
  `).all(facultyId);

  const templatesStatement = db.prepare(`
    SELECT
      pt.id,
      pt.program_id,
      pt.version AS name,
      pt.is_active,
      pt.original_filename,
      pt.created_at,
      (
        SELECT COUNT(*)
        FROM courses c
        WHERE c.template_id = pt.id
      ) AS course_count,
      (
        SELECT COUNT(*)
        FROM runs r
        WHERE r.template_id = pt.id
      ) AS run_count
    FROM program_templates pt
    WHERE pt.program_id = ?
    ORDER BY pt.is_active DESC, pt.id DESC
  `);

  const data = {
    export_type: 'faculty_configuration',
    exported_at: new Date().toISOString(),
    contains_personal_data: false,
    faculty,
    programs: programs.map((program) => ({
      ...program,
      templates: templatesStatement.all(program.id),
    })),
    note:
      'Exportul contine structura facultatii, programele si metadatele '
      + 'template-urilor. Nu contine studenti, foi matricole sau rulari.',
  };

  const safeName = faculty.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || `facultate_${faculty.id}`;

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Configuratie_${safeName}.json"`
  );
  res.type('application/json');
  res.send(JSON.stringify(data, null, 2));
});

app.post('/api/programs', (req, res) => {
  const facultyId = parsePositiveId(req.body.faculty_id);
  const name = adminText(req.body.name);

  if (!facultyId || !name) {
    return res.status(400).json({
      error: 'Facultatea si numele programului sunt obligatorii.',
    });
  }

  const faculty = db.prepare(`
    SELECT id
    FROM faculties
    WHERE id = ?
  `).get(facultyId);

  if (!faculty) {
    return res.status(404).json({ error: 'Facultatea nu exista.' });
  }

  const duplicate = db.prepare(`
    SELECT id
    FROM programs
    WHERE faculty_id = ?
      AND LOWER(TRIM(name)) = LOWER(TRIM(?))
  `).get(facultyId, name);

  if (duplicate) {
    return res.status(409).json({
      error: 'Exista deja un program cu acest nume in facultatea selectata.',
    });
  }

  const result = db.prepare(`
    INSERT INTO programs(faculty_id, name, is_active)
    VALUES (?, ?, 1)
  `).run(facultyId, name);

  res.json({
    id: result.lastInsertRowid,
    faculty_id: facultyId,
    name,
    is_active: 1,
    template_count: 0,
    active_template_count: 0,
  });
});

app.get('/api/programs', (req, res) => {
  const facultyId = parsePositiveId(req.query.facultyId);
  const includeInactive = String(req.query.includeInactive || '') === '1';

  if (!facultyId) {
    return res.json([]);
  }

  const rows = db.prepare(`
    SELECT
      p.id,
      p.faculty_id,
      p.name,
      p.is_active,
      (
        SELECT COUNT(*)
        FROM program_variants pv
        WHERE pv.program_id = p.id
      ) AS variant_count,
      (
        SELECT COUNT(*)
        FROM program_variants pv
        WHERE pv.program_id = p.id AND pv.is_active = 1
      ) AS active_variant_count,
      (
        SELECT COUNT(*)
        FROM program_templates pt
        WHERE pt.program_id = p.id
      ) AS template_count,
      (
        SELECT COUNT(*)
        FROM program_templates pt
        WHERE pt.program_id = p.id AND pt.is_active = 1
      ) AS active_template_count
    FROM programs p
    WHERE p.faculty_id = ?
      AND (? = 1 OR p.is_active = 1)
    ORDER BY LOWER(p.name), p.id
  `).all(facultyId, includeInactive ? 1 : 0);

  res.json(rows);
});

app.put('/api/programs/:id', (req, res) => {
  const programId = parsePositiveId(req.params.id);
  const name = adminText(req.body.name);

  if (!programId) {
    return res.status(400).json({ error: 'ID program invalid.' });
  }

  if (!name) {
    return res.status(400).json({ error: 'Numele programului este obligatoriu.' });
  }

  const program = db.prepare(`
    SELECT id, faculty_id
    FROM programs
    WHERE id = ?
  `).get(programId);

  if (!program) {
    return res.status(404).json({ error: 'Programul nu exista.' });
  }

  const duplicate = db.prepare(`
    SELECT id
    FROM programs
    WHERE id <> ?
      AND faculty_id = ?
      AND LOWER(TRIM(name)) = LOWER(TRIM(?))
  `).get(programId, program.faculty_id, name);

  if (duplicate) {
    return res.status(409).json({
      error: 'Exista deja un program cu acest nume in facultatea selectata.',
    });
  }

  db.prepare(`
    UPDATE programs
    SET name = ?
    WHERE id = ?
  `).run(name, programId);

  res.json({
    id: programId,
    faculty_id: program.faculty_id,
    name,
  });
});

app.put('/api/programs/:id/active', (req, res) => {
  const programId = parsePositiveId(req.params.id);

  if (!programId) {
    return res.status(400).json({ error: 'ID program invalid.' });
  }

  const isActive = req.body.is_active ? 1 : 0;

  const program = db.prepare(`
    SELECT id
    FROM programs
    WHERE id = ?
  `).get(programId);

  if (!program) {
    return res.status(404).json({ error: 'Programul nu exista.' });
  }

  db.prepare(`
    UPDATE programs
    SET is_active = ?
    WHERE id = ?
  `).run(isActive, programId);

  res.json({
    id: programId,
    is_active: isActive,
  });
});

app.delete('/api/programs/:id', (req, res) => {
  const programId = parsePositiveId(req.params.id);

  if (!programId) {
    return res.status(400).json({ error: 'ID program invalid.' });
  }

  const program = db.prepare(`
    SELECT id, name
    FROM programs
    WHERE id = ?
  `).get(programId);

  if (!program) {
    return res.status(404).json({ error: 'Programul nu exista.' });
  }

  const templateCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM program_templates
    WHERE program_id = ?
  `).get(programId).count;

  if (templateCount > 0) {
    return res.status(409).json({
      error:
        'Programul are template-uri. Sterge template-urile neutilizate '
        + 'sau dezactiveaza programul.',
    });
  }

  db.prepare(`
    DELETE FROM programs
    WHERE id = ?
  `).run(programId);

  res.json({ ok: true });
});

function normalizeVariantCode(value) {
  return adminText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function inferStudyYearFromVariantCode(code) {
  const match = String(code || '').match(/([1-9])$/);
  return match ? Number(match[1]) : null;
}

app.post('/api/program-variants', (req, res) => {
  const programId = parsePositiveId(req.body.program_id);
  const code = normalizeVariantCode(req.body.code);
  const name = adminText(req.body.name) || code;
  const requestedYear = Number(req.body.study_year);
  const studyYear = Number.isInteger(requestedYear) && requestedYear > 0
    ? requestedYear
    : inferStudyYearFromVariantCode(code);

  if (!programId || !code) {
    return res.status(400).json({
      error: 'Programul si codul anului sunt obligatorii.',
    });
  }

  const program = db.prepare(`
    SELECT id
    FROM programs
    WHERE id = ?
  `).get(programId);

  if (!program) {
    return res.status(404).json({ error: 'Programul nu exista.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO program_variants(
        program_id,
        code,
        name,
        study_year,
        is_active
      )
      VALUES (?, ?, ?, ?, 1)
    `).run(programId, code, name, studyYear);

    res.json({
      id: result.lastInsertRowid,
      program_id: programId,
      code,
      name,
      study_year: studyYear,
      is_active: 1,
      template_count: 0,
      active_template_count: 0,
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        error: 'Exista deja un an / tip cu acest cod in program.',
      });
    }

    throw error;
  }
});

app.get('/api/program-variants', (req, res) => {
  const programId = parsePositiveId(req.query.programId);
  const includeInactive = String(req.query.includeInactive || '') === '1';

  if (!programId) {
    return res.json([]);
  }

  const variants = db.prepare(`
    SELECT
      pv.id,
      pv.program_id,
      pv.code,
      pv.name,
      pv.study_year,
      pv.is_active,
      pv.created_at,
      (
        SELECT COUNT(*)
        FROM program_templates pt
        WHERE pt.variant_id = pv.id
      ) AS template_count,
      (
        SELECT COUNT(*)
        FROM program_templates pt
        WHERE pt.variant_id = pv.id AND pt.is_active = 1
      ) AS active_template_count,
      (
        SELECT pt.version
        FROM program_templates pt
        WHERE pt.variant_id = pv.id AND pt.is_active = 1
        ORDER BY pt.id DESC
        LIMIT 1
      ) AS active_template_name
    FROM program_variants pv
    WHERE pv.program_id = ?
      AND (? = 1 OR pv.is_active = 1)
    ORDER BY
      CASE WHEN pv.study_year IS NULL THEN 999 ELSE pv.study_year END,
      LOWER(pv.code),
      pv.id
  `).all(programId, includeInactive ? 1 : 0);

  res.json(variants);
});

app.put('/api/program-variants/:id', (req, res) => {
  const variantId = parsePositiveId(req.params.id);
  const code = normalizeVariantCode(req.body.code);
  const name = adminText(req.body.name) || code;
  const requestedYear = Number(req.body.study_year);
  const studyYear = Number.isInteger(requestedYear) && requestedYear > 0
    ? requestedYear
    : inferStudyYearFromVariantCode(code);

  if (!variantId || !code) {
    return res.status(400).json({
      error: 'ID-ul si codul anului sunt obligatorii.',
    });
  }

  const variant = db.prepare(`
    SELECT id, program_id
    FROM program_variants
    WHERE id = ?
  `).get(variantId);

  if (!variant) {
    return res.status(404).json({ error: 'Anul / tipul nu exista.' });
  }

  try {
    db.prepare(`
      UPDATE program_variants
      SET code = ?, name = ?, study_year = ?
      WHERE id = ?
    `).run(code, name, studyYear, variantId);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        error: 'Exista deja un an / tip cu acest cod in program.',
      });
    }

    throw error;
  }

  res.json({
    id: variantId,
    program_id: variant.program_id,
    code,
    name,
    study_year: studyYear,
  });
});

app.put('/api/program-variants/:id/active', (req, res) => {
  const variantId = parsePositiveId(req.params.id);

  if (!variantId) {
    return res.status(400).json({ error: 'ID an / tip invalid.' });
  }

  const variant = db.prepare(`
    SELECT id
    FROM program_variants
    WHERE id = ?
  `).get(variantId);

  if (!variant) {
    return res.status(404).json({ error: 'Anul / tipul nu exista.' });
  }

  const isActive = req.body.is_active ? 1 : 0;

  db.prepare(`
    UPDATE program_variants
    SET is_active = ?
    WHERE id = ?
  `).run(isActive, variantId);

  res.json({ id: variantId, is_active: isActive });
});

// Upload template .docx + parse -> populate courses.
app.post('/api/templates', uploadTemplates.single('template'), (req, res) => {
  const requestedProgramId = parsePositiveId(req.body.program_id);
  const variantId = parsePositiveId(req.body.variant_id);
  const templateName = adminText(
    req.body.name || req.body.template_name || req.body.version
  );

  if (!req.file || (!requestedProgramId && !variantId)) {
    removeUploadedFile(req.file);
    return res.status(400).json({
      error: 'Fisierul template si anul / tipul sunt obligatorii.',
    });
  }

  if (!templateName) {
    removeUploadedFile(req.file);
    return res.status(400).json({
      error: 'Numele template-ului este obligatoriu.',
    });
  }

  let variant = null;

  if (variantId) {
    variant = db.prepare(`
      SELECT *
      FROM program_variants
      WHERE id = ?
    `).get(variantId);

    if (!variant) {
      removeUploadedFile(req.file);
      return res.status(404).json({ error: 'Anul / tipul nu exista.' });
    }
  }

  const programId = variant?.program_id || requestedProgramId;
  const program = db.prepare(`
    SELECT id
    FROM programs
    WHERE id = ?
  `).get(programId);

  if (!program) {
    removeUploadedFile(req.file);
    return res.status(404).json({ error: 'Programul nu exista.' });
  }

  if (!variant) {
    db.prepare(`
      INSERT OR IGNORE INTO program_variants(
        program_id,
        code,
        name,
        is_active
      )
      VALUES (?, 'GENERAL', 'General', 1)
    `).run(programId);

    variant = db.prepare(`
      SELECT *
      FROM program_variants
      WHERE program_id = ? AND code = 'GENERAL'
    `).get(programId);
  }

  const uploadError = validateUploadedFile(req.file, 'template');

  if (uploadError) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: uploadError });
  }

  const storedTemplatePath = toPortableStoredPath(req.file.path);

  const result = db.prepare(`
    INSERT INTO program_templates(
      program_id,
      variant_id,
      version,
      is_active,
      docx_path,
      original_filename
    )
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(
    programId,
    variant.id,
    templateName,
    storedTemplatePath,
    req.file.originalname || null
  );

  const templateId = result.lastInsertRowid;

  const py = spawn(PY, [path.join(__dirname, 'parse_template_docx.py')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  py.stdin.write(JSON.stringify({ template_path: req.file.path }));
  py.stdin.end();

  let out = '';
  let err = '';

  py.stdout.on('data', (data) => {
    out += data.toString('utf8');
  });

  py.stderr.on('data', (data) => {
    err += data.toString('utf8');
  });

  py.on('close', (code) => {
    if (code !== 0) {
      db.prepare(`
        DELETE FROM program_templates
        WHERE id = ?
      `).run(templateId);
      removeUploadedFile(req.file);

      return res.status(400).json({
        error: 'Template-ul nu a putut fi interpretat.',
        details: err,
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(out);
    } catch {
      db.prepare(`
        DELETE FROM program_templates
        WHERE id = ?
      `).run(templateId);
      removeUploadedFile(req.file);

      return res.status(500).json({
        error: 'Parserul DOCX a returnat un raspuns invalid.',
        out,
        err,
      });
    }

    const transaction = db.transaction(() => {
      for (const course of parsed.courses) {
        db.prepare(`
          INSERT INTO courses(
            template_id,
            year,
            semester,
            name,
            name_norm,
            ects,
            identifier
          )
          VALUES (
            ?, ?, ?, ?,
            LOWER(REPLACE(REPLACE(REPLACE(?,'-',' '),'.',' '),',',' ')),
            ?, ?
          )
          ON CONFLICT(template_id, name_norm) DO UPDATE SET
            year = excluded.year,
            semester = excluded.semester,
            ects = excluded.ects,
            identifier = COALESCE(
              excluded.identifier,
              courses.identifier
            )
        `).run(
          templateId,
          course.year || null,
          course.semester || null,
          course.name,
          course.name,
          course.ects || null,
          course.identifier || null
        );
      }
    });

    transaction();

    res.json({
      template_id: templateId,
      variant_id: variant.id,
      name: templateName,
      inserted: parsed.courses.length,
    });
  });
});

app.get('/api/templates', (req, res) => {
  const variantId = parsePositiveId(req.query.variantId);
  const programId = parsePositiveId(req.query.programId);

  if (!variantId && !programId) {
    return res.json([]);
  }

  const whereClause = variantId
    ? 'pt.variant_id = ?'
    : 'pt.program_id = ?';
  const filterId = variantId || programId;

  const templates = db.prepare(`
    SELECT
      pt.id,
      pt.program_id,
      pt.variant_id,
      pv.code AS variant_code,
      pv.name AS variant_name,
      pv.study_year,
      pt.version,
      pt.version AS name,
      pt.is_active,
      pt.docx_path,
      pt.original_filename,
      pt.created_at,
      (
        SELECT COUNT(*)
        FROM courses c
        WHERE c.template_id = pt.id
      ) AS course_count,
      (
        SELECT COUNT(*)
        FROM runs r
        WHERE r.template_id = pt.id
      ) AS run_count
    FROM program_templates pt
    LEFT JOIN program_variants pv ON pv.id = pt.variant_id
    WHERE ${whereClause}
    ORDER BY pt.is_active DESC, pt.id DESC
  `).all(filterId);

  res.json(
    templates.map((template) => ({
      ...template,
      file_exists: templateFileExists(template),
    }))
  );
});

app.put('/api/templates/:id/activate', (req, res) => {
  const templateId = parsePositiveId(req.params.id);

  if (!templateId) {
    return res.status(400).json({ error: 'ID template invalid.' });
  }

  const template = db.prepare(`
    SELECT *
    FROM program_templates
    WHERE id = ?
  `).get(templateId);

  if (!template) {
    return res.status(404).json({ error: 'Template-ul nu exista.' });
  }

  if (!templateFileExists(template)) {
    return res.status(409).json({
      error:
        'Fisierul template nu mai exista. Reincarca template-ul '
        + 'inainte de activare.',
    });
  }

  const transaction = db.transaction(() => {
    if (template.variant_id) {
      db.prepare(`
        UPDATE program_templates
        SET is_active = 0
        WHERE variant_id = ?
      `).run(template.variant_id);
    } else {
      db.prepare(`
        UPDATE program_templates
        SET is_active = 0
        WHERE program_id = ? AND variant_id IS NULL
      `).run(template.program_id);
    }

    db.prepare(`
      UPDATE program_templates
      SET is_active = 1
      WHERE id = ?
    `).run(templateId);
  });

  transaction();

  res.json({ ok: true });
});

app.put('/api/templates/:id', (req, res) => {
  const templateId = parsePositiveId(req.params.id);
  const name = adminText(req.body.name || req.body.version);

  if (!templateId) {
    return res.status(400).json({ error: 'ID template invalid.' });
  }

  if (!name) {
    return res.status(400).json({
      error: 'Numele template-ului este obligatoriu.',
    });
  }

  const template = db.prepare(`
    SELECT id
    FROM program_templates
    WHERE id = ?
  `).get(templateId);

  if (!template) {
    return res.status(404).json({ error: 'Template-ul nu exista.' });
  }

  db.prepare(`
    UPDATE program_templates
    SET version = ?
    WHERE id = ?
  `).run(name, templateId);

  res.json({
    id: templateId,
    name,
    version: name,
  });
});

app.get('/api/templates/:id/download', (req, res) => {
  const templateId = parsePositiveId(req.params.id);

  if (!templateId) {
    return res.status(400).json({ error: 'ID template invalid.' });
  }

  const template = db.prepare(`
    SELECT *
    FROM program_templates
    WHERE id = ?
  `).get(templateId);

  if (!template) {
    return res.status(404).json({ error: 'Template-ul nu exista.' });
  }

  const templatePath = resolveTemplateFilePath(template.docx_path);

  if (!templatePath || !fs.existsSync(templatePath)) {
    return res.status(404).json({
      error:
        'Fisierul template nu mai exista pe disc. Reincarca template-ul.',
    });
  }

  const downloadName =
    adminText(template.original_filename)
    || `${adminText(template.version) || `template_${template.id}`}.docx`;

  res.download(templatePath, downloadName);
});

app.delete('/api/templates/:id', (req, res) => {
  const templateId = parsePositiveId(req.params.id);

  if (!templateId) {
    return res.status(400).json({ error: 'ID template invalid.' });
  }

  const template = db.prepare(`
    SELECT *
    FROM program_templates
    WHERE id = ?
  `).get(templateId);

  if (!template) {
    return res.status(404).json({ error: 'Template-ul nu exista.' });
  }

  const runCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM runs
    WHERE template_id = ?
  `).get(templateId).count;

  if (runCount > 0) {
    return res.status(409).json({
      error:
        `Template-ul este folosit de ${runCount} rulari si nu poate fi `
        + 'sters. Pastreaza-l pentru exporturile istorice.',
    });
  }

  db.prepare(`
    DELETE FROM program_templates
    WHERE id = ?
  `).run(templateId);

  const templatePath = resolveTemplateFilePath(template.docx_path);

  if (templatePath && fs.existsSync(templatePath)) {
    try {
      fs.unlinkSync(templatePath);
    } catch (error) {
      console.warn(
        'Template-ul a fost sters din baza de date, dar fisierul '
        + `nu a putut fi eliminat: ${error.message}`
      );
    }
  }

  res.json({ ok: true });
});

// Aliasurile vechi raman active pana la migrarea controlata.
app.get('/api/aliases', (_req, res) => {
  res.json(
    db.prepare(`
      SELECT *
      FROM course_aliases
      ORDER BY id DESC
    `).all()
  );
});

app.post('/api/aliases/import', (req, res) => {
  const pairs = Array.isArray(req.body.pairs) ? req.body.pairs : [];

  const transaction = db.transaction(() => {
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) {
        continue;
      }

      const alias = adminText(pair[0]);
      const identifier = adminText(pair[1]);

      if (!alias || !identifier) {
        continue;
      }

      const aliasNorm = alias
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      db.prepare(`
        INSERT INTO course_aliases(
          identifier,
          alias_name,
          alias_norm
        )
        VALUES (?, ?, ?)
      `).run(identifier, alias, aliasNorm);
    }
  });

  transaction();

  res.json({ inserted: pairs.length });
});




// ---------- PROGRAM MATCHING CONFIGURATION ----------
// Configuratia este legata de programul academic si NU influenteaza incamatcher-ul.

const MATCHING_LEVEL_POLICIES = new Set([
  'ignore',
  'same_required',
  'same_if_present',
]);

const MATCHING_FAMILY_DECISIONS = new Set([
  'auto',
  'needs_review',
]);

const MATCHING_RULE_DECISIONS = new Set([
  'auto',
  'needs_review',
  'blocked',
]);

const MATCHING_TERM_MODES = new Set([
  'exact',
  'starts_with',
  'contains_phrase',
]);

const MATCHING_RULE_DIRECTIONS = new Set([
  'forward',
  'bidirectional',
]);

function matchingBoolean(value, defaultValue = 1) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  return value ? 1 : 0;
}

function matchingProgramOrThrow(programId) {
  const program = db.prepare(`
    SELECT p.*, f.name AS faculty_name
    FROM programs p
    JOIN faculties f ON f.id = p.faculty_id
    WHERE p.id = ?
  `).get(programId);

  if (!program) {
    throw apiError(404, 'Programul academic nu exista.');
  }

  return program;
}

function matchingCode(value, fallbackValue = '') {
  const source = adminText(value || fallbackValue);
  const normalized = canonicalCourseName(source)
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || `familie_${Date.now()}`;
}

function loadProgramMatchingConfig(programId) {
  const program = matchingProgramOrThrow(programId);

  const aliases = db.prepare(`
    SELECT *
    FROM program_matching_aliases
    WHERE program_id = ?
    ORDER BY LOWER(canonical_name), LOWER(alias_name), id
  `).all(programId);

  const families = db.prepare(`
    SELECT *
    FROM program_matching_families
    WHERE program_id = ?
    ORDER BY is_active DESC, LOWER(name), id
  `).all(programId);

  const familyIds = families.map((family) => family.id);
  let terms = [];

  if (familyIds.length) {
    const placeholders = familyIds.map(() => '?').join(', ');

    terms = db.prepare(`
      SELECT *
      FROM program_matching_family_terms
      WHERE family_id IN (${placeholders})
      ORDER BY is_exclusion, LOWER(term), id
    `).all(...familyIds);
  }

  const termsByFamily = new Map(
    families.map((family) => [family.id, {
      terms: [],
      exclusions: [],
    }])
  );

  for (const term of terms) {
    const bucket = termsByFamily.get(term.family_id);

    if (!bucket) continue;

    if (term.is_exclusion) {
      bucket.exclusions.push(term);
    } else {
      bucket.terms.push(term);
    }
  }

  const directRules = db.prepare(`
    SELECT *
    FROM program_matching_direct_rules
    WHERE program_id = ?
    ORDER BY is_active DESC, LOWER(source_name), LOWER(target_name), id
  `).all(programId);

  const legacyAliasCount = db.prepare(`
    SELECT COUNT(DISTINCT ca.id) AS count
    FROM course_aliases ca
    JOIN courses c ON c.identifier = ca.identifier
    JOIN program_templates pt ON pt.id = c.template_id
    WHERE pt.program_id = ?
  `).get(programId).count;

  const legacyRuleCount = db.prepare(`
    SELECT COUNT(DISTINCT r.id) AS count
    FROM course_equivalency_rules r
    JOIN courses c ON c.id = r.course_id
    JOIN program_templates pt ON pt.id = c.template_id
    WHERE pt.program_id = ?
  `).get(programId).count;

  return {
    program,
    aliases,
    families: families.map((family) => ({
      ...family,
      terms: termsByFamily.get(family.id)?.terms || [],
      exclusions: termsByFamily.get(family.id)?.exclusions || [],
    })),
    direct_rules: directRules,
    legacy_alias_count: legacyAliasCount,
    legacy_course_rule_count: legacyRuleCount,
    matcher_integration_status: 'connected',
  };
}

app.get('/api/programs/:programId/matching-config', (req, res) => {
  try {
    const programId = parsePositiveId(req.params.programId);

    if (!programId) {
      throw apiError(400, 'ID program invalid.');
    }

    res.json(loadProgramMatchingConfig(programId));
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Nu am putut incarca configuratia de matching.',
    });
  }
});

app.post('/api/programs/:programId/matching-aliases', (req, res) => {
  try {
    const programId = parsePositiveId(req.params.programId);

    if (!programId) {
      throw apiError(400, 'ID program invalid.');
    }

    matchingProgramOrThrow(programId);

    const canonicalName = adminText(req.body.canonical_name);
    const aliasName = adminText(req.body.alias_name);
    const canonicalNorm = canonicalCourseName(canonicalName);
    const aliasNorm = canonicalCourseName(aliasName);

    if (!canonicalName || !canonicalNorm) {
      throw apiError(400, 'Disciplina canonica este obligatorie.');
    }

    if (!aliasName || !aliasNorm) {
      throw apiError(400, 'Aliasul este obligatoriu.');
    }

    if (canonicalNorm === aliasNorm) {
      throw apiError(
        400,
        'Aliasul este identic cu disciplina canonica dupa normalizare.'
      );
    }

    const result = db.prepare(`
      INSERT INTO program_matching_aliases(
        program_id,
        canonical_name,
        canonical_norm,
        alias_name,
        alias_norm,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      programId,
      canonicalName,
      canonicalNorm,
      aliasName,
      aliasNorm,
      matchingBoolean(req.body.is_active, 1)
    );

    res.status(201).json(
      db.prepare(`
        SELECT *
        FROM program_matching_aliases
        WHERE id = ?
      `).get(result.lastInsertRowid)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Aliasul exista deja pentru programul selectat.'
        : (error.message || 'Nu am putut salva aliasul.'),
    });
  }
});

app.put('/api/program-matching-aliases/:id', (req, res) => {
  try {
    const aliasId = parsePositiveId(req.params.id);

    if (!aliasId) {
      throw apiError(400, 'ID alias invalid.');
    }

    const current = db.prepare(`
      SELECT *
      FROM program_matching_aliases
      WHERE id = ?
    `).get(aliasId);

    if (!current) {
      throw apiError(404, 'Aliasul nu exista.');
    }

    const canonicalName = adminText(
      req.body.canonical_name ?? current.canonical_name
    );
    const aliasName = adminText(req.body.alias_name ?? current.alias_name);
    const canonicalNorm = canonicalCourseName(canonicalName);
    const aliasNorm = canonicalCourseName(aliasName);

    if (!canonicalNorm || !aliasNorm) {
      throw apiError(400, 'Denumirile aliasului sunt obligatorii.');
    }

    if (canonicalNorm === aliasNorm) {
      throw apiError(
        400,
        'Aliasul este identic cu disciplina canonica dupa normalizare.'
      );
    }

    db.prepare(`
      UPDATE program_matching_aliases
      SET canonical_name = ?,
          canonical_norm = ?,
          alias_name = ?,
          alias_norm = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      canonicalName,
      canonicalNorm,
      aliasName,
      aliasNorm,
      matchingBoolean(req.body.is_active, current.is_active),
      aliasId
    );

    res.json(
      db.prepare(`
        SELECT *
        FROM program_matching_aliases
        WHERE id = ?
      `).get(aliasId)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Aliasul exista deja pentru programul selectat.'
        : (error.message || 'Nu am putut actualiza aliasul.'),
    });
  }
});

app.delete('/api/program-matching-aliases/:id', (req, res) => {
  const aliasId = parsePositiveId(req.params.id);

  if (!aliasId) {
    return res.status(400).json({ error: 'ID alias invalid.' });
  }

  const result = db.prepare(`
    DELETE FROM program_matching_aliases
    WHERE id = ?
  `).run(aliasId);

  if (!result.changes) {
    return res.status(404).json({ error: 'Aliasul nu exista.' });
  }

  res.json({ ok: true });
});

app.post('/api/programs/:programId/matching-families', (req, res) => {
  try {
    const programId = parsePositiveId(req.params.programId);

    if (!programId) {
      throw apiError(400, 'ID program invalid.');
    }

    matchingProgramOrThrow(programId);

    const name = adminText(req.body.name);
    const code = matchingCode(req.body.code, name);
    const levelPolicy = adminText(
      req.body.level_policy || 'same_if_present'
    );
    const decisionStatus = adminText(
      req.body.decision_status || 'needs_review'
    );
    const notes = adminText(req.body.notes) || null;

    if (!name) {
      throw apiError(400, 'Numele familiei este obligatoriu.');
    }

    if (!MATCHING_LEVEL_POLICIES.has(levelPolicy)) {
      throw apiError(400, 'Politica nivelului este invalida.');
    }

    if (!MATCHING_FAMILY_DECISIONS.has(decisionStatus)) {
      throw apiError(400, 'Decizia implicita este invalida.');
    }

    const result = db.prepare(`
      INSERT INTO program_matching_families(
        program_id,
        name,
        code,
        level_policy,
        decision_status,
        is_active,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      programId,
      name,
      code,
      levelPolicy,
      decisionStatus,
      matchingBoolean(req.body.is_active, 1),
      notes
    );

    res.status(201).json(
      db.prepare(`
        SELECT *
        FROM program_matching_families
        WHERE id = ?
      `).get(result.lastInsertRowid)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Exista deja o familie cu acest cod in program.'
        : (error.message || 'Nu am putut salva familia.'),
    });
  }
});

app.put('/api/program-matching-families/:id', (req, res) => {
  try {
    const familyId = parsePositiveId(req.params.id);

    if (!familyId) {
      throw apiError(400, 'ID familie invalid.');
    }

    const current = db.prepare(`
      SELECT *
      FROM program_matching_families
      WHERE id = ?
    `).get(familyId);

    if (!current) {
      throw apiError(404, 'Familia nu exista.');
    }

    const name = adminText(req.body.name ?? current.name);
    const code = matchingCode(req.body.code ?? current.code, name);
    const levelPolicy = adminText(
      req.body.level_policy ?? current.level_policy
    );
    const decisionStatus = adminText(
      req.body.decision_status ?? current.decision_status
    );
    const notes = req.body.notes === undefined
      ? current.notes
      : (adminText(req.body.notes) || null);

    if (!name) {
      throw apiError(400, 'Numele familiei este obligatoriu.');
    }

    if (!MATCHING_LEVEL_POLICIES.has(levelPolicy)) {
      throw apiError(400, 'Politica nivelului este invalida.');
    }

    if (!MATCHING_FAMILY_DECISIONS.has(decisionStatus)) {
      throw apiError(400, 'Decizia implicita este invalida.');
    }

    db.prepare(`
      UPDATE program_matching_families
      SET name = ?,
          code = ?,
          level_policy = ?,
          decision_status = ?,
          is_active = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name,
      code,
      levelPolicy,
      decisionStatus,
      matchingBoolean(req.body.is_active, current.is_active),
      notes,
      familyId
    );

    res.json(
      db.prepare(`
        SELECT *
        FROM program_matching_families
        WHERE id = ?
      `).get(familyId)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Exista deja o familie cu acest cod in program.'
        : (error.message || 'Nu am putut actualiza familia.'),
    });
  }
});

app.delete('/api/program-matching-families/:id', (req, res) => {
  const familyId = parsePositiveId(req.params.id);

  if (!familyId) {
    return res.status(400).json({ error: 'ID familie invalid.' });
  }

  const result = db.prepare(`
    DELETE FROM program_matching_families
    WHERE id = ?
  `).run(familyId);

  if (!result.changes) {
    return res.status(404).json({ error: 'Familia nu exista.' });
  }

  res.json({ ok: true });
});

app.post('/api/program-matching-families/:familyId/terms', (req, res) => {
  try {
    const familyId = parsePositiveId(req.params.familyId);

    if (!familyId) {
      throw apiError(400, 'ID familie invalid.');
    }

    const family = db.prepare(`
      SELECT id
      FROM program_matching_families
      WHERE id = ?
    `).get(familyId);

    if (!family) {
      throw apiError(404, 'Familia nu exista.');
    }

    const term = adminText(req.body.term);
    const termNorm = canonicalCourseName(term);
    const matchMode = adminText(
      req.body.match_mode || 'contains_phrase'
    );
    const isExclusion = matchingBoolean(req.body.is_exclusion, 0);

    if (!term || !termNorm) {
      throw apiError(400, 'Denumirea este obligatorie.');
    }

    if (!MATCHING_TERM_MODES.has(matchMode)) {
      throw apiError(400, 'Tipul de potrivire este invalid.');
    }

    const result = db.prepare(`
      INSERT INTO program_matching_family_terms(
        family_id,
        term,
        term_norm,
        match_mode,
        is_exclusion,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      familyId,
      term,
      termNorm,
      matchMode,
      isExclusion,
      matchingBoolean(req.body.is_active, 1)
    );

    res.status(201).json(
      db.prepare(`
        SELECT *
        FROM program_matching_family_terms
        WHERE id = ?
      `).get(result.lastInsertRowid)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Denumirea exista deja in aceasta familie.'
        : (error.message || 'Nu am putut salva denumirea familiei.'),
    });
  }
});

app.put('/api/program-matching-family-terms/:id', (req, res) => {
  try {
    const termId = parsePositiveId(req.params.id);

    if (!termId) {
      throw apiError(400, 'ID denumire invalid.');
    }

    const current = db.prepare(`
      SELECT *
      FROM program_matching_family_terms
      WHERE id = ?
    `).get(termId);

    if (!current) {
      throw apiError(404, 'Denumirea nu exista.');
    }

    const term = adminText(req.body.term ?? current.term);
    const termNorm = canonicalCourseName(term);
    const matchMode = adminText(
      req.body.match_mode ?? current.match_mode
    );
    const isExclusion = matchingBoolean(
      req.body.is_exclusion,
      current.is_exclusion
    );

    if (!term || !termNorm) {
      throw apiError(400, 'Denumirea este obligatorie.');
    }

    if (!MATCHING_TERM_MODES.has(matchMode)) {
      throw apiError(400, 'Tipul de potrivire este invalid.');
    }

    db.prepare(`
      UPDATE program_matching_family_terms
      SET term = ?,
          term_norm = ?,
          match_mode = ?,
          is_exclusion = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      term,
      termNorm,
      matchMode,
      isExclusion,
      matchingBoolean(req.body.is_active, current.is_active),
      termId
    );

    res.json(
      db.prepare(`
        SELECT *
        FROM program_matching_family_terms
        WHERE id = ?
      `).get(termId)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Denumirea exista deja in aceasta familie.'
        : (error.message || 'Nu am putut actualiza denumirea familiei.'),
    });
  }
});

app.delete('/api/program-matching-family-terms/:id', (req, res) => {
  const termId = parsePositiveId(req.params.id);

  if (!termId) {
    return res.status(400).json({ error: 'ID denumire invalid.' });
  }

  const result = db.prepare(`
    DELETE FROM program_matching_family_terms
    WHERE id = ?
  `).run(termId);

  if (!result.changes) {
    return res.status(404).json({ error: 'Denumirea nu exista.' });
  }

  res.json({ ok: true });
});

app.post('/api/programs/:programId/matching-direct-rules', (req, res) => {
  try {
    const programId = parsePositiveId(req.params.programId);

    if (!programId) {
      throw apiError(400, 'ID program invalid.');
    }

    matchingProgramOrThrow(programId);

    const sourceName = adminText(req.body.source_name);
    const targetName = adminText(req.body.target_name);
    const sourceNorm = canonicalCourseName(sourceName);
    const targetNorm = canonicalCourseName(targetName);
    const direction = adminText(req.body.direction || 'forward');
    const decisionStatus = adminText(
      req.body.decision_status || 'needs_review'
    );
    const notes = adminText(req.body.notes) || null;

    if (!sourceName || !sourceNorm) {
      throw apiError(400, 'Disciplina sursa este obligatorie.');
    }

    if (!targetName || !targetNorm) {
      throw apiError(400, 'Disciplina tinta este obligatorie.');
    }

    if (sourceNorm === targetNorm) {
      throw apiError(
        400,
        'Sursa si tinta sunt identice dupa normalizare.'
      );
    }

    if (!MATCHING_RULE_DIRECTIONS.has(direction)) {
      throw apiError(400, 'Directia regulii este invalida.');
    }

    if (!MATCHING_RULE_DECISIONS.has(decisionStatus)) {
      throw apiError(400, 'Decizia regulii este invalida.');
    }

    const result = db.prepare(`
      INSERT INTO program_matching_direct_rules(
        program_id,
        source_name,
        source_norm,
        target_name,
        target_norm,
        direction,
        decision_status,
        is_active,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      programId,
      sourceName,
      sourceNorm,
      targetName,
      targetNorm,
      direction,
      decisionStatus,
      matchingBoolean(req.body.is_active, 1),
      notes
    );

    res.status(201).json(
      db.prepare(`
        SELECT *
        FROM program_matching_direct_rules
        WHERE id = ?
      `).get(result.lastInsertRowid)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Regula directa exista deja pentru programul selectat.'
        : (error.message || 'Nu am putut salva regula directa.'),
    });
  }
});

app.put('/api/program-matching-direct-rules/:id', (req, res) => {
  try {
    const ruleId = parsePositiveId(req.params.id);

    if (!ruleId) {
      throw apiError(400, 'ID regula invalid.');
    }

    const current = db.prepare(`
      SELECT *
      FROM program_matching_direct_rules
      WHERE id = ?
    `).get(ruleId);

    if (!current) {
      throw apiError(404, 'Regula directa nu exista.');
    }

    const sourceName = adminText(
      req.body.source_name ?? current.source_name
    );
    const targetName = adminText(
      req.body.target_name ?? current.target_name
    );
    const sourceNorm = canonicalCourseName(sourceName);
    const targetNorm = canonicalCourseName(targetName);
    const direction = adminText(
      req.body.direction ?? current.direction
    );
    const decisionStatus = adminText(
      req.body.decision_status ?? current.decision_status
    );
    const notes = req.body.notes === undefined
      ? current.notes
      : (adminText(req.body.notes) || null);

    if (!sourceNorm || !targetNorm) {
      throw apiError(400, 'Sursa si tinta sunt obligatorii.');
    }

    if (sourceNorm === targetNorm) {
      throw apiError(
        400,
        'Sursa si tinta sunt identice dupa normalizare.'
      );
    }

    if (!MATCHING_RULE_DIRECTIONS.has(direction)) {
      throw apiError(400, 'Directia regulii este invalida.');
    }

    if (!MATCHING_RULE_DECISIONS.has(decisionStatus)) {
      throw apiError(400, 'Decizia regulii este invalida.');
    }

    db.prepare(`
      UPDATE program_matching_direct_rules
      SET source_name = ?,
          source_norm = ?,
          target_name = ?,
          target_norm = ?,
          direction = ?,
          decision_status = ?,
          is_active = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      sourceName,
      sourceNorm,
      targetName,
      targetNorm,
      direction,
      decisionStatus,
      matchingBoolean(req.body.is_active, current.is_active),
      notes,
      ruleId
    );

    res.json(
      db.prepare(`
        SELECT *
        FROM program_matching_direct_rules
        WHERE id = ?
      `).get(ruleId)
    );
  } catch (error) {
    const isDuplicate = String(error.message || '').includes('UNIQUE');

    res.status(isDuplicate ? 409 : (error.status || 500)).json({
      error: isDuplicate
        ? 'Regula directa exista deja pentru programul selectat.'
        : (error.message || 'Nu am putut actualiza regula directa.'),
    });
  }
});

app.delete('/api/program-matching-direct-rules/:id', (req, res) => {
  const ruleId = parsePositiveId(req.params.id);

  if (!ruleId) {
    return res.status(400).json({ error: 'ID regula invalid.' });
  }

  const result = db.prepare(`
    DELETE FROM program_matching_direct_rules
    WHERE id = ?
  `).run(ruleId);

  if (!result.changes) {
    return res.status(404).json({ error: 'Regula directa nu exista.' });
  }

  res.json({ ok: true });
});


// ---------- EXPLICIT EQUIVALENCY RULES ----------
// O regula este legata de o disciplina tinta concreta, nu de un identifier.
// rule_type: alias | academic | package_option | composite | review_only
// decision_status: auto | needs_review

function validateRuleInput(payload) {
  const courseId = Number(payload.course_id);
  const sourceName = String(payload.source_name || '').trim();
  const ruleType = String(payload.rule_type || 'academic').trim();
  const decisionStatus = String(
    payload.decision_status ||
      (ruleType === 'alias' ? 'auto' : 'needs_review')
  ).trim();
  const isActive = payload.is_active === undefined
    ? 1
    : (payload.is_active ? 1 : 0);
  const notes = String(payload.notes || '').trim() || null;

  const allowedTypes = new Set([
    'alias',
    'academic',
    'package_option',
    'composite',
    'review_only',
  ]);
  const allowedStatuses = new Set(['auto', 'needs_review']);

  if (!Number.isInteger(courseId) || courseId <= 0) {
    throw apiError(400, 'course_id invalid');
  }

  if (!sourceName) {
    throw apiError(400, 'source_name required');
  }

  const sourceNorm = canonicalCourseName(sourceName);

  if (!sourceNorm) {
    throw apiError(400, 'source_name nu contine o denumire valida');
  }

  if (!allowedTypes.has(ruleType)) {
    throw apiError(400, 'rule_type invalid');
  }

  if (!allowedStatuses.has(decisionStatus)) {
    throw apiError(400, 'decision_status invalid');
  }

  return {
    courseId,
    sourceName,
    sourceNorm,
    ruleType,
    decisionStatus,
    isActive,
    notes,
  };
}

app.get('/api/equivalency-rules', (req, res) => {
  const templateId = req.query.templateId
    ? Number(req.query.templateId)
    : null;

  if (req.query.templateId && (!Number.isInteger(templateId) || templateId <= 0)) {
    return res.status(400).json({ error: 'templateId invalid' });
  }

  const rules = templateId
    ? db.prepare(`
        SELECT
          r.*,
          c.template_id,
          c.name AS course_name
        FROM course_equivalency_rules r
        JOIN courses c ON c.id = r.course_id
        WHERE c.template_id = ?
        ORDER BY c.year, c.semester, c.id, r.id
      `).all(templateId)
    : db.prepare(`
        SELECT
          r.*,
          c.template_id,
          c.name AS course_name
        FROM course_equivalency_rules r
        JOIN courses c ON c.id = r.course_id
        ORDER BY c.template_id, c.year, c.semester, c.id, r.id
      `).all();

  res.json(rules);
});

app.post('/api/equivalency-rules', (req, res) => {
  try {
    const rule = validateRuleInput(req.body || {});
    const course = db.prepare(`
      SELECT id, template_id, name
      FROM courses
      WHERE id = ?
    `).get(rule.courseId);

    if (!course) {
      throw apiError(404, 'Curs tinta inexistent');
    }

    const saved = db.prepare(`
      INSERT INTO course_equivalency_rules (
        course_id,
        source_name,
        source_norm,
        rule_type,
        decision_status,
        is_active,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, source_norm) DO UPDATE SET
        source_name = excluded.source_name,
        rule_type = excluded.rule_type,
        decision_status = excluded.decision_status,
        is_active = excluded.is_active,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      rule.courseId,
      rule.sourceName,
      rule.sourceNorm,
      rule.ruleType,
      rule.decisionStatus,
      rule.isActive,
      rule.notes
    );

    const stored = db.prepare(`
      SELECT
        r.*,
        c.template_id,
        c.name AS course_name
      FROM course_equivalency_rules r
      JOIN courses c ON c.id = r.course_id
      WHERE r.course_id = ? AND r.source_norm = ?
    `).get(rule.courseId, rule.sourceNorm);

    res.status(201).json({
      ok: true,
      inserted_or_updated: saved.changes,
      rule: stored,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Nu am putut salva regula.'
    });
  }
});

// Promoveaza o selectie deja confirmata manual intr-o regula reutilizabila.
// Implicit o cream ca needs_review; Admin o poate aproba ulterior pentru auto.
app.post('/api/runs/:runId/equivalency-rules', (req, res) => {
  const runId = Number(req.params.runId);

  try {
    if (!Number.isInteger(runId) || runId <= 0) {
      throw apiError(400, 'runId invalid');
    }

    const courseId = Number(req.body?.course_id);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      throw apiError(400, 'course_id invalid');
    }

    const selected = db.prepare(`
      SELECT
        c.id AS course_id,
        c.template_id,
        tl.name AS source_name
      FROM runs r
      JOIN courses c
        ON c.id = ?
       AND c.template_id = r.template_id
      JOIN course_matches m
        ON m.run_id = r.id
       AND m.course_id = c.id
      JOIN transcript_lines tl
        ON tl.id = m.transcript_line_id
      WHERE r.id = ?
    `).get(courseId, runId);

    if (!selected || !selected.source_name) {
      throw apiError(
        409,
        'Nu exista o selectie acceptata pentru acest curs in rularea indicata.'
      );
    }

    const payload = {
      course_id: selected.course_id,
      source_name: selected.source_name,
      rule_type: req.body?.rule_type || 'academic',
      decision_status: req.body?.decision_status || 'needs_review',
      is_active: true,
      notes: req.body?.notes || `Propusa din rularea ${runId}.`,
    };

    const rule = validateRuleInput(payload);

    db.prepare(`
      INSERT INTO course_equivalency_rules (
        course_id,
        source_name,
        source_norm,
        rule_type,
        decision_status,
        is_active,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, source_norm) DO UPDATE SET
        rule_type = excluded.rule_type,
        decision_status = excluded.decision_status,
        is_active = excluded.is_active,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      rule.courseId,
      rule.sourceName,
      rule.sourceNorm,
      rule.ruleType,
      rule.decisionStatus,
      rule.isActive,
      rule.notes
    );

    const stored = db.prepare(`
      SELECT
        r.*,
        c.template_id,
        c.name AS course_name
      FROM course_equivalency_rules r
      JOIN courses c ON c.id = r.course_id
      WHERE r.course_id = ? AND r.source_norm = ?
    `).get(rule.courseId, rule.sourceNorm);

    res.status(201).json({ ok: true, rule: stored });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Nu am putut promova selectia in regula.'
    });
  }
});

app.patch('/api/equivalency-rules/:id', (req, res) => {
  const ruleId = Number(req.params.id);

  try {
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      throw apiError(400, 'rule id invalid');
    }

    const current = db.prepare(`
      SELECT *
      FROM course_equivalency_rules
      WHERE id = ?
    `).get(ruleId);

    if (!current) {
      throw apiError(404, 'Regula inexistenta');
    }

    const decisionStatus = req.body?.decision_status === undefined
      ? current.decision_status
      : String(req.body.decision_status);

    const isActive = req.body?.is_active === undefined
      ? current.is_active
      : (req.body.is_active ? 1 : 0);

    const notes = req.body?.notes === undefined
      ? current.notes
      : (String(req.body.notes || '').trim() || null);

    if (!new Set(['auto', 'needs_review']).has(decisionStatus)) {
      throw apiError(400, 'decision_status invalid');
    }

    db.prepare(`
      UPDATE course_equivalency_rules
      SET
        decision_status = ?,
        is_active = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(decisionStatus, isActive, notes, ruleId);

    res.json(
      db.prepare(`
        SELECT
          r.*,
          c.template_id,
          c.name AS course_name
        FROM course_equivalency_rules r
        JOIN courses c ON c.id = r.course_id
        WHERE r.id = ?
      `).get(ruleId)
    );
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Nu am putut actualiza regula.'
    });
  }
});

app.delete('/api/equivalency-rules/:id', (req, res) => {
  const ruleId = Number(req.params.id);

  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    return res.status(400).json({ error: 'rule id invalid' });
  }

  const result = db.prepare(`
    DELETE FROM course_equivalency_rules
    WHERE id = ?
  `).run(ruleId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Regula inexistenta' });
  }

  res.json({ ok: true });
});

function cleanRequiredText(value) {
  return String(value || '').trim();
}

function sanitizeFilenamePart(value, fallback = 'Document') {
  const cleaned = cleanRequiredText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return cleaned || fallback;
}

function getRunStudentData(run) {
  return {
    student_name: cleanRequiredText(run?.student_name),
    destination_program: cleanRequiredText(run?.destination_program),
    continuation_cohort: cleanRequiredText(run?.continuation_cohort),
  };
}

function validateRunStudentData(studentData) {
  if (!studentData.student_name) {
    return 'Numele studentului este obligatoriu.';
  }

  return null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPassedAcademicResult(row) {
  const status = cleanRequiredText(row?.student_academic_status).toLowerCase();

  if (status === 'passed') return true;
  if (status === 'failed') return false;

  const raw = cleanRequiredText(row?.student_grade_raw).toUpperCase();

  if (raw === 'P') return true;
  if (raw === 'N' || raw === '-') return false;

  const numericGrade = toFiniteNumber(row?.student_grade_numeric);
  return numericGrade !== null && numericGrade >= 5;
}

function calculateTargetEctsTotals(rows) {
  const totalsByYear = {};
  const countedCourseIds = new Set();
  const skippedCourses = [];

  for (const row of rows) {
    if (!row?.transcript_line_id || !row?.student_course_name) {
      continue;
    }

    const courseId = Number(row.course_id);

    if (!Number.isInteger(courseId) || countedCourseIds.has(courseId)) {
      continue;
    }

    countedCourseIds.add(courseId);

    if (!isPassedAcademicResult(row)) {
      continue;
    }

    const year = Number(row.year);
    const targetEcts = toFiniteNumber(row.ects);

    if (!Number.isInteger(year) || year <= 0) {
      skippedCourses.push({
        course_id: row.course_id,
        course_name: row.course_name,
        reason: 'missing_or_invalid_year',
      });
      continue;
    }

    if (targetEcts === null || targetEcts < 0) {
      skippedCourses.push({
        course_id: row.course_id,
        course_name: row.course_name,
        reason: 'missing_or_invalid_target_ects',
      });
      continue;
    }

    totalsByYear[String(year)] =
      (totalsByYear[String(year)] || 0) + targetEcts;
  }

  for (const year of Object.keys(totalsByYear)) {
    totalsByYear[year] = Number(totalsByYear[year].toFixed(4));
  }

  return {
    by_year: totalsByYear,
    skipped_courses: skippedCourses,
  };
}


function friendlyTranscriptParserError(details) {
  const rawDetails = String(details || '').trim();
  const normalized = foldText(rawDetails);

  if (
    normalized.includes('openpyxl is not installed') ||
    normalized.includes('no module named openpyxl')
  ) {
    return {
      status: 500,
      error:
        'Suportul pentru fisiere .xlsx nu este disponibil in Python-ul folosit de backend.',
      details:
        'Porneste backend-ul cu backend\\.venv sau instaleaza openpyxl in acel mediu.',
    };
  }

  if (
    normalized.includes('nu este un workbook excel valid') ||
    normalized.includes('not a valid xlsx') ||
    normalized.includes('badzipfile') ||
    normalized.includes('file is not a zip file')
  ) {
    return {
      status: 400,
      error:
        'Fisierul .xlsx nu este un workbook Excel valid.',
      details:
        'Deschide fisierul in Excel sau LibreOffice si salveaza-l din nou ca Excel Workbook (.xlsx).',
    };
  }

  if (
    normalized.includes('nu pot citi csv') ||
    normalized.includes('not a valid .xlsx or .csv')
  ) {
    return {
      status: 400,
      error:
        'Fisierul incarcat nu a putut fi citit ca .xlsx sau .csv.',
      details: rawDetails,
    };
  }

  return {
    status: 500,
    error: 'Nu am putut procesa foaia matricola.',
    details: rawDetails || 'Parserul Python s-a oprit cu eroare.',
  };
}

// ---------- OPERATOR FLOW ----------

// MATCH: upload .xlsx/.csv -> parse -> auto match -> răspuns cu tabel
app.post('/api/match', uploadStudents.single('xlsx'), (req, res) => {
  const { program_id, variant_id, student_name } = req.body;
  if (!req.file || (!program_id && !variant_id)) {
    return res.status(400).json({
      error: 'Fisierul si anul / tipul sunt obligatorii.',
    });
  }

  const studentData = {
    student_name: cleanRequiredText(student_name),
    destination_program: '',
    continuation_cohort: '',
  };

  const studentDataError = validateRunStudentData(studentData);

  if (studentDataError) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: studentDataError });
  }

  const uploadError = validateUploadedFile(req.file, 'transcript');

  if (uploadError) {
    removeUploadedFile(req.file);
    return res.status(400).json({ error: uploadError });
  }

  const variantId = parsePositiveId(variant_id);
  let selectedVariant = null;
  let tpl = null;

  if (variantId) {
    selectedVariant = db.prepare(`
      SELECT pv.*, p.is_active AS program_is_active
      FROM program_variants pv
      JOIN programs p ON p.id = pv.program_id
      WHERE pv.id = ?
    `).get(variantId);

    if (!selectedVariant) {
      removeUploadedFile(req.file);
      return res.status(404).json({ error: 'Anul / tipul nu exista.' });
    }

    if (!selectedVariant.is_active || !selectedVariant.program_is_active) {
      removeUploadedFile(req.file);
      return res.status(400).json({
        error: 'Programul sau anul selectat este inactiv.',
      });
    }

    tpl = db.prepare(`
      SELECT *
      FROM program_templates
      WHERE variant_id = ? AND is_active = 1
    `).get(variantId);
  } else {
    tpl = db.prepare(`
      SELECT *
      FROM program_templates
      WHERE program_id = ? AND is_active = 1
      ORDER BY id DESC
    `).get(program_id);
  }

  if (!tpl) {
    removeUploadedFile(req.file);
    return res.status(400).json({
      error: 'Anul / tipul selectat nu are un template activ.',
    });
  }

  const configuredProgram = db.prepare(`
    SELECT name
    FROM programs
    WHERE id = ?
  `).get(tpl.program_id);

  studentData.destination_program = cleanRequiredText(configuredProgram?.name);

  const storedTranscriptPath = toPortableStoredPath(req.file.path);

  const run = db.prepare(`
    INSERT INTO runs(
      template_id,
      student_name,
      destination_program,
      continuation_cohort,
      original_filename,
      xlsx_path,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, 'processing')
  `).run(
    tpl.id,
    studentData.student_name,
    studentData.destination_program,
    studentData.continuation_cohort,
    req.file.originalname || '',
    storedTranscriptPath
  );
  const runId = run.lastInsertRowid;

  // Python: parse xlsx/csv -> transcript_lines
  const py = spawn(PY, [path.join(__dirname, 'matching_algorithm.py')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  py.stdin.write(JSON.stringify({ mode: 'match', xlsx_path: req.file.path }));
  py.stdin.end();

  let out = '', err = '';
  py.stdout.on('data', d => out += d.toString('utf8'));
  py.stderr.on('data', d => err += d.toString('utf8'));

  py.on('close', code => {
    if (code !== 0) {
      db.prepare(`UPDATE runs SET status='error' WHERE id=?`).run(runId);

      const parserError = friendlyTranscriptParserError(err);

      return res.status(parserError.status).json({
        error: parserError.error,
        details: parserError.details,
      });
    }

    let result;
    try {
      result = JSON.parse(out); // { transcript_lines: [...] }
    } catch (e) {
      db.prepare(`UPDATE runs SET status='error' WHERE id=?`).run(runId);
      return res.status(500).json({ error: 'Invalid JSON from matcher', out, err });
    }

    // Inserăm transcript_lines în DB și mapăm id local -> id DB
    const idMap = new Map();
    const txIns = db.transaction(() => {
      for (const line of result.transcript_lines || []) {
        const r = insTranscriptLine.run(
          runId,
          line.name,
          line.name_norm,
          line.ects ?? null,
          line.grade ?? line.grade_numeric ?? null,
          line.grade_raw ?? null,
          line.academic_status ?? 'unknown',
          line.year_of_study ?? null
        );
        idMap.set(line.id, r.lastInsertRowid);
      }
    });
    txIns();

    const courses = getTemplateCourses(tpl.id);

    // ---------- Matching explicabil si alocare globala ----------
    const transcriptRows = (result.transcript_lines || [])
      .map((line) => ({
        ...line,
        db_id: idMap.get(line.id),
      }))
      .filter((line) => line.db_id);

    const aliasesByCourse = buildAliasesByCourse(courses);
    const rulesByCourse = buildRulesByCourse(courses);
    const programMatchingRuntime = buildProgramMatchingRuntime(
      tpl.program_id
    );

    // Pentru fiecare curs tinta si fiecare disciplina din transcript, calculam un scor independent si o explicatie.
    const candidateMatrix = courses.map((course) =>
      transcriptRows.map((line) =>
        scoreCourseAgainstTranscript(
          course,
          line,
          aliasesByCourse,
          rulesByCourse,
          programMatchingRuntime
        )
      )
    );

    // ---------- alocare in doua etape ----------
    // prima data aloca exclusiv potriri Auto. O sugestie de review nu poate
    // ocupa o disciplina sursa care ar putea produce o echivalare automata.
    const autoWeightMatrix = candidateMatrix.map((courseCandidates) => [
      ...courseCandidates.map((candidate) =>
        candidate.score >= AUTO_THRESHOLD ? candidate.score : 0
      ),
      ...Array(courses.length).fill(0),
    ]);

    const autoAssignment = maximumWeightAssignment(autoWeightMatrix);
    const autoByCourseIndex = new Map();
    const usedAutoTranscriptIndexes = new Set();

    for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
      const assignedColumn = autoAssignment[courseIndex];

      if (assignedColumn < 0 || assignedColumn >= transcriptRows.length) {
        continue;
      }

      const candidate = candidateMatrix[courseIndex][assignedColumn];

      if (!candidate || candidate.score < AUTO_THRESHOLD) {
        continue;
      }

      autoByCourseIndex.set(courseIndex, {
        transcriptIndex: assignedColumn,
        candidate,
      });
      usedAutoTranscriptIndexes.add(assignedColumn);
    }

    // Acum construieste doar sugestii Needs review pentru cursurile fara
    // Auto si numai din disciplinele sursa nefolosite prima data.
    const remainingCourseIndexes = courses
      .map((_, courseIndex) => courseIndex)
      .filter((courseIndex) => !autoByCourseIndex.has(courseIndex));

    const availableTranscriptIndexes = transcriptRows
      .map((_, transcriptIndex) => transcriptIndex)
      .filter(
        (transcriptIndex) => !usedAutoTranscriptIndexes.has(transcriptIndex)
      );

    const reviewWeightMatrix = remainingCourseIndexes.map((courseIndex) => [
      ...availableTranscriptIndexes.map((transcriptIndex) => {
        const candidate = candidateMatrix[courseIndex][transcriptIndex];

        return candidate.score >= REVIEW_THRESHOLD &&
          candidate.score < AUTO_THRESHOLD
          ? candidate.score
          : 0;
      }),
      ...Array(remainingCourseIndexes.length).fill(0),
    ]);

    const reviewAssignment = maximumWeightAssignment(reviewWeightMatrix);
    const reviewByCourseIndex = new Map();
    const usedReviewTranscriptIndexes = new Set();

    for (
      let reviewRowIndex = 0;
      reviewRowIndex < remainingCourseIndexes.length;
      reviewRowIndex += 1
    ) {
      const courseIndex = remainingCourseIndexes[reviewRowIndex];
      const assignedColumn = reviewAssignment[reviewRowIndex];

      if (
        assignedColumn < 0 ||
        assignedColumn >= availableTranscriptIndexes.length
      ) {
        continue;
      }

      const transcriptIndex = availableTranscriptIndexes[assignedColumn];
      const candidate = candidateMatrix[courseIndex][transcriptIndex];

      if (
        !candidate ||
        candidate.score < REVIEW_THRESHOLD ||
        candidate.score >= AUTO_THRESHOLD
      ) {
        continue;
      }

      reviewByCourseIndex.set(courseIndex, {
        transcriptIndex,
        candidate,
      });
      usedReviewTranscriptIndexes.add(transcriptIndex);
    }

    const unavailableForFallbackIndexes = new Set([
      ...usedAutoTranscriptIndexes,
      ...usedReviewTranscriptIndexes,
    ]);

    const decisionsByCourse = new Map();

    for (let courseIndex = 0; courseIndex < courses.length; courseIndex += 1) {
      const autoMatch = autoByCourseIndex.get(courseIndex);
      const reviewMatch = reviewByCourseIndex.get(courseIndex);
      let decision;

      if (autoMatch) {
        const transcript = transcriptRows[autoMatch.transcriptIndex];
        const candidate = autoMatch.candidate;

        decision = {
          transcript_line_id: transcript.db_id,
          suggested_transcript_line_id: null,
          confidence: candidate.score,
          source: 'auto',
          decision_status: 'auto',
          match_reason: candidate.reason,
          score_details: JSON.stringify({
            allocation_stage: 'auto',
            score: candidate.score,
            threshold_auto: AUTO_THRESHOLD,
            transcript_name: transcript.name,
            ...(candidate.details || {}),
          }),
        };
      } else if (reviewMatch) {
        const transcript = transcriptRows[reviewMatch.transcriptIndex];
        const candidate = reviewMatch.candidate;

        decision = {
          transcript_line_id: null,
          suggested_transcript_line_id: transcript.db_id,
          confidence: candidate.score,
          source: 'system',
          decision_status: 'needs_review',
          match_reason: candidate.reason,
          score_details: JSON.stringify({
            allocation_stage: 'review',
            score: candidate.score,
            threshold_review: REVIEW_THRESHOLD,
            threshold_auto: AUTO_THRESHOLD,
            suggested_transcript_name: transcript.name,
            ...(candidate.details || {}),
          }),
        };
      } else {
        const bestAvailable = candidateMatrix[courseIndex]
          .map((candidate, transcriptIndex) => ({
            candidate,
            transcriptIndex,
          }))
          .filter(
            ({ transcriptIndex }) =>
              !unavailableForFallbackIndexes.has(transcriptIndex)
          )
          .sort((left, right) => right.candidate.score - left.candidate.score)[0];

        const bestScore = bestAvailable ? bestAvailable.candidate.score : 0;

        decision = {
          transcript_line_id: null,
          suggested_transcript_line_id: null,
          confidence: bestScore,
          source: 'system',
          decision_status: 'no_match',
          match_reason:
            bestScore >= REVIEW_THRESHOLD
              ? 'Un candidat eligibil era deja folosit pentru o alocare prioritara.'
              : bestScore > 0
                ? `Niciun candidat disponibil nu a depasit pragul de verificare (${REVIEW_THRESHOLD}).`
                : 'Nu exista un candidat suficient de apropiat.',
          score_details: JSON.stringify({
            allocation_stage: 'none',
            best_available_score: bestScore,
            threshold_review: REVIEW_THRESHOLD,
            best_candidate_reason: bestAvailable?.candidate.reason || null,
            best_candidate_details: bestAvailable?.candidate.details || null,
          }),
        };
      }

      decisionsByCourse.set(courses[courseIndex].id, decision);
    }

    const txSave = db.transaction(() => {
      for (const course of courses) {
        const decision = decisionsByCourse.get(course.id);

        upsertMatchStmt.run({
          run_id: runId,
          course_id: course.id,
          transcript_line_id: decision?.transcript_line_id ?? null,
          suggested_transcript_line_id:
            decision?.suggested_transcript_line_id ?? null,
          confidence: decision?.confidence ?? 0,
          source: decision?.source ?? 'auto',
          decision_status: decision?.decision_status ?? 'no_match',
          match_reason: decision?.match_reason ?? 'Nu exista potrivire.',
          score_details: decision?.score_details ?? null,
        });
      }

      db.prepare(`UPDATE runs SET status='ready' WHERE id=?`).run(runId);
    });
    txSave();

    // răspuns: fără inferență; doar aliasăm year -> year_of_study pentru UI
    const rows = db.prepare(`
      SELECT
        c.id as course_id,
        c.name as course_name,
        c.year,
        c.semester,
        c.ects,
        c.identifier,
        m.transcript_line_id,
        m.suggested_transcript_line_id,
        m.confidence,
        m.source,
        m.decision_status,
        m.match_reason,
        m.score_details,
        tl.grade,
        tl.grade_raw,
        tl.academic_status,
        suggested_line.name AS suggested_transcript_name
      FROM courses c
      LEFT JOIN course_matches m ON m.course_id=c.id AND m.run_id=?
      LEFT JOIN transcript_lines tl ON tl.id=m.transcript_line_id
      LEFT JOIN transcript_lines suggested_line
        ON suggested_line.id=m.suggested_transcript_line_id
      WHERE c.template_id = ?
      ORDER BY c.year, c.semester, c.id
    `).all(runId, tpl.id);

    const rowsWithYear = rows.map(r => ({ ...r, year_of_study: r.year }));

    const tls = db.prepare(`
      SELECT
        id,
        name,
        grade,
        grade AS grade_numeric,
        grade_raw,
        academic_status,
        ects,
        year_of_study
      FROM transcript_lines
      WHERE run_id=?
    `).all(runId);
    const stats = summarizeMatchDecisions(rowsWithYear);
    const matched = stats.accepted;

    res.json({
      run_id: runId,
      template_id: tpl.id,
      student_name: studentData.student_name,
      student_data: studentData,
      variant: selectedVariant
        ? {
            id: selectedVariant.id,
            code: selectedVariant.code,
            name: selectedVariant.name,
            study_year: selectedVariant.study_year,
          }
        : null,
      total: rowsWithYear.length,
      matched,
      stats,
      rows: rowsWithYear,
      transcript_lines: tls
    });
  });
});

// listă rânduri (pt refresh UI)
app.get('/api/runs/:runId/courses', (req, res) => {
  const runId = Number(req.params.runId);
  const run = db.prepare(`SELECT * FROM runs WHERE id=?`).get(runId);
  if (!run) return res.status(404).json({ error: 'run not found' });

  const rows = db.prepare(`
    SELECT
      c.id as course_id,
      c.name as course_name,
      c.year,
      c.semester,
      c.ects,
      c.identifier,
      m.transcript_line_id,
      m.suggested_transcript_line_id,
      m.confidence,
      m.source,
      m.decision_status,
      m.match_reason,
      m.score_details,
      tl.grade,
      tl.grade_raw,
      tl.academic_status,
      suggested_line.name AS suggested_transcript_name
    FROM courses c
    LEFT JOIN course_matches m ON m.course_id=c.id AND m.run_id=?
    LEFT JOIN transcript_lines tl ON tl.id=m.transcript_line_id
    LEFT JOIN transcript_lines suggested_line
      ON suggested_line.id=m.suggested_transcript_line_id
    WHERE c.template_id = ?
    ORDER BY c.year, c.semester, c.id
  `).all(runId, run.template_id);

  const rowsWithYear = rows.map(r => ({ ...r, year_of_study: r.year }));

  const tls = db.prepare(`
    SELECT
      id,
      name,
      grade,
      grade AS grade_numeric,
      grade_raw,
      academic_status,
      ects,
      year_of_study
    FROM transcript_lines
    WHERE run_id=?
  `).all(runId);
  const stats = summarizeMatchDecisions(rowsWithYear);
  const matched = stats.accepted;

  res.json({
    run_id: runId,
    student_data: getRunStudentData(run),
    total: rowsWithYear.length,
    matched,
    stats,
    rows: rowsWithYear,
    transcript_lines: tls
  });
});

app.put('/api/runs/:runId/student-data', (req, res) => {
  const runId = Number(req.params.runId);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ error: 'runId invalid' });
  }

  const run = db.prepare(`
    SELECT id, status
    FROM runs
    WHERE id = ?
  `).get(runId);

  if (!run) {
    return res.status(404).json({ error: 'run not found' });
  }

  const currentRun = db.prepare(`
    SELECT *
    FROM runs
    WHERE id = ?
  `).get(runId);

  const studentData = {
    ...getRunStudentData(currentRun),
    student_name: cleanRequiredText(req.body.student_name),
  };

  const validationError = validateRunStudentData(studentData);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  db.prepare(`
    UPDATE runs
    SET student_name = ?
    WHERE id = ?
  `).run(studentData.student_name, runId);

  res.json({
    ok: true,
    student_data: studentData,
  });
});

// Override manual: salveaza doar modificarile valide si creeaza audit.
app.post('/api/runs/:runId/overrides', (req, res) => {
  const runId = Number(req.params.runId);
  const items = req.body.items;

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ error: 'runId invalid' });
  }

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items trebuie sa fie un array' });
  }

  if (items.length === 0) {
    return res.json({ ok: true, saved: 0 });
  }

  const run = db.prepare(`
    SELECT id, template_id, status
    FROM runs
    WHERE id = ?
  `).get(runId);

  if (!run) {
    return res.status(404).json({ error: 'run not found' });
  }

  if (run.status !== 'ready') {
    return res.status(409).json({
      error: 'Rularea nu este pregatita pentru modificari manuale.'
    });
  }

  const parseTranscriptLineId = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
      throw apiError(400, 'transcript_line_id invalid');
    }

    return id;
  };

  try {
    const saved = db.transaction(() => {
      const courseExists = db.prepare(`
        SELECT id
        FROM courses
        WHERE id = ? AND template_id = ?
      `);

      const transcriptExists = db.prepare(`
        SELECT id
        FROM transcript_lines
        WHERE id = ? AND run_id = ?
      `);

      const currentMatches = db.prepare(`
        SELECT course_id, transcript_line_id, confidence, source
        FROM course_matches
        WHERE run_id = ?
      `).all(runId);

      const currentByCourse = new Map(
        currentMatches.map((match) => [match.course_id, match])
      );

      const requestedChanges = new Map();

      for (const rawItem of items) {
        const courseId = Number(rawItem.course_id);

        if (!Number.isInteger(courseId) || courseId <= 0) {
          throw apiError(400, 'course_id invalid');
        }

        if (requestedChanges.has(courseId)) {
          throw apiError(
            400,
            `Cursul ${courseId} a fost trimis de mai multe ori.`
          );
        }

        const course = courseExists.get(courseId, run.template_id);

        if (!course) {
          throw apiError(
            400,
            `Cursul ${courseId} nu apartine template-ului acestei rulari.`
          );
        }

        const transcriptLineId = parseTranscriptLineId(
          rawItem.transcript_line_id
        );

        if (
          transcriptLineId !== null &&
          !transcriptExists.get(transcriptLineId, runId)
        ) {
          throw apiError(
            400,
            `Linia ${transcriptLineId} nu apartine acestei foi matricole.`
          );
        }

        requestedChanges.set(courseId, transcriptLineId);
      }

   
      const finalAssignments = new Map(
        currentMatches.map((match) => [
          match.course_id,
          match.transcript_line_id,
        ])
      );

      for (const [courseId, transcriptLineId] of requestedChanges) {
        finalAssignments.set(courseId, transcriptLineId);
      }

      // Aceeasi disciplina din foaia matricola nu poate fi folosita de doua ori.
      const lineOwner = new Map();

      for (const [courseId, transcriptLineId] of finalAssignments) {
        if (transcriptLineId === null) continue;

        if (
          lineOwner.has(transcriptLineId) &&
          lineOwner.get(transcriptLineId) !== courseId
        ) {
          throw apiError(
            409,
            'Aceeasi disciplina din foaia matricola este aleasa pentru doua cursuri diferite.'
          );
        }

        lineOwner.set(transcriptLineId, courseId);
      }

      const actualChanges = [];

      for (const [courseId, newTranscriptLineId] of requestedChanges) {
        const oldMatch = currentByCourse.get(courseId) || {
          transcript_line_id: null,
          confidence: null,
          source: null,
        };

        const oldTranscriptLineId = oldMatch.transcript_line_id ?? null;

        if (oldTranscriptLineId === newTranscriptLineId) {
          continue;
        }

        actualChanges.push({
          courseId,
          oldTranscriptLineId,
          newTranscriptLineId,
          oldSource: oldMatch.source,
        });
      }

      if (actualChanges.length === 0) {
        return 0;
      }

      // Eliberam mai intai liniile vechi, pentru a permite schimburi intre doua cursuri.
      const clearChangedMatches = db.prepare(`
        UPDATE course_matches
        SET transcript_line_id = NULL
        WHERE run_id = ? AND course_id = ?
      `);

      for (const change of actualChanges) {
        clearChangedMatches.run(runId, change.courseId);
      }

      const saveManualMatch = db.prepare(`
        INSERT INTO course_matches (
          run_id,
          course_id,
          transcript_line_id,
          suggested_transcript_line_id,
          confidence,
          source,
          decision_status,
          match_reason,
          score_details
        )
        VALUES (?, ?, ?, NULL, NULL, 'manual', 'manual', 'Modificare manuala a operatorului.', NULL)
        ON CONFLICT(run_id, course_id) DO UPDATE SET
          transcript_line_id = excluded.transcript_line_id,
          suggested_transcript_line_id = NULL,
          confidence = NULL,
          source = 'manual',
          decision_status = 'manual',
          match_reason = 'Modificare manuala a operatorului.',
          score_details = NULL,
          decided_at = CURRENT_TIMESTAMP
      `);

      const addAudit = db.prepare(`
        INSERT INTO course_match_audit (
          run_id,
          course_id,
          old_transcript_line_id,
          new_transcript_line_id,
          old_source,
          new_source,
          action
        )
        VALUES (?, ?, ?, ?, ?, 'manual', 'manual_override')
      `);

      for (const change of actualChanges) {
        saveManualMatch.run(
          runId,
          change.courseId,
          change.newTranscriptLineId
        );

        addAudit.run(
          runId,
          change.courseId,
          change.oldTranscriptLineId,
          change.newTranscriptLineId,
          change.oldSource
        );
      }

      return actualChanges.length;
    })();

    return res.json({ ok: true, saved });
  } catch (error) {
    console.error('Override error:', error);

    const status =
      error.status ||
      (String(error.code || '').includes('SQLITE_CONSTRAINT') ? 409 : 500);

    return res.status(status).json({
      error: error.message || 'Nu am putut salva modificarile manuale.'
    });
  }
});

// Audit pentru modificari manuale si corectii automate ale integritatii.
app.get('/api/runs/:runId/audit', (req, res) => {
  const runId = Number(req.params.runId);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ error: 'runId invalid' });
  }

  const run = db.prepare(`
    SELECT id
    FROM runs
    WHERE id = ?
  `).get(runId);

  if (!run) {
    return res.status(404).json({ error: 'run not found' });
  }

  const auditRows = db.prepare(`
    SELECT
      a.id,
      a.action,
      a.changed_at,
      a.old_source,
      a.new_source,
      c.name AS course_name,
      old_line.name AS old_transcript_name,
      new_line.name AS new_transcript_name
    FROM course_match_audit a
    JOIN courses c ON c.id = a.course_id
    LEFT JOIN transcript_lines old_line
      ON old_line.id = a.old_transcript_line_id
    LEFT JOIN transcript_lines new_line
      ON new_line.id = a.new_transcript_line_id
    WHERE a.run_id = ?
    ORDER BY a.changed_at DESC, a.id DESC
  `).all(runId);

  res.json(auditRows);
});

// EXPORT
app.post('/api/export/:runId', (req, res) => {
  const runId = Number(req.params.runId);

  const run = db.prepare(`
    SELECT
      r.*,
      pt.version AS template_version,
      pt.docx_path,
      p.name AS configured_program_name
    FROM runs r
    JOIN program_templates pt ON pt.id = r.template_id
    JOIN programs p ON p.id = pt.program_id
    WHERE r.id = ?
  `).get(runId);

  if (!run) {
    return res.status(404).json({ error: 'run not found' });
  }

  if (!run.docx_path) {
    return res.status(400).json({
      error: 'Template-ul rularii nu are o cale salvata.',
    });
  }

  const templatePath = resolveTemplateFilePath(run.docx_path);

  if (!templatePath || !fs.existsSync(templatePath)) {
    return res.status(404).json({
      error:
        'Fisierul template al rularii nu mai exista. '
        + 'Verifica folderul uploads/templates sau restaureaza backup-ul.',
    });
  }

  const studentData = getRunStudentData(run);
  const studentDataError = validateRunStudentData(studentData);

  if (studentDataError) {
    return res.status(400).json({ error: studentDataError });
  }

  const rows = db.prepare(`
    SELECT c.id as course_id, c.name as course_name, c.year, c.semester, c.ects,
           m.transcript_line_id,
           tl.name as student_course_name,
           CASE
             WHEN tl.grade_raw IS NOT NULL AND TRIM(tl.grade_raw) <> ''
               THEN tl.grade_raw
             WHEN tl.grade IS NOT NULL
               THEN printf('%g', tl.grade)
             ELSE NULL
           END as student_grade,
           tl.grade as student_grade_numeric,
           tl.grade_raw as student_grade_raw,
           tl.academic_status as student_academic_status,
           tl.ects as student_ects
    FROM courses c
    LEFT JOIN course_matches m ON m.course_id=c.id AND m.run_id=?
    LEFT JOIN transcript_lines tl ON tl.id=m.transcript_line_id
    WHERE c.template_id = ?
    ORDER BY c.year, c.semester, c.id
  `).all(runId, run.template_id);

  const ectsTotals = calculateTargetEctsTotals(rows);

  if (ectsTotals.skipped_courses.length > 0) {
    return res.status(400).json({
      error: 'Totalurile ECTS nu pot fi calculate in siguranta.',
      details: ectsTotals.skipped_courses,
    });
  }

  const studentPart = sanitizeFilenamePart(
    studentData.student_name,
    `Student_${runId}`
  );
  const templatePart = sanitizeFilenamePart(
    run.template_version || run.configured_program_name,
    `Template_${run.template_id}`
  );

  const downloadName = `Echivalare_${studentPart}_${templatePart}.docx`;
  const internalName = `echivalare_run_${runId}_${Date.now()}.docx`;
  const outPath = path.join(upOutputs, internalName);

  const py = spawn(PY, [path.join(__dirname, 'export_docx.py'), outPath]);
  let out = '', err = '';

  py.stdout.on('data', d => out += d.toString());
  py.stderr.on('data', d => err += d.toString());

  py.on('close', code => {
    if (code !== 0) {
      return res.status(500).json({
        error: 'export failed',
        details: err,
      });
    }

    res.download(outPath, downloadName, (downloadError) => {
      fs.unlink(outPath, () => {});

      if (downloadError && !res.headersSent) {
        res.status(500).json({
          error: 'Nu am putut trimite documentul exportat.',
        });
      }
    });
  });

  py.stdin.write(JSON.stringify({
    template_path: templatePath,
    rows,
    student_data: studentData,
    ects_totals: ectsTotals,
  }));
  py.stdin.end();
});

// ---------- ERROR HANDLER ----------
app.use((err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error('API error:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Fișierul depășește limita de 15 MB.',
      });
    }

    return res.status(400).json({
      error: `Upload invalid: ${err.message}`,
    });
  }

  if (
    err?.message?.startsWith('Foaia matricola') ||
    err?.message?.startsWith('Template-ul')
  ) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(500).json({
    error: 'Eroare interna la procesarea cererii.',
  });
});

// ---------- START ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('API on :' + PORT));
