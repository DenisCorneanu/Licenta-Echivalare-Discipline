import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  LockKeyhole,
  LogIn,
  Play,
  Save,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import {
  listFaculties,
  listPrograms,
  listProgramVariants,
  uploadAndMatch,
  fetchRunCourses,
  saveOverrides,
  saveRunStudentData,
  exportDocx,
} from "../api";

const SKIP_UI_REGEX =
  /disciplina echivalata din planul de invatamant|disciplina echivalată din planul de învățământ/i;

const TRANSCRIPT_EXTENSIONS = new Set(["xlsx", "csv"]);
const MAX_UPLOAD_SIZE = 15 * 1024 * 1024; // 15 MB

function splitByYear(rows) {
  const clean = (rows || []).filter(
    (r) => !(r?.course_name && SKIP_UI_REGEX.test(r.course_name))
  );

  const getYear = (r) => r?.year_of_study ?? r?.year ?? null;

  return {
    y1: clean.filter((r) => getYear(r) === 1),
    y2: clean.filter((r) => getYear(r) === 2),
    clean,
  };
}

function groupRowsByTargetYear(rows) {
  const groups = new Map();

  for (const row of rows || []) {
    const rawYear = row?.year ?? row?.year_of_study ?? null;
    const numericYear = Number(rawYear);
    const hasValidYear =
      Number.isInteger(numericYear) && numericYear > 0;
    const key = hasValidYear ? String(numericYear) : "other";

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([key, groupedRows]) => ({
      key,
      year: key === "other" ? null : Number(key),
      rows: groupedRows,
    }))
    .sort((left, right) => {
      if (left.year === null) return 1;
      if (right.year === null) return -1;
      return left.year - right.year;
    });
}

function yearSectionLabel(year) {
  const labels = {
    1: "Anul I",
    2: "Anul II",
    3: "Anul III",
    4: "Anul IV",
    5: "Anul V",
    6: "Anul VI",
  };

  return year === null
    ? "Discipline fara an identificat"
    : labels[year] || `Anul ${year}`;
}

function assignmentsFromRows(rows) {
  return new Map(
    (rows || []).map((row) => [
      row.course_id,
      row.transcript_line_id ?? null,
    ])
  );
}

function getApiErrorMessage(error) {
  const message = error?.message || "A aparut o eroare necunoscuta.";

  try {
    const parsed = JSON.parse(message);
    const baseMessage = parsed?.error || message;
    const details = String(parsed?.details || "").trim();

    return details ? `${baseMessage}: ${details}` : baseMessage;
  } catch {
    return message;
  }
}

function getEffectiveDecisionStatus(row, savedAssignments) {
  const currentSelection = row.transcript_line_id ?? null;
  const savedSelection = savedAssignments.get(row.course_id) ?? null;

  if (currentSelection !== savedSelection) {
    return "unsaved";
  }

  if (row.decision_status === "manual") {
    return currentSelection === null ? "manual_no_match" : "manual";
  }

  if (row.decision_status === "needs_review") {
    return "needs_review";
  }

  if (row.decision_status === "no_match" || currentSelection === null) {
    return "no_match";
  }

  return "auto";
}

function decisionLabel(status) {
  if (status === "manual") return "Manual";
  if (status === "manual_no_match") return "Manual - gol";
  if (status === "needs_review") return "De verificat";
  if (status === "no_match") return "Fara potrivire";
  if (status === "unsaved") return "Nesalvat";
  return "Auto";
}

function decisionTitle(status, row) {
  if (status === "manual") return "Disciplina a fost aleasa manual.";
  if (status === "manual_no_match") {
    return "Operatorul a decis sa lase disciplina neechivalata.";
  }
  if (status === "needs_review") {
    return row.match_reason || "Algoritmul a gasit o sugestie care necesita verificare.";
  }
  if (status === "no_match") {
    return row.match_reason || "Algoritmul nu a gasit o potrivire suficient de buna.";
  }
  if (status === "unsaved") {
    return "Selectia a fost modificata, dar nu a fost salvata.";
  }
  return row.match_reason || "Potrivire realizata automat.";
}

function decisionClass(status) {
  if (status === "manual" || status === "manual_no_match") {
    return "bg-blue-100 text-blue-800";
  }

  if (status === "needs_review") {
    return "bg-amber-200 text-amber-950";
  }

  if (status === "no_match") {
    return "bg-rose-200 text-rose-950";
  }

  if (status === "unsaved") {
    return "bg-sky-100 text-sky-800";
  }

  return "bg-emerald-100 text-emerald-800";
}

