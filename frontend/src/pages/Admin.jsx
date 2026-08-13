import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  DatabaseBackup,
  Download,
  FileText,
  GraduationCap,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  activateTemplate,
  createFaculty,
  createProgram,
  createProgramVariant,
  deleteAdminEntity,
  downloadFacultyData,
  getAdminDeletePreview,
  downloadTemplate,
  listFaculties,
  listPrograms,
  listProgramVariants,
  listTemplates,
  renameTemplate,
  setProgramActive,
  setProgramVariantActive,
  updateFaculty,
  updateProgram,
  updateProgramVariant,
  uploadTemplate,
} from "../api";
import MatchingConfigurationPanel from "../components/admin/MatchingConfiguration";

function getErrorMessage(error) {
  return error?.message || "A aparut o eroare necunoscuta.";
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function Modal({ title, description, children, onClose, footer }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            aria-label="Inchide"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusMessage({ type, children, onClose }) {
  const isError = type === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl ${
        isError
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {isError ? (
        <XCircle className="mt-0.5 shrink-0" size={18} />
      ) : (
        <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
      )}

      <div className="min-w-0 flex-1 leading-6">{children}</div>

      <button
        type="button"
        className="rounded p-1 opacity-70 transition hover:bg-white/60 hover:opacity-100"
        onClick={onClose}
        aria-label="Inchide mesajul"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function SectionHeader({ icon, title, description, action }) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700">
          {createElement(icon, { size: 20 })}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {action}
    </div>
  );
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <div className="rounded-2xl bg-white p-3 text-slate-400 shadow-sm">
        {createElement(icon, { size: 24 })}
      </div>
      <h3 className="mt-4 font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function Badge({ tone = "slate", children }) {
  const tones = {
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    indigo: "bg-indigo-100 text-indigo-800",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function DeleteSummary({ preview }) {
  const countItems = [
    ["Programe", preview.counts.program_count],
    ["Ani / tipuri", preview.counts.variant_count],
    ["Template-uri", preview.counts.template_count],
    ["Discipline parsate", preview.counts.course_count],
    ["Reguli legate de discipline", preview.counts.rule_count],
    ["Rulari studenti", preview.counts.run_count],
    ["Linii foi matricole", preview.counts.transcript_line_count],
    ["Potriviri", preview.counts.match_count],
    ["Inregistrari audit", preview.counts.audit_count],
    ["Aliasuri program", preview.counts.matching_alias_count],
    ["Familii", preview.counts.matching_family_count],
    ["Denumiri familii", preview.counts.matching_family_term_count],
    ["Reguli directe program", preview.counts.matching_direct_rule_count],
    ["Fisiere disponibile", preview.counts.backup_file_count],
  ].filter(([, value]) => Number(value) > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3 text-sm leading-6 text-red-800">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div>
            <div className="font-semibold">
              Stergerea elimina definitiv elementul si toate datele sale.
            </div>
            <div className="mt-1">
              Poti descarca mai intai un backup ZIP sau poti continua fara
              backup.
            </div>
          </div>
        </div>
      </div>

      {preview.contains_personal_data ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Backup-ul contine date personale: nume de studenti, foi matricole si
          rezultate de matching. Pastreaza fisierul intr-un loc sigur.
        </div>
      ) : null}

      {countItems.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {countItems.map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <div className="text-lg font-bold text-slate-950">{value}</div>
              <div className="mt-0.5 text-xs leading-5 text-slate-500">
                {label}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Elementul nu are date dependente salvate.
        </div>
      )}

      {preview.external_files_will_be_preserved > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          {preview.external_files_will_be_preserved} fisiere indica o locatie
          externa proiectului actual. Vor fi incluse in backup daca exista,
          dar nu vor fi sterse fizic de pe disc.
        </div>
      ) : null}

      {preview.missing_files > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {preview.missing_files} fisiere nu mai exista la calea salvata. Datele
          din baza vor fi incluse, dar fisierele lipsa nu pot intra in backup.
        </div>
      ) : null}
    </div>
  );
}

export default function AdminPage({ onLogout }) {
  const [faculties, setFaculties] = useState([]);
  const [facultyId, setFacultyId] = useState("");
  const [facultyName, setFacultyName] = useState("");

  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState("");
  const [programName, setProgramName] = useState("");

  const [variants, setVariants] = useState([]);
  const [variantId, setVariantId] = useState("");
  const [variantCode, setVariantCode] = useState("");

  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [templateFile, setTemplateFile] = useState(null);
  const templateFileRef = useRef(null);

  const [loadingPage, setLoadingPage] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editor, setEditor] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [openTemplateMenuId, setOpenTemplateMenuId] = useState(null);
  const [templateMenuPosition, setTemplateMenuPosition] = useState(null);
  const openTemplateMenuRef = useRef(null);

  const selectedFaculty = useMemo(
    () => faculties.find((faculty) => String(faculty.id) === String(facultyId)),
    [faculties, facultyId]
  );

  const selectedProgram = useMemo(
    () => programs.find((program) => String(program.id) === String(programId)),
    [programs, programId]
  );

  const selectedVariant = useMemo(
    () => variants.find((variant) => String(variant.id) === String(variantId)),
    [variants, variantId]
  );

  const activeTemplate = useMemo(
    () => templates.find((template) => Boolean(template.is_active)),
    [templates]
  );

  useEffect(() => {
    if (openTemplateMenuId === null) return undefined;

    const closeTemplateMenu = () => {
      setOpenTemplateMenuId(null);
      setTemplateMenuPosition(null);
    };

    const handlePointerDown = (event) => {
      if (
        openTemplateMenuRef.current &&
        !openTemplateMenuRef.current.contains(event.target)
      ) {
        closeTemplateMenu();
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeTemplateMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeTemplateMenu);
    window.addEventListener("scroll", closeTemplateMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeTemplateMenu);
      window.removeEventListener("scroll", closeTemplateMenu, true);
    };
  }, [openTemplateMenuId]);

  useEffect(() => {
    if (!successMessage) return undefined;

    const timeoutId = window.setTimeout(
      () => setSuccessMessage(""),
      4500
    );

    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  useEffect(() => {
    if (!errorMessage) return undefined;

    const timeoutId = window.setTimeout(
      () => setErrorMessage(""),
      8000
    );

    return () => window.clearTimeout(timeoutId);
  }, [errorMessage]);

  const toggleTemplateMenu = (templateId, buttonElement) => {
    if (openTemplateMenuId === templateId) {
      setOpenTemplateMenuId(null);
      setTemplateMenuPosition(null);
      return;
    }

    const buttonRect = buttonElement.getBoundingClientRect();
    const menuWidth = 192;
    const estimatedMenuHeight = 112;
    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const hasSpaceAbove = buttonRect.top > estimatedMenuHeight + 24;
    const openUp =
      spaceBelow < estimatedMenuHeight + 24 && hasSpaceAbove;
    const left = Math.min(
      Math.max(12, buttonRect.right - menuWidth),
      window.innerWidth - menuWidth - 12
    );

    setTemplateMenuPosition({
      top: openUp ? buttonRect.top - 8 : buttonRect.bottom + 8,
      left,
      openUp,
    });
    setOpenTemplateMenuId(templateId);
  };

  const clearMessages = () => {
    setSuccessMessage("");
    setErrorMessage("");
  };

  const runAction = async (key, action, successText = "") => {
    clearMessages();
    setBusyAction(key);

    try {
      const result = await action();
      if (successText) setSuccessMessage(successText);
      return result;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return null;
    } finally {
      setBusyAction("");
    }
  };

  const fetchTemplatesForVariant = async (nextVariantId) => {
    setOpenTemplateMenuId(null);

    if (!nextVariantId) {
      setTemplates([]);
      return [];
    }

    const nextTemplates = await listTemplates({
      variantId: nextVariantId,
    });
    setTemplates(nextTemplates);
    return nextTemplates;
  };

  const fetchVariantsForProgram = async (
    nextProgramId,
    preferredVariantId = ""
  ) => {
    if (!nextProgramId) {
      setVariants([]);
      setVariantId("");
      setTemplates([]);
      return [];
    }

    const nextVariants = await listProgramVariants(nextProgramId, {
      includeInactive: true,
    });

    setVariants(nextVariants);

    const preferred = nextVariants.find(
      (variant) => String(variant.id) === String(preferredVariantId)
    );
    const defaultVariant =
      preferred ||
      nextVariants.find(
        (variant) =>
          Boolean(variant.is_active) &&
          Number(variant.active_template_count) > 0
      ) ||
      nextVariants.find((variant) => Boolean(variant.is_active)) ||
      nextVariants[0];

    const nextVariantId = defaultVariant ? String(defaultVariant.id) : "";
    setVariantId(nextVariantId);
    await fetchTemplatesForVariant(nextVariantId);

    return nextVariants;
  };

  const selectVariant = async (nextVariantId) => {
    setOpenTemplateMenuId(null);
    const value = String(nextVariantId || "");
    setVariantId(value);
    setTemplates([]);

    if (value) {
      await runAction(
        `load-variant-${value}`,
        () => fetchTemplatesForVariant(value)
      );
    }
  };

  const selectProgram = async (nextProgramId, preferredVariantId = "") => {
    setOpenTemplateMenuId(null);
    const value = String(nextProgramId || "");
    setProgramId(value);
    setVariants([]);
    setVariantId("");
    setTemplates([]);

    if (value) {
      await runAction(
        `load-program-${value}`,
        () => fetchVariantsForProgram(value, preferredVariantId)
      );
    }
  };

  const fetchProgramsForFaculty = async (
    nextFacultyId,
    preferredProgramId = "",
    preferredVariantId = ""
  ) => {
    if (!nextFacultyId) {
      setPrograms([]);
      setProgramId("");
      setVariants([]);
      setVariantId("");
      setTemplates([]);
      return [];
    }

    const nextPrograms = await listPrograms(nextFacultyId, {
      includeInactive: true,
    });

    setPrograms(nextPrograms);

    const preferred = nextPrograms.find(
      (program) => String(program.id) === String(preferredProgramId)
    );
    const defaultProgram =
      preferred ||
      nextPrograms.find((program) => Boolean(program.is_active)) ||
      nextPrograms[0];

    const nextProgramId = defaultProgram ? String(defaultProgram.id) : "";
    setProgramId(nextProgramId);
    await fetchVariantsForProgram(nextProgramId, preferredVariantId);

    return nextPrograms;
  };

  const selectFaculty = async (
    nextFacultyId,
    preferredProgramId = "",
    preferredVariantId = ""
  ) => {
    setOpenTemplateMenuId(null);
    const value = String(nextFacultyId || "");
    setFacultyId(value);
    setPrograms([]);
    setProgramId("");
    setVariants([]);
    setVariantId("");
    setTemplates([]);

    if (value) {
      await runAction(
        `load-faculty-${value}`,
        () =>
          fetchProgramsForFaculty(
            value,
            preferredProgramId,
            preferredVariantId
          )
      );
    }
  };

  const reloadFaculties = async (
    preferredFacultyId = facultyId,
    preferredProgramId = programId,
    preferredVariantId = variantId
  ) => {
    const nextFaculties = await listFaculties();
    setFaculties(nextFaculties);

    const preferred = nextFaculties.find(
      (faculty) => String(faculty.id) === String(preferredFacultyId)
    );
    const defaultFaculty = preferred || nextFaculties[0];
    const nextFacultyId = defaultFaculty ? String(defaultFaculty.id) : "";

    setFacultyId(nextFacultyId);
    await fetchProgramsForFaculty(
      nextFacultyId,
      preferredProgramId,
      preferredVariantId
    );
  };

  useEffect(() => {
    let cancelled = false;

    const loadInitialData = async () => {
      setLoadingPage(true);

      try {
        const nextFaculties = await listFaculties();

        if (cancelled) return;

        setFaculties(nextFaculties);

        const firstFacultyId = nextFaculties[0]
          ? String(nextFaculties[0].id)
          : "";

        setFacultyId(firstFacultyId);

        if (firstFacultyId) {
          const nextPrograms = await listPrograms(firstFacultyId, {
            includeInactive: true,
          });

          if (cancelled) return;

          setPrograms(nextPrograms);

          const defaultProgram =
            nextPrograms.find((program) => Boolean(program.is_active)) ||
            nextPrograms[0];
          const firstProgramId = defaultProgram
            ? String(defaultProgram.id)
            : "";

          setProgramId(firstProgramId);

          if (firstProgramId) {
            const nextVariants = await listProgramVariants(firstProgramId, {
              includeInactive: true,
            });

            if (cancelled) return;

            setVariants(nextVariants);

            const defaultVariant =
              nextVariants.find(
                (variant) =>
                  Boolean(variant.is_active) &&
                  Number(variant.active_template_count) > 0
              ) ||
              nextVariants.find((variant) => Boolean(variant.is_active)) ||
              nextVariants[0];
            const firstVariantId = defaultVariant
              ? String(defaultVariant.id)
              : "";

            setVariantId(firstVariantId);

            if (firstVariantId) {
              const nextTemplates = await listTemplates({
                variantId: firstVariantId,
              });
              if (!cancelled) setTemplates(nextTemplates);
            }
          }
        }
      } catch (error) {
        if (!cancelled) setErrorMessage(getErrorMessage(error));
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    };

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateFaculty = async (event) => {
    event.preventDefault();
    const cleanName = facultyName.trim();
    if (!cleanName) return;

    const created = await runAction(
      "create-faculty",
      () => createFaculty(cleanName),
      "Facultatea a fost adaugata."
    );

    if (!created) return;

    setFacultyName("");
    await reloadFaculties(created.id, "", "");
  };

  const handleCreateProgram = async (event) => {
    event.preventDefault();
    const cleanName = programName.trim();
    if (!facultyId || !cleanName) return;

    const created = await runAction(
      "create-program",
      () => createProgram(facultyId, cleanName),
      "Programul academic a fost adaugat si activat."
    );

    if (!created) return;

    setProgramName("");
    await reloadFaculties(facultyId, created.id, "");
  };

  const handleCreateVariant = async (event) => {
    event.preventDefault();
    const cleanCode = variantCode.trim().toUpperCase();

    if (!programId || !cleanCode) return;

    const created = await runAction(
      "create-variant",
      () =>
        createProgramVariant({
          programId,
          code: cleanCode,
          name: cleanCode,
        }),
      "Anul / tipul a fost adaugat si activat."
    );

    if (!created) return;

    setVariantCode("");
    await fetchVariantsForProgram(programId, created.id);
    await reloadFaculties(facultyId, programId, created.id);
  };

  const handleUploadTemplate = async (event) => {
    event.preventDefault();
    const cleanName = templateName.trim();

    if (!programId || !variantId) {
      setErrorMessage("Selecteaza mai intai programul si anul / tipul.");
      return;
    }

    if (!cleanName || !templateFile) {
      setErrorMessage("Completeaza numele si selecteaza fisierul .docx.");
      return;
    }

    const uploaded = await runAction(
      "upload-template",
      () =>
        uploadTemplate({
          file: templateFile,
          programId,
          variantId,
          templateName: cleanName,
        }),
      "Template-ul a fost incarcat si disciplinele au fost extrase."
    );

    if (!uploaded) return;

    setTemplateName("");
    setTemplateFile(null);
    if (templateFileRef.current) templateFileRef.current.value = "";
    await fetchTemplatesForVariant(variantId);
    await fetchVariantsForProgram(programId, variantId);
  };

  const openEditor = (type, item) => {
    setOpenTemplateMenuId(null);

    const titles = {
      faculty: "Redenumeste facultatea",
      program: "Redenumeste programul academic",
      variant: "Redenumeste anul / tipul",
      template: "Redenumeste template-ul",
    };

    setEditor({
      type,
      id: item.id,
      value:
        type === "variant"
          ? item.code || ""
          : item.name || item.version || "",
      title: titles[type],
    });
  };

  const saveEditor = async (event) => {
    event.preventDefault();
    if (!editor) return;

    const cleanValue = editor.value.trim();
    if (!cleanValue) return;

    const actions = {
      faculty: () => updateFaculty(editor.id, cleanValue),
      program: () => updateProgram(editor.id, cleanValue),
      variant: () =>
        updateProgramVariant(editor.id, {
          code: cleanValue,
          name: cleanValue,
        }),
      template: () => renameTemplate(editor.id, cleanValue),
    };

    const saved = await runAction(
      `edit-${editor.type}`,
      actions[editor.type],
      "Modificarile au fost salvate."
    );

    if (!saved) return;

    setEditor(null);

    if (editor.type === "template") {
      await fetchTemplatesForVariant(variantId);
      await fetchVariantsForProgram(programId, variantId);
      return;
    }

    if (editor.type === "variant") {
      await fetchVariantsForProgram(programId, editor.id);
      return;
    }

    await reloadFaculties(facultyId, programId, variantId);
  };

  const openDeleteDialog = async (entityType, item) => {
    setOpenTemplateMenuId(null);

    const preview = await runAction(
      `delete-preview-${entityType}-${item.id}`,
      () => getAdminDeletePreview(entityType, item.id)
    );

    if (!preview) return;

    setDeleteDialog({
      ...preview,
      confirmationText: "",
    });
  };

  const askDeleteFaculty = () => {
    if (!selectedFaculty) return;
    openDeleteDialog("faculty", selectedFaculty);
  };

  const askDeleteProgram = () => {
    if (!selectedProgram) return;
    openDeleteDialog("program", selectedProgram);
  };

  const askDeleteVariant = (variant) => {
    openDeleteDialog("variant", {
      ...variant,
      name: variant.code,
    });
  };

  const askDeleteTemplate = (template) => {
    openDeleteDialog("template", {
      ...template,
      name: template.name || template.version || `Template ${template.id}`,
    });
  };

  const executeControlledDelete = async (withBackup) => {
    if (!deleteDialog) return;

    const entityType = deleteDialog.entity_type;
    const entityId = deleteDialog.entity_id;
    const actionKey = `delete-${entityType}-${entityId}`;
    const result = await runAction(
      actionKey,
      () =>
        deleteAdminEntity({
          entityType,
          entityId,
          confirmationName: deleteDialog.confirmationText.trim(),
          withBackup,
        }),
      withBackup
        ? "Backup-ul a fost descarcat, iar datele au fost sterse."
        : "Datele au fost sterse definitiv."
    );

    if (!result) return;

    setDeleteDialog(null);

    if (entityType === "faculty") {
      await reloadFaculties("", "", "");
      return;
    }

    if (entityType === "program") {
      await reloadFaculties(facultyId, "", "");
      return;
    }

    if (entityType === "variant") {
      await fetchVariantsForProgram(programId, "");
      await reloadFaculties(facultyId, programId, "");
      return;
    }

    await fetchTemplatesForVariant(variantId);
    await fetchVariantsForProgram(programId, variantId);
    await reloadFaculties(facultyId, programId, variantId);
  };

  const handleProgramStatus = async (program) => {
    const nextStatus = !program.is_active;
    const updated = await runAction(
      `program-status-${program.id}`,
      () => setProgramActive(program.id, nextStatus),
      nextStatus
        ? "Programul a fost activat."
        : "Programul a fost dezactivat si nu mai apare in Operator."
    );

    if (!updated) return;
    await reloadFaculties(facultyId, program.id, variantId);
  };

  const handleVariantStatus = async (variant) => {
    const nextStatus = !variant.is_active;
    const updated = await runAction(
      `variant-status-${variant.id}`,
      () => setProgramVariantActive(variant.id, nextStatus),
      nextStatus
        ? "Anul / tipul a fost activat."
        : "Anul / tipul a fost dezactivat si nu mai apare in Operator."
    );

    if (!updated) return;
    await fetchVariantsForProgram(programId, variant.id);
    await reloadFaculties(facultyId, programId, variant.id);
  };

  const handleActivateTemplate = async (template) => {
    const activated = await runAction(
      `activate-template-${template.id}`,
      () => activateTemplate(template.id),
      "Template-ul a fost activat pentru anul selectat."
    );

    if (!activated) return;
    await fetchTemplatesForVariant(variantId);
    await fetchVariantsForProgram(programId, variantId);
    await reloadFaculties(facultyId, programId, variantId);
  };


  if (loadingPage) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-7xl items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="animate-spin" size={22} />
          <span>Se incarca administrarea academica...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-6 py-7 text-white shadow-sm sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
              <Settings2 size={14} />
              Administrare academica
            </div>

            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Facultati, programe, ani si template-uri
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              Configureaza structura folosita de Operator. Programele si anii inactivi
              raman salvate, dar nu mai pot fi selectate pentru rulari noi.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {selectedFaculty ? (
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busyAction === "download-faculty"}
                onClick={() =>
                  runAction(
                    "download-faculty",
                    () => downloadFacultyData(selectedFaculty.id),
                    "Backup-ul facultatii a fost descarcat."
                  )
                }
              >
                {busyAction === "download-faculty" ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <DatabaseBackup size={17} />
                )}
                Backup facultate
              </button>
            ) : null}

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              <LogOut size={17} />
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <SectionHeader
            icon={Building2}
            title="Facultati"
            description="Adauga facultati si selecteaza contextul de administrare."
          />

          <div className="space-y-5 p-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={handleCreateFaculty}
            >
              <input
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                placeholder="Ex: Facultatea de Matematica si Informatica"
                value={facultyName}
                onChange={(event) => setFacultyName(event.target.value)}
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!facultyName.trim() || busyAction === "create-faculty"}
              >
                {busyAction === "create-faculty" ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}
                Adauga
              </button>
            </form>

            {faculties.length ? (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {faculties.map((faculty) => {
                  const isSelected = String(faculty.id) === String(facultyId);

                  return (
                    <button
                      key={faculty.id}
                      type="button"
                      className={`flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition ${
                        isSelected
                          ? "border-indigo-300 bg-indigo-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                      onClick={() => selectFaculty(faculty.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">
                          {faculty.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {faculty.program_count || 0} programe · {" "}
                          {faculty.active_program_count || 0} active
                        </div>
                      </div>

                      <ChevronRight
                        className={
                          isSelected ? "text-indigo-600" : "text-slate-400"
                        }
                        size={18}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Building2}
                title="Nu exista facultati"
                description="Adauga prima facultate pentru a putea crea programe si template-uri."
              />
            )}

            {selectedFaculty ? (
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Facultate selectata
                  </div>
                  <div className="mt-1 truncate font-semibold text-slate-950">
                    {selectedFaculty.name}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    onClick={() => openEditor("faculty", selectedFaculty)}
                  >
                    <Pencil size={15} />
                    Redenumeste
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                    onClick={askDeleteFaculty}
                  >
                    <Trash2 size={15} />
                    Sterge
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <SectionHeader
            icon={GraduationCap}
            title="Programe academice"
            description={
              selectedFaculty
                ? `Programele academice ale facultatii ${selectedFaculty.name}.`
                : "Selecteaza o facultate pentru a vedea programele."
            }
          />

          <div className="space-y-5 p-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={handleCreateProgram}
            >
              <input
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                placeholder="Ex: Informatica Romana"
                value={programName}
                onChange={(event) => setProgramName(event.target.value)}
                disabled={!facultyId}
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !facultyId ||
                  !programName.trim() ||
                  busyAction === "create-program"
                }
              >
                {busyAction === "create-program" ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}
                Adauga
              </button>
            </form>

            {!selectedFaculty ? (
              <EmptyState
                icon={GraduationCap}
                title="Selecteaza o facultate"
                description="Lista programelor va fi afisata aici dupa alegerea facultatii."
              />
            ) : programs.length ? (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {programs.map((program) => {
                  const isSelected = String(program.id) === String(programId);
                  const isActive = Boolean(program.is_active);
                  const statusBusy =
                    busyAction === `program-status-${program.id}`;

                  return (
                    <div
                      key={program.id}
                      className={`relative flex items-center gap-3 overflow-hidden rounded-xl border p-3 transition ${
                        isSelected
                          ? "border-indigo-400 bg-slate-100 shadow-sm ring-2 ring-indigo-100"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {isSelected ? (
                        <span
                          className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-indigo-600"
                          aria-hidden="true"
                        />
                      ) : null}
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => selectProgram(program.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-slate-900">
                            {program.name}
                          </span>
                          <Badge tone={isActive ? "emerald" : "slate"}>
                            {isActive ? "Activ" : "Inactiv"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {program.variant_count || 0} ani / tipuri · {" "}
                          {program.template_count || 0} template-uri
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
                          isActive ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        onClick={() => handleProgramStatus(program)}
                        disabled={statusBusy}
                        aria-label={
                          isActive
                            ? "Dezactiveaza programul"
                            : "Activeaza programul"
                        }
                        title={
                          isActive
                            ? "Dezactiveaza programul"
                            : "Activeaza programul"
                        }
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
                            isActive ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={GraduationCap}
                title="Nu exista programe academice"
                description="Adauga primul program academic al facultatii selectate."
              />
            )}

            {selectedProgram ? (
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Program academic selectat
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-slate-950">
                      {selectedProgram.name}
                    </span>
                    <Badge
                      tone={selectedProgram.is_active ? "emerald" : "slate"}
                    >
                      {selectedProgram.is_active ? "Activ" : "Inactiv"}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    onClick={() => openEditor("program", selectedProgram)}
                  >
                    <Pencil size={15} />
                    Redenumeste
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                    onClick={askDeleteProgram}
                  >
                    <Trash2 size={15} />
                    Sterge
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <SectionHeader
          icon={GraduationCap}
          title="Ani / tipuri de echivalare"
          description={
            selectedProgram
              ? `Structura operationala pentru ${selectedProgram.name}: IR1, IR2, IR3 sau alte coduri.`
              : "Selecteaza un program academic pentru a administra anii."
          }
        />

        <div className="space-y-5 p-5 sm:p-6">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={handleCreateVariant}
          >
            <input
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm uppercase outline-none transition placeholder:normal-case placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
              placeholder="Ex: IR1"
              value={variantCode}
              onChange={(event) => setVariantCode(event.target.value)}
              disabled={!programId}
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !programId ||
                !variantCode.trim() ||
                busyAction === "create-variant"
              }
            >
              {busyAction === "create-variant" ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <Plus size={17} />
              )}
              Adauga an / tip
            </button>
          </form>

          {!selectedProgram ? (
            <EmptyState
              icon={GraduationCap}
              title="Niciun program academic selectat"
              description="Alege programul academic din partea de sus."
            />
          ) : variants.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {variants.map((variant) => {
                const isSelected = String(variant.id) === String(variantId);
                const isActive = Boolean(variant.is_active);
                const statusBusy =
                  busyAction === `variant-status-${variant.id}`;

                return (
                  <div
                    key={variant.id}
                    className={`relative overflow-hidden rounded-2xl border p-4 transition ${
                      isSelected
                        ? "border-indigo-400 bg-slate-100 shadow-sm ring-2 ring-indigo-100"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {isSelected ? (
                      <span
                        className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-indigo-600"
                        aria-hidden="true"
                      />
                    ) : null}

                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => selectVariant(variant.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xl font-bold text-slate-950">
                            {variant.code}
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            {variant.study_year
                              ? `Anul ${variant.study_year}`
                              : "Tip general"}
                          </div>
                        </div>
                        <Badge tone={isActive ? "emerald" : "slate"}>
                          {isActive ? "Activ" : "Inactiv"}
                        </Badge>
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Template activ
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-slate-800">
                          {variant.active_template_name || "Niciun template activ"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {variant.template_count || 0} template-uri salvate
                        </div>
                      </div>
                    </button>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      <button
                        type="button"
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
                          isActive ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        onClick={() => handleVariantStatus(variant)}
                        disabled={statusBusy}
                        aria-label={
                          isActive
                            ? "Dezactiveaza anul"
                            : "Activeaza anul"
                        }
                        title={
                          isActive
                            ? "Dezactiveaza anul"
                            : "Activeaza anul"
                        }
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
                            isActive ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                          onClick={() => openEditor("variant", variant)}
                          title="Redenumeste codul"
                          aria-label="Redenumeste codul"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 bg-white p-2 text-red-700 transition hover:bg-red-50"
                          onClick={() => askDeleteVariant(variant)}
                          title="Sterge anul / tipul"
                          aria-label="Sterge anul / tipul"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="Programul nu are ani / tipuri"
              description="Adauga IR1, IR2, IR3 sau codurile potrivite programului."
            />
          )}
        </div>
      </section>

      <section className="relative rounded-2xl border border-slate-200 bg-white shadow-sm">
        <SectionHeader
          icon={FileText}
          title="Template-uri pentru anul selectat"
          description={
            selectedVariant
              ? `${selectedFaculty?.name || "Facultate"} / ${
                  selectedProgram?.name || "Program"
                } / ${selectedVariant.code}`
              : "Selecteaza programul academic si anul / tipul."
          }
          action={
            selectedVariant ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() =>
                  runAction(
                    "refresh-templates",
                    () => fetchTemplatesForVariant(variantId)
                  )
                }
              >
                <RefreshCw
                  className={
                    busyAction === "refresh-templates" ? "animate-spin" : ""
                  }
                  size={16}
                />
                Reincarca
              </button>
            ) : null
          }
        />

        <div className="space-y-6 p-5 sm:p-6">
          {!selectedVariant ? (
            <EmptyState
              icon={FileText}
              title="Niciun an / tip selectat"
              description="Alege programul academic, apoi IR1, IR2, IR3 sau codul necesar."
            />
          ) : (
            <>
              {!selectedProgram?.is_active ? (
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <Power className="mt-0.5 shrink-0 text-slate-500" size={18} />
                  <div>
                    Programul academic este inactiv si nu apare in Operator.
                  </div>
                </div>
              ) : !selectedVariant.is_active ? (
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <Power className="mt-0.5 shrink-0 text-slate-500" size={18} />
                  <div>
                    {selectedVariant.code} este inactiv si nu apare in Operator.
                  </div>
                </div>
              ) : !activeTemplate ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                  <div>
                    {selectedVariant.code} nu are un template activ. Incarca un
                    fisier si activeaza-l inainte de folosirea in Operator.
                  </div>
                </div>
              ) : null}

              <form
                className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
                onSubmit={handleUploadTemplate}
              >
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Nume template
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    placeholder={`Ex: ${selectedVariant?.code || "IR3"} - 2026`}
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                  />
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">
                    Un singur nume clar este suficient. Nu mai folosim campuri
                    separate pentru denumire si versiune.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Fisier .docx
                  </label>
                  <input
                    ref={templateFileRef}
                    type="file"
                    accept=".docx"
                    className="block w-full rounded-xl border border-slate-300 bg-white text-sm text-slate-600 file:mr-4 file:border-0 file:bg-indigo-50 file:px-4 file:py-2.5 file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
                    onChange={(event) =>
                      setTemplateFile(event.target.files?.[0] || null)
                    }
                  />
                  <p className="mt-1.5 truncate text-xs leading-5 text-slate-500">
                    {templateFile
                      ? `Selectat: ${templateFile.name}`
                      : `Selecteaza template-ul oficial pentru ${
                          selectedVariant?.code || "anul ales"
                        }.`}
                  </p>
                </div>

                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    !variantId ||
                    !templateName.trim() ||
                    !templateFile ||
                    busyAction === "upload-template"
                  }
                >
                  {busyAction === "upload-template" ? (
                    <Loader2 className="animate-spin" size={17} />
                  ) : (
                    <Upload size={17} />
                  )}
                  Incarca si analizeaza
                </button>
              </form>

              {templates.length ? (
                <div className="relative rounded-2xl border border-slate-200">
                  <div className="hidden rounded-t-2xl grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_110px_120px_250px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
                    <div>Template</div>
                    <div>Fisier</div>
                    <div>Discipline</div>
                    <div>Status</div>
                    <div className="text-right">Actiuni</div>
                  </div>

                  <div
                    className={`divide-y divide-slate-200 ${
                      templates.length > 4
                        ? "max-h-[448px] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
                        : ""
                    }`}
                    onScroll={() => {
                      setOpenTemplateMenuId(null);
                      setTemplateMenuPosition(null);
                    }}
                  >
                    {templates.map((template) => {
                      const templateBusy = busyAction.endsWith(
                        `-${template.id}`
                      );

                      return (
                        <div
                          key={template.id}
                          className="grid grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_110px_120px_250px] lg:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-semibold text-slate-950">
                                {template.name || template.version}
                              </span>
                              {template.is_active ? (
                                <Badge tone="emerald">Activ</Badge>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Incarcat la {formatDate(template.created_at)} · {" "}
                              {template.run_count || 0} rulari
                            </div>
                          </div>

                          <div className="min-w-0 text-sm text-slate-600">
                            <div className="truncate">
                              {template.original_filename || "Fisier DOCX"}
                            </div>
                            {!template.file_exists ? (
                              <div className="mt-1 text-xs font-semibold text-red-700">
                                Fisierul lipseste de pe disc
                              </div>
                            ) : null}
                          </div>

                          <div className="text-sm font-semibold text-slate-700">
                            {template.course_count || 0}
                          </div>

                          <div>
                            <Badge
                              tone={
                                !template.file_exists
                                  ? "red"
                                  : template.is_active
                                    ? "emerald"
                                    : "slate"
                              }
                            >
                              {!template.file_exists
                                ? "Lipsa"
                                : template.is_active
                                  ? "Activ"
                                  : "Inactiv"}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                            {!template.is_active ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                disabled={!template.file_exists || templateBusy}
                                onClick={() => handleActivateTemplate(template)}
                              >
                                <CheckCircle2 size={15} />
                                Activeaza
                              </button>
                            ) : null}

                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                              disabled={!template.file_exists || templateBusy}
                              onClick={() =>
                                runAction(
                                  `download-template-${template.id}`,
                                  () =>
                                    downloadTemplate(
                                      template.id,
                                      template.original_filename ||
                                        `${template.name || template.version}.docx`
                                    )
                                )
                              }
                            >
                              <Download size={15} />
                              Descarca
                            </button>

                            <div
                              ref={
                                openTemplateMenuId === template.id
                                  ? openTemplateMenuRef
                                  : null
                              }
                              className="relative"
                            >
                              <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                aria-haspopup="menu"
                                aria-expanded={
                                  openTemplateMenuId === template.id
                                }
                                onClick={(event) =>
                                  toggleTemplateMenu(
                                    template.id,
                                    event.currentTarget
                                  )
                                }
                              >
                                <MoreHorizontal size={16} />
                                Mai multe
                              </button>

                              {openTemplateMenuId === template.id &&
                              templateMenuPosition ? (
                                <div
                                  className={`fixed z-[70] w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl ${
                                    templateMenuPosition.openUp
                                      ? "-translate-y-full"
                                      : ""
                                  }`}
                                  style={{
                                    top: templateMenuPosition.top,
                                    left: templateMenuPosition.left,
                                  }}
                                  role="menu"
                                >
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                                    onClick={() =>
                                      openEditor("template", template)
                                    }
                                    role="menuitem"
                                  >
                                    <Pencil size={15} />
                                    Redenumeste
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-700 transition hover:bg-red-50"
                                    onClick={() =>
                                      askDeleteTemplate(template)
                                    }
                                    role="menuitem"
                                  >
                                    <Trash2 size={15} />
                                    Sterge
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={FileText}
                  title={`${selectedVariant?.code || "Anul"} nu are template`}
                  description="Incarca fisierul DOCX oficial pentru anul / tipul selectat."
                />
              )}
            </>
          )}
        </div>
      </section>

      <MatchingConfigurationPanel
        program={selectedProgram}
        variants={variants}
      />

      {successMessage || errorMessage ? (
        <div className="fixed bottom-5 right-5 z-[90] w-[calc(100%-2.5rem)] max-w-md space-y-3">
          {successMessage ? (
            <StatusMessage
              type="success"
              onClose={() => setSuccessMessage("")}
            >
              {successMessage}
            </StatusMessage>
          ) : null}

          {errorMessage ? (
            <StatusMessage
              type="error"
              onClose={() => setErrorMessage("")}
            >
              {errorMessage}
            </StatusMessage>
          ) : null}
        </div>
      ) : null}

      {editor ? (
        <Modal
          title={editor.title}
          description="Modificarea schimba doar denumirea afisata."
          onClose={() => setEditor(null)}
          footer={
            <>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                onClick={() => setEditor(null)}
              >
                Renunta
              </button>
              <button
                type="submit"
                form="admin-editor-form"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={!editor.value.trim() || busyAction === `edit-${editor.type}`}
              >
                {busyAction === `edit-${editor.type}` ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Pencil size={16} />
                )}
                Salveaza
              </button>
            </>
          }
        >
          <form id="admin-editor-form" onSubmit={saveEditor}>
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              {editor.type === "variant" ? "Cod an / tip" : "Denumire"}
            </label>
            <input
              autoFocus
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              value={editor.value}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  value: event.target.value,
                }))
              }
            />
          </form>
        </Modal>
      ) : null}

      {deleteDialog ? (
        <Modal
          title={`Stergi „${deleteDialog.entity_name}”?`}
          description="Alege daca vrei sa descarci un backup inainte de stergerea completa."
          onClose={() => {
            if (!busyAction.startsWith("delete-")) {
              setDeleteDialog(null);
            }
          }}
          footer={
            <>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                disabled={busyAction.startsWith("delete-")}
                onClick={() => setDeleteDialog(null)}
              >
                Renunta
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  deleteDialog.confirmationText.trim() !==
                    deleteDialog.entity_name.trim() ||
                  busyAction.startsWith("delete-")
                }
                onClick={() => executeControlledDelete(true)}
              >
                {busyAction.startsWith("delete-") ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <DatabaseBackup size={16} />
                )}
                Backup si sterge
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  deleteDialog.confirmationText.trim() !==
                    deleteDialog.entity_name.trim() ||
                  busyAction.startsWith("delete-")
                }
                onClick={() => executeControlledDelete(false)}
              >
                {busyAction.startsWith("delete-") ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                Sterge definitiv
              </button>
            </>
          }
        >
          <DeleteSummary preview={deleteDialog} />

          <div className="mt-5">
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Scrie exact denumirea pentru confirmare:
            </label>
            <div className="mb-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800">
              {deleteDialog.entity_name}
            </div>
            <input
              autoFocus
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-red-500 focus:ring-4 focus:ring-red-100"
              placeholder="Introdu denumirea exacta"
              value={deleteDialog.confirmationText}
              disabled={busyAction.startsWith("delete-")}
              onChange={(event) =>
                setDeleteDialog((current) => ({
                  ...current,
                  confirmationText: event.target.value,
                }))
              }
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