function rowDecisionClass(status) {
  if (status === "needs_review") {
    return "bg-amber-100";
  }

  if (status === "no_match" || status === "manual_no_match") {
    return "bg-rose-100";
  }

  if (status === "unsaved") {
    return "bg-sky-50";
  }

  return "bg-white";
}

function displayAcademicResult(line) {
  if (!line) return "-";

  const raw = String(line.grade_raw ?? "").trim();
  if (raw) return raw;

  if (line.grade !== null && line.grade !== undefined) {
    return String(line.grade);
  }

  if (line.grade_numeric !== null && line.grade_numeric !== undefined) {
    return String(line.grade_numeric);
  }

  return "-";
}

function transcriptOptionLabel(line) {
  const result = displayAcademicResult(line);

  if (result === "-") return line.name;
  if (result === "P" || result === "N") return `${line.name} (${result})`;

  return `${line.name} (nota ${result})`;
}

function isPassedTranscriptLine(line) {
  if (!line) return false;

  const status = String(line.academic_status ?? "").trim().toLowerCase();

  if (status === "passed") return true;
  if (status === "failed") return false;

  const raw = String(line.grade_raw ?? "").trim().toUpperCase();

  if (raw === "P") return true;
  if (raw === "N" || raw === "-") return false;

  const numericValue =
    line.grade_numeric !== null && line.grade_numeric !== undefined
      ? Number(line.grade_numeric)
      : line.grade !== null && line.grade !== undefined
        ? Number(line.grade)
        : Number.NaN;

  return Number.isFinite(numericValue) && numericValue >= 5;
}

function guessStudentNameFromFilename(fileName) {
  let value = String(fileName || "").trim();

  value = value.replace(/\.(xlsx|csv)$/i, "");
  value = value.split(/\s+-\s+DID\d+/i)[0];
  value = value.replace(/\.(xlsx?|csv)$/i, "");
  value = value.replace(/(?:[-_ ]+rep)$/i, "");
  value = value.replace(/_/g, " ");
  value = value.replace(/\s+/g, " ").trim();

  return value;
}

function normalizeStudentData(data) {
  return {
    student_name: String(data?.student_name || "").trim(),
  };
}

export default function OperatorPage({ onAdminLogin }) {
  const [faculties, setFaculties] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [variants, setVariants] = useState([]);
  const [facultyId, setFacultyId] = useState("");
  const [programId, setProgramId] = useState("");
  const [variantId, setVariantId] = useState("");

  const [studentName, setStudentName] = useState("");
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);

  const [run, setRun] = useState(null);
  const [savedAssignments, setSavedAssignments] = useState(new Map());
  const [savedStudentData, setSavedStudentData] = useState(
    normalizeStudentData({})
  );
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [unusedListOpen, setUnusedListOpen] = useState(false);

  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState("");
  const adminUsernameRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const facs = await listFaculties();
        setFaculties(facs);
      } catch (error) {
        console.error(error);
        alert("Nu pot incarca lista de facultati.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!adminLoginOpen) {
      return undefined;
    }

    const focusTimer = window.setTimeout(() => {
      adminUsernameRef.current?.focus();
      adminUsernameRef.current?.select();
    }, 0);

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setAdminLoginOpen(false);
        setAdminLoginError("");
        setAdminPassword("");
        setShowAdminPassword(false);
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [adminLoginOpen]);

  const openAdminLogin = () => {
    setAdminUsername("admin");
    setAdminPassword("");
    setShowAdminPassword(false);
    setAdminLoginError("");
    setAdminLoginOpen(true);
  };

  const closeAdminLogin = () => {
    setAdminLoginOpen(false);
    setAdminPassword("");
    setShowAdminPassword(false);
    setAdminLoginError("");
  };

  const submitAdminLogin = (event) => {
    event.preventDefault();
    setAdminLoginError("");

    const loginSucceeded =
      onAdminLogin?.({
        username: adminUsername.trim(),
        password: adminPassword,
      }) === true;

    if (!loginSucceeded) {
      setAdminLoginError("Username sau parola incorecta.");
    }
  };

  const onPickFaculty = async (fid) => {
    setFacultyId(fid);
    setProgramId("");
    setVariantId("");
    setPrograms([]);
    setVariants([]);
    setRun(null);
    setSavedAssignments(new Map());
    setSavedStudentData(normalizeStudentData({}));
    setSaveMessage("");
    setSaveError("");

    if (!fid) return;

    try {
      const progs = await listPrograms(fid);
      setPrograms(progs);
    } catch (error) {
      console.error(error);
      alert("Nu pot incarca specializarile pentru aceasta facultate.");
    }
  };

  const onPickProgram = async (nextProgramId) => {
    setProgramId(nextProgramId);
    setVariantId("");
    setVariants([]);
    setRun(null);
    setSavedAssignments(new Map());
    setSavedStudentData(normalizeStudentData({}));
    setSaveMessage("");
    setSaveError("");

    if (!nextProgramId) return;

    try {
      const nextVariants = await listProgramVariants(nextProgramId);
      setVariants(nextVariants);

      const defaultVariant =
        nextVariants.find(
          (variant) =>
            Boolean(variant.is_active) &&
            Number(variant.active_template_count) > 0
        ) || nextVariants.find((variant) => Boolean(variant.is_active));

      setVariantId(defaultVariant ? String(defaultVariant.id) : "");
    } catch (error) {
      console.error(error);
      alert("Nu pot incarca anii / tipurile pentru acest program.");
    }
  };

  const onPickVariant = (nextVariantId) => {
    setVariantId(nextVariantId);
    setRun(null);
    setSavedAssignments(new Map());
    setSavedStudentData(normalizeStudentData({}));
    setSaveMessage("");
    setSaveError("");
  };

  const onTranscriptFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const extension = selectedFile.name.split(".").pop()?.toLowerCase();

    if (!TRANSCRIPT_EXTENSIONS.has(extension)) {
      alert("Incarca doar fisiere .xlsx sau .csv.");
      event.target.value = "";
      setFile(null);
      return;
    }

    if (selectedFile.size === 0) {
      alert("Fisierul selectat este gol.");
      event.target.value = "";
      setFile(null);
      return;
    }

    if (selectedFile.size > MAX_UPLOAD_SIZE) {
      alert("Fisierul depaseste limita de 15 MB.");
      event.target.value = "";
      setFile(null);
      return;
    }

    const guessedStudentName = guessStudentNameFromFilename(
      selectedFile.name
    );

    setFile(selectedFile);
    setStudentName(guessedStudentName);

    setRun(null);
    setSavedAssignments(new Map());
    setSavedStudentData(normalizeStudentData({}));
    setSaveMessage("");
    setSaveError("");
    setUnusedListOpen(false);
  };

  const onUpload = async () => {
    if (!programId || !variantId) {
      alert("Alege facultatea, programul si anul / tipul de echivalare.");
      return;
    }

    if (!file) {
      alert("Incarca foaia matricola (.xlsx sau .csv).");
      return;
    }

    if (!studentName.trim()) {
      alert("Completeaza numele studentului.");
      return;
    }

    setSaveMessage("");
    setSaveError("");
    setMatching(true);

    try {
      const data = await uploadAndMatch({
        file,
        programId,
        variantId,
        studentName: studentName.trim(),
      });

      const returnedStudentData = normalizeStudentData(data.student_data);

      setRun(data);
      setUnusedListOpen(false);
      setStudentName(returnedStudentData.student_name);
      setSavedStudentData(returnedStudentData);
      setSavedAssignments(assignmentsFromRows(data.rows));
    } catch (error) {
      console.error(error);
      setRun(null);
      setSavedAssignments(new Map());
      alert(`Eroare la matching: ${getApiErrorMessage(error)}`);
    } finally {
      setMatching(false);
    }
  };

  const refresh = async () => {
    if (!run) return;

    const data = await fetchRunCourses(run.run_id);

    const returnedStudentData = normalizeStudentData(data.student_data);

    setRun((currentRun) => ({
      ...currentRun,
      ...data,
    }));

    setStudentName(returnedStudentData.student_name);
    setSavedStudentData(returnedStudentData);
    setSavedAssignments(assignmentsFromRows(data.rows));
  };

  const isLineUsedByOtherCourse = (courseId, transcriptLineId) => {
    if (!run || transcriptLineId === null || transcriptLineId === undefined) {
      return false;
    }

    return run.rows.some(
      (row) =>
        row.course_id !== courseId &&
        Number(row.transcript_line_id) === Number(transcriptLineId)
    );
  };

  const onChangeLine = (courseId, transcriptLineId) => {
    setSaveMessage("");
    setSaveError("");

    if (
      transcriptLineId !== null &&
      isLineUsedByOtherCourse(courseId, transcriptLineId)
    ) {
      setSaveError(
        "Aceeasi disciplina din foaia matricola este deja folosita pentru alt curs."
      );
      return;
    }

    setRun((currentRun) => ({
      ...currentRun,
      rows: currentRun.rows.map((row) =>
        row.course_id === courseId
          ? {
              ...row,
              transcript_line_id: transcriptLineId,
              grade:
                currentRun.transcript_lines.find(
                  (line) => Number(line.id) === Number(transcriptLineId)
                )?.grade ?? null,
              grade_raw:
                currentRun.transcript_lines.find(
                  (line) => Number(line.id) === Number(transcriptLineId)
                )?.grade_raw ?? null,
              academic_status:
                currentRun.transcript_lines.find(
                  (line) => Number(line.id) === Number(transcriptLineId)
                )?.academic_status ?? "unknown",
            }
          : row
      ),
    }));
  };

  const currentStudentData = normalizeStudentData({
    student_name: studentName,
  });

  const hasUnsavedStudentData =
    Boolean(run) &&
    currentStudentData.student_name !== savedStudentData.student_name;

  const changedItems = !run
    ? []
    : run.rows
        .filter(
          (row) =>
            (row.transcript_line_id ?? null) !==
            (savedAssignments.get(row.course_id) ?? null)
        )
        .map((row) => ({
          course_id: row.course_id,
          transcript_line_id: row.transcript_line_id ?? null,
        }));

  const hasUnsavedAssignmentChanges = changedItems.length > 0;

  const hasUnsavedChanges =
    hasUnsavedAssignmentChanges || hasUnsavedStudentData;

  const onSave = async () => {
    if (!run) return;

    setSaveMessage("");
    setSaveError("");

    if (!currentStudentData.student_name) {
      setSaveError("Completeaza numele studentului.");
      return;
    }

    if (changedItems.length === 0 && !hasUnsavedStudentData) {
      setSaveMessage("Nu exista modificari noi de salvat.");
      return;
    }

    setSaving(true);

    try {
      let savedOverridesCount = 0;

      if (changedItems.length > 0) {
        const response = await saveOverrides(run.run_id, changedItems);
        savedOverridesCount = response.saved || 0;
      }

      if (hasUnsavedStudentData) {
        await saveRunStudentData(run.run_id, currentStudentData);
      }

      await refresh();

      const messages = [];

      if (savedOverridesCount > 0) {
        messages.push(
          savedOverridesCount === 1
            ? "A fost salvata 1 modificare manuala."
            : `Au fost salvate ${savedOverridesCount} modificari manuale.`
        );
      }

      if (hasUnsavedStudentData) {
        messages.push("Datele studentului au fost salvate.");
      }

      setSaveMessage(messages.join(" "));
    } catch (error) {
      console.error(error);
      setSaveError(getApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const onExport = async () => {
    if (!run) return;

    setSaveMessage("");
    setSaveError("");

    if (!currentStudentData.student_name) {
      setSaveError("Completeaza numele studentului inainte de export.");
      return;
    }

    if (hasUnsavedAssignmentChanges) {
      setSaveError("Salveaza modificarile din tabel inainte de export.");
      return;
    }

    setExporting(true);

    try {
      if (hasUnsavedStudentData) {
        await saveRunStudentData(run.run_id, currentStudentData);
        setSavedStudentData(currentStudentData);
      }

      await exportDocx(run.run_id);
    } catch (error) {
      console.error(error);
      setSaveError(`Export esuat: ${getApiErrorMessage(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const rowsAll = run?.rows || [];
  const { clean } = splitByYear(rowsAll);
  const yearSections = groupRowsByTargetYear(clean);
  const matched = clean.filter((row) => row.transcript_line_id != null).length;
  const total = clean.length;
  const usedTranscriptLineIds = new Set(
    clean
      .map((row) => row.transcript_line_id)
      .filter((lineId) => lineId !== null && lineId !== undefined)
      .map((lineId) => Number(lineId))
  );

  const unusedPassedTranscriptLines = (run?.transcript_lines || []).filter(
    (line) =>
      isPassedTranscriptLine(line) &&
      !usedTranscriptLineIds.has(Number(line.id))
  );

  const selectedFaculty = faculties.find(
    (faculty) => String(faculty.id) === String(facultyId)
  );
  const selectedProgram = programs.find(
    (program) => String(program.id) === String(programId)
  );
  const selectedVariant = variants.find(
    (variant) => String(variant.id) === String(variantId)
  );

  const progressPercent =
    total > 0 ? Math.round((matched / total) * 100) : 0;

  const canRun =
    Boolean(facultyId) &&
    Boolean(programId) &&
    Boolean(variantId) &&
    Boolean(file) &&
    Boolean(studentName.trim()) &&
    !matching;

  const statusSummary = clean.reduce(
    (summary, row) => {
      const effectiveStatus = getEffectiveDecisionStatus(
        row,
        savedAssignments
      );

      if (effectiveStatus === "needs_review") {
        summary.review += 1;
      } else if (
        effectiveStatus === "no_match" ||
        effectiveStatus === "manual_no_match" ||
        (
          effectiveStatus === "unsaved" &&
          (
            row.transcript_line_id === null ||
            row.transcript_line_id === undefined
          )
        )
      ) {
        summary.noMatch += 1;
      } else if (
        effectiveStatus === "manual" ||
        effectiveStatus === "unsaved"
      ) {
        summary.manual += 1;
      } else {
        summary.auto += 1;
      }

      if (effectiveStatus === "unsaved") {
        summary.unsaved += 1;
      }

      return summary;
    },
    {
      auto: 0,
      review: 0,
      noMatch: 0,
      manual: 0,
      unsaved: 0,
    }
  );

  const summaryCards = [
    {
      key: "auto",
      label: "Auto",
      value: statusSummary.auto,
      description: "Potriviri acceptate automat",
      icon: CheckCircle2,
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-800",
      iconClassName: "bg-emerald-100 text-emerald-700",
    },
    {
      key: "review",
      label: "De verificat",
      value: statusSummary.review,
      description: "Sugestii care cer confirmare",
      icon: AlertTriangle,
      className: "border-amber-200 bg-amber-50 text-amber-900",
      iconClassName: "bg-amber-100 text-amber-700",
    },
    {
      key: "noMatch",
      label: "Fara potrivire",
      value: statusSummary.noMatch,
      description: "Randuri fara selectie curenta",
      icon: CircleX,
      className: "border-rose-200 bg-rose-50 text-rose-900",
      iconClassName: "bg-rose-100 text-rose-700",
    },
    {
      key: "manual",
      label: "Manual",
      value: statusSummary.manual,
      description:
        statusSummary.unsaved > 0
          ? `${statusSummary.unsaved} modificari nesalvate`
          : "Selectii confirmate de Operator",
      icon: UserRound,
      className: "border-sky-200 bg-sky-50 text-sky-900",
      iconClassName: "bg-sky-100 text-sky-700",
    },
  ];

  const renderTableFor = (rows, showYearCol = true) => (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1120px] table-fixed text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {showYearCol ? (
              <th className="sticky top-0 z-20 w-16 border-b border-slate-200 bg-slate-100 px-3 py-3 text-left">
                An
              </th>
            ) : null}
            <th className="sticky top-0 z-20 w-16 border-b border-slate-200 bg-slate-100 px-3 py-3 text-left">
              Sem
            </th>
            <th className="sticky top-0 z-20 w-[32%] border-b border-slate-200 bg-slate-100 px-4 py-3 text-left">
              Disciplina din programa
            </th>
            <th className="sticky top-0 z-20 w-20 border-b border-slate-200 bg-slate-100 px-3 py-3 text-center">
              ECTS
            </th>
            <th className="sticky top-0 z-20 w-[38%] border-b border-slate-200 bg-slate-100 px-4 py-3 text-left">
              Disciplina din foaia studentului
            </th>
            <th className="sticky top-0 z-20 w-20 border-b border-slate-200 bg-slate-100 px-3 py-3 text-center">
              Nota
            </th>
            <th className="sticky top-0 z-20 w-36 border-b border-slate-200 bg-slate-100 px-3 py-3 text-left">
              Stare
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const selected = run.transcript_lines.find(
              (line) =>
                Number(line.id) === Number(row.transcript_line_id)
            );

            const suggested = run.transcript_lines.find(
              (line) =>
                Number(line.id) ===
                Number(row.suggested_transcript_line_id)
            );

            const effectiveStatus = getEffectiveDecisionStatus(
              row,
              savedAssignments
            );

            return (
              <tr
                key={row.course_id}
                className={`border-t border-slate-200 align-top transition-colors ${rowDecisionClass(
                  effectiveStatus
                )}`}
              >
                {showYearCol ? (
                  <td className="px-3 py-3 text-slate-600">
                    {row.year ?? row.year_of_study ?? ""}
                  </td>
                ) : null}

                <td className="px-3 py-3 text-slate-600">
                  {row.semester ?? ""}
                </td>

                <td className="px-4 py-3">
                  <div className="font-semibold leading-6 text-slate-950">
                    {row.course_name}
                  </div>
                </td>

                <td className="px-3 py-3 text-center font-semibold text-slate-700">
                  {row.ects ?? ""}
                </td>

                <td className="px-4 py-3">
                  <select
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={row.transcript_line_id ?? ""}
                    onChange={(event) =>
                      onChangeLine(
                        row.course_id,
                        event.target.value
                          ? Number(event.target.value)
                          : null
                      )
                    }
                  >
                    <option value="">- (neechivalat)</option>

                    {run.transcript_lines.map((line) => {
                      const usedByOtherCourse =
                        isLineUsedByOtherCourse(
                          row.course_id,
                          line.id
                        );

                      return (
                        <option
                          key={line.id}
                          value={line.id}
                          disabled={usedByOtherCourse}
                          style={{
                            color: usedByOtherCourse
                              ? "#94a3b8"
                              : undefined,
                          }}
                        >
                          {transcriptOptionLabel(line)}
                        </option>
                      );
                    })}
                  </select>

                  {effectiveStatus === "needs_review" &&
                  suggested ? (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-950 ring-1 ring-amber-200">
                      Sugestie: {transcriptOptionLabel(suggested)}
                    </div>
                  ) : null}
                </td>

                <td className="px-3 py-3 text-center font-semibold text-slate-800">
                  {displayAcademicResult(selected)}
                </td>

                <td className="px-3 py-3">
                  <span
                    title={decisionTitle(effectiveStatus, row)}
                    className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold ${decisionClass(
                      effectiveStatus
                    )}`}
                  >
                    {decisionLabel(effectiveStatus)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-6">
        <header className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-xl">
          <div className="flex flex-col gap-6 px-6 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:py-9">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-100">
                <BookOpenCheck size={14} />
                Echivalare academica
              </div>

              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
                Echivalare discipline
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Selecteaza programul, incarca foaia matricola si verifica
                rezultatele generate automat. Selectiile manuale raman
                disponibile direct in tabel.
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-5 lg:min-w-[250px] lg:self-start">
              <button
                type="button"
                onClick={openAdminLogin}
                className="inline-flex items-center justify-center gap-2 rounded-full px-1 py-1 text-xs font-semibold text-slate-300 transition hover:text-white focus:outline-none focus:ring-4 focus:ring-white/10"
              >
                <LogIn size={15} />
                Login as Admin
              </button>

              <div className="w-full max-w-[260px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                <div className="font-semibold text-white">
                  {selectedFaculty?.name || "Nicio facultate selectata"}
                </div>
                <div className="mt-1 leading-6">
                  {selectedProgram?.name || "Alege programul academic"}
                  {selectedVariant?.code
                    ? ` / ${selectedVariant.code}`
                    : ""}
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                  <GraduationCap size={22} />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">
                    Configurare echivalare
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Completeaza contextul academic si selecteaza documentul
                    studentului.
                  </p>
                </div>
              </div>
            </div>

            {file ? (
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                Fisier pregatit pentru procesare
              </div>
            ) : null}
          </div>

          <div className="space-y-5 p-5 sm:p-7">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Building2 size={16} className="text-indigo-600" />
                  Facultate
                </span>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={facultyId}
                  onChange={(event) => onPickFaculty(event.target.value)}
                >
                  <option value="">Alege facultatea</option>

                  {faculties.map((faculty) => (
                    <option key={faculty.id} value={faculty.id}>
                      {faculty.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <GraduationCap size={16} className="text-indigo-600" />
                  Program academic
                </span>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={programId}
                  onChange={(event) => onPickProgram(event.target.value)}
                  disabled={!facultyId || programs.length === 0}
                >
                  <option value="">Alege programul</option>

                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <BookOpenCheck size={16} className="text-indigo-600" />
                  An / tip echivalare
                </span>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={variantId}
                  onChange={(event) => onPickVariant(event.target.value)}
                  disabled={!programId || variants.length === 0}
                >
                  <option value="">Alege anul / tipul</option>

                  {variants.map((variant) => {
                    const hasActiveTemplate =
                      Number(variant.active_template_count) > 0;

                    return (
                      <option
                        key={variant.id}
                        value={variant.id}
                        disabled={!hasActiveTemplate}
                      >
                        {variant.code}
                        {variant.name && variant.name !== variant.code
                          ? ` - ${variant.name}`
                          : ""}
                        {!hasActiveTemplate
                          ? " (fara template activ)"
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <UserRound size={16} className="text-indigo-600" />
                  Nume student/a
                  <span className="text-red-600">*</span>
                </span>
                <input
                  className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                  placeholder="Ex: Popescu Andrei"
                  required
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40">
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={onTranscriptFileChange}
                />

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200">
                    <FileSpreadsheet size={24} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900">
                      Foaie matricola
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-500">
                      {file
                        ? file.name
                        : "Selecteaza un fisier .xlsx sau .csv, maximum 15 MB."}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <Upload size={17} />
                    {file ? "Schimba fisierul" : "Alege fisierul"}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onUpload}
                disabled={!canRun}
                className="inline-flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-indigo-600 px-7 py-4 font-semibold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {matching ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <Play size={20} />
                )}
                {matching ? "Se proceseaza..." : "Ruleaza echivalarea"}
              </button>
            </div>

            {!canRun && !matching ? (
              <p className="text-xs text-slate-500">
                Butonul devine activ dupa selectarea facultatii, programului,
                anului, fisierului si completarea numelui.
              </p>
            ) : null}
          </div>
        </section>

        {!run ? (
          <section className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-500">
              <BookOpenCheck size={30} />
            </span>
            <h2 className="mt-5 text-xl font-semibold">
              Nicio echivalare rulata
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Selecteaza contextul academic si incarca foaia matricola.
              Rezultatele vor aparea aici, iar fiecare rand va pastra
              dropdown-ul pentru selectarea manuala a disciplinelor
              disponibile.
            </p>
          </section>
        ) : (
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <CheckCircle2 size={22} />
                    </span>
                    <div>
                      <h2 className="text-xl font-semibold">
                        Progres echivalare
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Bara se actualizeaza imediat cand modifici selectiile
                        din dropdown-uri.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex items-end justify-between gap-4">
                    <div>
                      <span className="text-3xl font-bold text-slate-950">
                        {matched}
                      </span>
                      <span className="ml-1 text-lg text-slate-500">
                        / {total}
                      </span>
                      <span className="ml-3 text-sm font-semibold text-indigo-700">
                        {progressPercent}%
                      </span>
                    </div>

                    {hasUnsavedChanges ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900">
                        Modificari nesalvate
                        {changedItems.length > 0
                          ? `: ${changedItems.length} selectii`
                          : ""}
                        {hasUnsavedStudentData
                          ? " + date student"
                          : ""}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                        Date sincronizate
                      </span>
                    )}
                  </div>

                  <div
                    className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"
                    role="progressbar"
                    aria-label="Progres echivalare"
                    aria-valuemin={0}
                    aria-valuemax={total || 0}
                    aria-valuenow={matched}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-[width] duration-500 ease-out"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || !hasUnsavedChanges}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saving ? (
                      <Loader2 className="animate-spin" size={17} />
                    ) : (
                      <Save size={17} />
                    )}
                    {saving
                      ? "Se salveaza..."
                      : "Salveaza modificarile"}
                  </button>

                  <button
                    type="button"
                    onClick={onExport}
                    disabled={
                      saving ||
                      exporting ||
                      hasUnsavedAssignmentChanges ||
                      !currentStudentData.student_name
                    }
                    title={
                      !currentStudentData.student_name
                        ? "Completeaza numele studentului."
                        : hasUnsavedAssignmentChanges
                          ? "Salveaza modificarile din tabel inainte de export."
                          : "Exporta documentul DOCX."
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {exporting ? (
                      <Loader2 className="animate-spin" size={17} />
                    ) : (
                      <Download size={17} />
                    )}
                    {exporting ? "Se exporta..." : "Exporta DOCX"}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => {
                const Icon = card.icon;

                return (
                  <article
                    key={card.key}
                    className={`rounded-2xl border p-4 shadow-sm ${card.className}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${card.iconClassName}`}
                      >
                        <Icon size={21} />
                      </span>

                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold">
                            {card.value}
                          </span>
                          <span className="text-sm font-semibold">
                            {card.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 opacity-80">
                          {card.description}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            {hasUnsavedAssignmentChanges ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                Salveaza modificarile din tabel pentru a activa exportul.
              </div>
            ) : null}

            {saveMessage ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {saveMessage}
              </div>
            ) : null}

            {saveError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                {saveError}
              </div>
            ) : null}

            {unusedPassedTranscriptLines.length > 0 ? (
              <section
                id="materii-promovate-neutilizate"
                className="overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-4 bg-sky-50 px-5 py-4 text-left transition hover:bg-sky-100 sm:px-6"
                  aria-expanded={unusedListOpen}
                  aria-controls="unused-passed-list"
                  onClick={() =>
                    setUnusedListOpen((current) => !current)
                  }
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-700 shadow-sm transition-transform ${
                      unusedListOpen ? "rotate-180" : ""
                    }`}
                  >
                    <ChevronDown size={20} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-sky-950">
                        Materii promovate neutilizate
                      </h2>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-sky-800 ring-1 ring-sky-200">
                        {unusedPassedTranscriptLines.length}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-sky-800">
                      Lista se actualizeaza automat cand modifici
                      selectiile din tabele.
                    </p>
                  </div>

                  <span className="hidden text-xs font-semibold text-sky-800 sm:block">
                    {unusedListOpen ? "Restrange" : "Vezi lista"}
                  </span>
                </button>

                {unusedListOpen ? (
                  <div
                    id="unused-passed-list"
                    className="border-t border-sky-200 p-4 sm:p-5"
                  >
                    <div className="overflow-x-auto rounded-2xl border border-slate-200">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          <tr>
                            <th className="px-4 py-3 text-left">
                              Disciplina
                            </th>
                            <th className="px-4 py-3 text-left">
                              An
                            </th>
                            <th className="px-4 py-3 text-left">
                              Rezultat
                            </th>
                            <th className="px-4 py-3 text-left">
                              ECTS
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {unusedPassedTranscriptLines.map((line) => (
                            <tr
                              key={line.id}
                              className="border-t border-slate-200 bg-white"
                            >
                              <td className="px-4 py-3 font-medium text-slate-900">
                                {line.name}
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                {line.year_of_study ?? ""}
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-800">
                                {displayAcademicResult(line)}
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                {line.ects ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-5 sm:px-7">
                <h2 className="text-xl font-semibold">
                  Rezultatele echivalarii
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Disciplinele sunt delimitate vizual dupa anul din planul
                  tinta. Toate sectiunile raman afisate, iar dropdown-ul
                  fiecarui rand functioneaza exact ca pana acum.
                </p>
              </div>

              <div className="space-y-5 p-4 sm:p-5">
                {yearSections.map((section) => {
                  const sectionMatched = section.rows.filter(
                    (row) => row.transcript_line_id != null
                  ).length;
                  const sectionPercent =
                    section.rows.length > 0
                      ? Math.round(
                          (sectionMatched / section.rows.length) * 100
                        )
                      : 0;

                  return (
                    <section
                      key={section.key}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                    >
                      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-950">
                              {yearSectionLabel(section.year)}
                            </h3>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                              {section.rows.length} discipline
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {sectionMatched} din {section.rows.length} au o
                            disciplina selectata
                          </p>
                        </div>

                        <div className="flex min-w-44 items-center gap-3">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-[width] duration-500"
                              style={{ width: `${sectionPercent}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-semibold text-slate-600">
                            {sectionPercent}%
                          </span>
                        </div>
                      </div>

                      <div className="p-3 sm:p-4">
                        {renderTableFor(section.rows, false)}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>

          </div>
        )}
      </div>

      {adminLoginOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-login-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeAdminLogin();
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                  <LockKeyhole size={21} />
                </span>
                <div>
                  <h2
                    id="admin-login-title"
                    className="text-lg font-semibold text-slate-950"
                  >
                    Login as Admin
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Acceseaza pagina folosita pentru configurarea
                    facultatilor, template-urilor si regulilor.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeAdminLogin}
                className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Inchide autentificarea"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitAdminLogin}>
              <div className="space-y-4 px-6 py-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Username
                  </span>
                  <input
                    ref={adminUsernameRef}
                    value={adminUsername}
                    onChange={(event) => {
                      setAdminUsername(event.target.value);
                      setAdminLoginError("");
                    }}
                    autoComplete="username"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder="Username"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Parola
                  </span>

                  <div className="relative">
                    <input
                      type={showAdminPassword ? "text" : "password"}
                      value={adminPassword}
                      onChange={(event) => {
                        setAdminPassword(event.target.value);
                        setAdminLoginError("");
                      }}
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-3 pr-12 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      placeholder="Parola"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowAdminPassword((current) => !current)
                      }
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 transition hover:text-slate-900"
                      aria-label={
                        showAdminPassword
                          ? "Ascunde parola"
                          : "Afiseaza parola"
                      }
                    >
                      {showAdminPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </label>

                {adminLoginError ? (
                  <div
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
                    role="alert"
                  >
                    {adminLoginError}
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <button
                  type="button"
                  onClick={closeAdminLogin}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Renunta
                </button>

                <button
                  type="submit"
                  disabled={
                    !adminUsername.trim() || !adminPassword
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <LogIn size={17} />
                  Autentificare
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
