import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Info,
  Layers3,
  Loader2,
  Plus,
  Power,
  Save,
  Tags,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  createProgramMatchingAlias,
  createProgramMatchingDirectRule,
  createProgramMatchingFamily,
  createProgramMatchingFamilyTerm,
  deleteProgramMatchingAlias,
  deleteProgramMatchingDirectRule,
  deleteProgramMatchingFamily,
  deleteProgramMatchingFamilyTerm,
  getProgramMatchingConfig,
  updateProgramMatchingAlias,
  updateProgramMatchingDirectRule,
  updateProgramMatchingFamily,
  updateProgramMatchingFamilyTerm,
} from "../../api";

const EMPTY_CONFIG = {
  aliases: [],
  families: [],
  direct_rules: [],
  legacy_alias_count: 0,
  legacy_course_rule_count: 0,
  matcher_integration_status: "connected",
};

const LEVEL_POLICY_LABELS = {
  ignore: "Ignora nivelul",
  same_required: "Nivel identic obligatoriu",
  same_if_present: "Nivel identic daca este prezent",
};

const DECISION_LABELS = {
  auto: "Auto",
  needs_review: "De verificat",
  blocked: "Blocat",
};

const MATCH_MODE_LABELS = {
  exact: "Expresie exacta",
  starts_with: "Incepe cu",
  contains_phrase: "Contine expresia completa",
};

const DIRECTION_LABELS = {
  forward: "Doar sursa -> tinta",
  bidirectional: "Bidirectionala",
};

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

function Message({ type, children, onClose }) {
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

function ConfigModal({ title, description, children, onClose, footer }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
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
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}

function ToggleButton({ active, disabled, onClick }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
      }`}
      disabled={disabled}
      onClick={onClick}
      title={active ? "Dezactiveaza" : "Activeaza"}
    >
      <Power size={13} />
      {active ? "Activ" : "Inactiv"}
    </button>
  );
}

function EmptyTab({ title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <div className="font-semibold text-slate-800">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

export default function MatchingConfigurationPanel({ program, variants = [] }) {
  const [tab, setTab] = useState("aliases");
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [expandedFamilyId, setExpandedFamilyId] = useState(null);

  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timeoutId = window.setTimeout(
      () => setMessage(null),
      message.type === "error" ? 8000 : 4500
    );

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const [aliasDraft, setAliasDraft] = useState({
    canonical_name: "",
    alias_name: "",
  });

  const [familyDraft, setFamilyDraft] = useState({
    name: "",
    code: "",
    level_policy: "same_if_present",
    decision_status: "needs_review",
    notes: "",
  });

  const [ruleDraft, setRuleDraft] = useState({
    source_name: "",
    target_name: "",
    direction: "forward",
    decision_status: "needs_review",
    notes: "",
  });

  const [termDrafts, setTermDrafts] = useState({});

  const aliasGroups = useMemo(() => {
    const groups = new Map();

    for (const alias of config.aliases || []) {
      const key = alias.canonical_norm || alias.canonical_name;

      if (!groups.has(key)) {
        groups.set(key, {
          canonical_name: alias.canonical_name,
          aliases: [],
        });
      }

      groups.get(key).aliases.push(alias);
    }

    return Array.from(groups.values());
  }, [config.aliases]);

  const variantLabel = variants.length
    ? variants.map((variant) => variant.code).join(", ")
    : "-";

  const loadConfig = useCallback(async () => {
    if (!program?.id) {
      setConfig(EMPTY_CONFIG);
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const data = await getProgramMatchingConfig(program.id);
      setConfig(data);
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.message || "Nu am putut incarca configuratia.",
      });
    } finally {
      setLoading(false);
    }
  }, [program?.id]);

  useEffect(() => {
    loadConfig();
    setAliasDraft({ canonical_name: "", alias_name: "" });
    setFamilyDraft({
      name: "",
      code: "",
      level_policy: "same_if_present",
      decision_status: "needs_review",
      notes: "",
    });
    setRuleDraft({
      source_name: "",
      target_name: "",
      direction: "forward",
      decision_status: "needs_review",
      notes: "",
    });
    setTermDrafts({});
    setDialog(null);
    setExpandedFamilyId(null);
  }, [loadConfig]);

  const runAction = async (key, action, successText) => {
    setBusyAction(key);
    setMessage(null);

    try {
      await action();
      await loadConfig();
      setMessage({ type: "success", text: successText });
      return true;
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.message || "Actiunea nu a putut fi finalizata.",
      });
      return false;
    } finally {
      setBusyAction("");
    }
  };

  const createAlias = async (event) => {
    event.preventDefault();

    const saved = await runAction(
      "create-alias",
      () => createProgramMatchingAlias(program.id, aliasDraft),
      "Aliasul a fost adaugat."
    );

    if (saved) {
      setAliasDraft({ canonical_name: "", alias_name: "" });
    }
  };

  const createFamily = async (event) => {
    event.preventDefault();

    const saved = await runAction(
      "create-family",
      () => createProgramMatchingFamily(program.id, familyDraft),
      "Familia a fost adaugata."
    );

    if (saved) {
      setFamilyDraft({
        name: "",
        code: "",
        level_policy: "same_if_present",
        decision_status: "needs_review",
        notes: "",
      });
    }
  };

  const createRule = async (event) => {
    event.preventDefault();

    const saved = await runAction(
      "create-rule",
      () => createProgramMatchingDirectRule(program.id, ruleDraft),
      "Regula directa a fost adaugata."
    );

    if (saved) {
      setRuleDraft({
        source_name: "",
        target_name: "",
        direction: "forward",
        decision_status: "needs_review",
        notes: "",
      });
    }
  };

  const createTerm = async (family, isExclusion) => {
    const draft = termDrafts[family.id] || {
      term: "",
      match_mode: "contains_phrase",
    };

    if (!draft.term.trim()) {
      setMessage({
        type: "error",
        text: "Completeaza denumirea inainte de salvare.",
      });
      return;
    }

    const saved = await runAction(
      `create-term-${family.id}`,
      () =>
        createProgramMatchingFamilyTerm(family.id, {
          ...draft,
          is_exclusion: isExclusion,
        }),
      isExclusion
        ? "Exceptia a fost adaugata."
        : "Denumirea familiei a fost adaugata."
    );

    if (saved) {
      setTermDrafts((current) => ({
        ...current,
        [family.id]: {
          term: "",
          match_mode: current[family.id]?.match_mode || "contains_phrase",
        },
      }));
    }
  };

  const deleteItem = async (type, item) => {
    const labels = {
      alias: "aliasul",
      family: "familia si toate denumirile sale",
      term: item.is_exclusion ? "exceptia" : "denumirea",
      rule: "regula directa",
    };

    const confirmed = window.confirm(
      `Stergi ${labels[type]}? Aceasta actiune nu poate fi anulata.`
    );

    if (!confirmed) return;

    const actions = {
      alias: () => deleteProgramMatchingAlias(item.id),
      family: () => deleteProgramMatchingFamily(item.id),
      term: () => deleteProgramMatchingFamilyTerm(item.id),
      rule: () => deleteProgramMatchingDirectRule(item.id),
    };

    await runAction(
      `delete-${type}-${item.id}`,
      actions[type],
      "Elementul a fost sters."
    );
  };

  const toggleItem = async (type, item) => {
    const nextActive = !item.is_active;
    const actions = {
      alias: () =>
        updateProgramMatchingAlias(item.id, {
          ...item,
          is_active: nextActive,
        }),
      family: () =>
        updateProgramMatchingFamily(item.id, {
          ...item,
          is_active: nextActive,
        }),
      term: () =>
        updateProgramMatchingFamilyTerm(item.id, {
          ...item,
          is_active: nextActive,
        }),
      rule: () =>
        updateProgramMatchingDirectRule(item.id, {
          ...item,
          is_active: nextActive,
        }),
    };

    await runAction(
      `toggle-${type}-${item.id}`,
      actions[type],
      nextActive ? "Elementul a fost activat." : "Elementul a fost dezactivat."
    );
  };

  const openEditDialog = (type, item) => {
    setDialog({
      type,
      item,
      values: { ...item },
    });
  };

  const saveDialog = async () => {
    if (!dialog) return;

    const { type, item, values } = dialog;
    const actions = {
      alias: () => updateProgramMatchingAlias(item.id, values),
      family: () => updateProgramMatchingFamily(item.id, values),
      term: () => updateProgramMatchingFamilyTerm(item.id, values),
      rule: () => updateProgramMatchingDirectRule(item.id, values),
    };

    const saved = await runAction(
      `edit-${type}-${item.id}`,
      actions[type],
      "Modificarile au fost salvate."
    );

    if (saved) setDialog(null);
  };

  if (!program) {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <h2 className="text-lg font-semibold text-slate-950">
            Configuratie matching
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Selecteaza mai intai un program academic.
          </p>
        </div>
        <div className="p-5 sm:p-6">
          <EmptyTab
            title="Niciun program selectat"
            description="Aliasurile, familiile si regulile directe sunt legate de programul academic, nu de un singur IR1, IR2 sau IR3."
          />
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700">
            <Layers3 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Configuratie matching
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {program.name} · se aplica pentru {variantLabel}
            </p>
          </div>
        </div>
        <Badge tone="emerald">Conectata la matcher</Badge>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 lg:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-indigo-950">
              <Info size={17} />
              Alias
            </div>
            <p className="mt-2 text-sm leading-6 text-indigo-900/80">
              Aceeasi disciplina, scrisa diferit. Exemplu: Inginerie soft =
              Inginerie software. Nu este necesar pentru diferente de
              majuscule.
            </p>
          </div>
          <div className="border-indigo-200 lg:border-l lg:pl-5">
            <div className="font-semibold text-indigo-950">Familie</div>
            <p className="mt-2 text-sm leading-6 text-indigo-900/80">
              Discipline apropiate care urmeaza aceeasi politica de nivel.
              Exemplu: Sport I si Educatie fizica I.
            </p>
          </div>
          <div className="border-indigo-200 lg:border-l lg:pl-5">
            <div className="font-semibold text-indigo-950">
              Regula directa
            </div>
            <p className="mt-2 text-sm leading-6 text-indigo-900/80">
              Decizie explicita intre doua denumiri concrete: Auto, De
              verificat sau Blocat.
            </p>
          </div>
        </div>

        {(config.legacy_alias_count > 0 ||
          config.legacy_course_rule_count > 0) ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 shrink-0" size={18} />
            <div>
              Sistemul vechi contine {config.legacy_alias_count} aliasuri si{" "}
              {config.legacy_course_rule_count} reguli legate de template-uri
              pentru acest program. Ele raman active ca fallback, dupa
              configuratia noua administrata aici.
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 rounded-xl bg-slate-100 p-1.5">
          {[
            ["aliases", "Aliasuri", <Tags key="aliases" size={16} />],
            ["families", "Familii", <Layers3 key="families" size={16} />],
            [
              "rules",
              "Reguli directe",
              <ArrowLeftRight key="rules" size={16} />,
            ],
          ].map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                tab === value
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
              }`}
              onClick={() => setTab(value)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center gap-3 text-slate-600">
            <Loader2 className="animate-spin" size={20} />
            Se incarca configuratia...
          </div>
        ) : null}

        {!loading && tab === "aliases" ? (
          <div className="space-y-5">
            <form
              className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
              onSubmit={createAlias}
            >
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Disciplina canonica
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  placeholder="Ex: Inginerie software"
                  value={aliasDraft.canonical_name}
                  onChange={(event) =>
                    setAliasDraft((current) => ({
                      ...current,
                      canonical_name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Alias
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  placeholder="Ex: Inginerie soft"
                  value={aliasDraft.alias_name}
                  onChange={(event) =>
                    setAliasDraft((current) => ({
                      ...current,
                      alias_name: event.target.value,
                    }))
                  }
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={
                  busyAction === "create-alias" ||
                  !aliasDraft.canonical_name.trim() ||
                  !aliasDraft.alias_name.trim()
                }
              >
                {busyAction === "create-alias" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Adauga alias
              </button>
            </form>

            {aliasGroups.length ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {aliasGroups.map((group) => (
                  <div
                    key={group.canonical_name}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <div className="font-semibold text-slate-950">
                      {group.canonical_name}
                    </div>
                    <div className="mt-3 space-y-2">
                      {group.aliases.map((alias) => (
                        <div
                          key={alias.id}
                          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-800">
                              {alias.alias_name}
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-slate-400">
                              {alias.alias_norm}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <ToggleButton
                              active={Boolean(alias.is_active)}
                              disabled={busyAction.includes(String(alias.id))}
                              onClick={() => toggleItem("alias", alias)}
                            />
                            <button
                              type="button"
                              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                              onClick={() => openEditDialog("alias", alias)}
                              title="Editeaza"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-200 bg-white p-2 text-red-600 transition hover:bg-red-50"
                              onClick={() => deleteItem("alias", alias)}
                              title="Sterge"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyTab
                title="Nu exista aliasuri pentru acest program"
                description="Adauga numai variante care reprezinta exact aceeasi disciplina, nu doar discipline asemanatoare."
              />
            )}
          </div>
        ) : null}

        {!loading && tab === "families" ? (
          <div className="space-y-5">
            <form
              className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 xl:grid-cols-5 xl:items-end"
              onSubmit={createFamily}
            >
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Nume familie
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  placeholder="Ex: Educatie fizica si sport"
                  value={familyDraft.name}
                  onChange={(event) =>
                    setFamilyDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Cod intern optional
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  placeholder="Ex: educatie_fizica"
                  value={familyDraft.code}
                  onChange={(event) =>
                    setFamilyDraft((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Politica nivel
                </label>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={familyDraft.level_policy}
                  onChange={(event) =>
                    setFamilyDraft((current) => ({
                      ...current,
                      level_policy: event.target.value,
                    }))
                  }
                >
                  {Object.entries(LEVEL_POLICY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Decizie implicita
                </label>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={familyDraft.decision_status}
                  onChange={(event) =>
                    setFamilyDraft((current) => ({
                      ...current,
                      decision_status: event.target.value,
                    }))
                  }
                >
                  <option value="needs_review">De verificat</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={
                  busyAction === "create-family" ||
                  !familyDraft.name.trim()
                }
              >
                {busyAction === "create-family" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Adauga familie
              </button>
            </form>

            {config.families.length ? (
              <div className="space-y-4">
                {config.families.map((family) => {
                  const termDraft = termDrafts[family.id] || {
                    term: "",
                    match_mode: "contains_phrase",
                  };

                  const isExpanded = expandedFamilyId === family.id;
                  const detailsId = `family-details-${family.id}`;

                  return (
                    <div
                      key={family.id}
                      className={`overflow-hidden rounded-2xl border bg-white transition ${
                        isExpanded
                          ? "border-indigo-300 shadow-sm ring-2 ring-indigo-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div
                        className={`flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center ${
                          isExpanded
                            ? "border-b border-slate-200 bg-slate-50"
                            : "bg-white"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none transition focus-visible:ring-4 focus-visible:ring-indigo-100"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() =>
                            setExpandedFamilyId((currentId) =>
                              currentId === family.id ? null : family.id
                            )
                          }
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${
                              isExpanded
                                ? "border-indigo-200 bg-indigo-100 text-indigo-700"
                                : "border-slate-200 bg-slate-50 text-slate-500"
                            }`}
                          >
                            <ChevronDown
                              size={18}
                              className={`transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate font-semibold text-slate-950">
                                {family.name}
                              </h3>
                              <Badge
                                tone={family.is_active ? "emerald" : "slate"}
                              >
                                {family.is_active ? "Activa" : "Inactiva"}
                              </Badge>
                              <Badge tone="indigo">
                                {DECISION_LABELS[family.decision_status]}
                              </Badge>
                            </div>

                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span>Cod: {family.code}</span>
                              <span>
                                Nivel:{" "}
                                {LEVEL_POLICY_LABELS[family.level_policy]}
                              </span>
                              <span>{family.terms.length} denumiri</span>
                              <span>{family.exclusions.length} exceptii</span>
                            </div>
                          </div>

                          <span className="hidden shrink-0 text-xs font-semibold text-slate-500 sm:inline">
                            {isExpanded ? "Restrange" : "Vezi detalii"}
                          </span>
                        </button>

                        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                          <ToggleButton
                            active={Boolean(family.is_active)}
                            disabled={busyAction.includes(String(family.id))}
                            onClick={() => toggleItem("family", family)}
                          />
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                            onClick={() => openEditDialog("family", family)}
                          >
                            <Edit3 size={14} />
                            Editeaza
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                            onClick={() => deleteItem("family", family)}
                          >
                            <Trash2 size={14} />
                            Sterge
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div
                          id={detailsId}
                          className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-2"
                        >
                          {[
                            {
                              title: "Denumiri incluse",
                              items: family.terms,
                              exclusion: false,
                              tone: "emerald",
                            },
                            {
                              title: "Exceptii",
                              items: family.exclusions,
                              exclusion: true,
                              tone: "red",
                            },
                          ].map((section) => (
                            <div key={section.title}>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="font-semibold text-slate-800">
                                  {section.title}
                                </div>
                                <Badge tone={section.tone}>
                                  {section.items.length}
                                </Badge>
                              </div>

                              <div className="space-y-2">
                                {section.items.length ? (
                                  section.items.map((term) => (
                                    <div
                                      key={term.id}
                                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-slate-800">
                                          {term.term}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          {MATCH_MODE_LABELS[term.match_mode]}
                                        </div>
                                      </div>
                                      <ToggleButton
                                        active={Boolean(term.is_active)}
                                        disabled={busyAction.includes(
                                          String(term.id)
                                        )}
                                        onClick={() =>
                                          toggleItem("term", term)
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="rounded-lg p-2 text-slate-500 transition hover:bg-white hover:text-slate-900"
                                        onClick={() =>
                                          openEditDialog("term", term)
                                        }
                                        title="Editeaza"
                                      >
                                        <Edit3 size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-lg p-2 text-red-600 transition hover:bg-red-50"
                                        onClick={() =>
                                          deleteItem("term", term)
                                        }
                                        title="Sterge"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-400">
                                    Nicio denumire.
                                  </div>
                                )}
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                                <input
                                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                                  placeholder={
                                    section.exclusion
                                      ? "Ex: Practica dezvoltarii unui proiect IT"
                                      : "Ex: Stagiu de practica"
                                  }
                                  value={termDraft.term}
                                  onChange={(event) =>
                                    setTermDrafts((current) => ({
                                      ...current,
                                      [family.id]: {
                                        ...termDraft,
                                        term: event.target.value,
                                      },
                                    }))
                                  }
                                />
                                <select
                                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                                  value={termDraft.match_mode}
                                  onChange={(event) =>
                                    setTermDrafts((current) => ({
                                      ...current,
                                      [family.id]: {
                                        ...termDraft,
                                        match_mode: event.target.value,
                                      },
                                    }))
                                  }
                                >
                                  {Object.entries(MATCH_MODE_LABELS).map(
                                    ([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    )
                                  )}
                                </select>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                                  disabled={
                                    busyAction ===
                                      `create-term-${family.id}` ||
                                    !termDraft.term.trim()
                                  }
                                  onClick={() =>
                                    createTerm(family, section.exclusion)
                                  }
                                >
                                  {busyAction ===
                                  `create-term-${family.id}` ? (
                                    <Loader2
                                      className="animate-spin"
                                      size={15}
                                    />
                                  ) : (
                                    <Plus size={15} />
                                  )}
                                  Adauga
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyTab
                title="Nu exista familii pentru acest program"
                description="Incepe cu o familie care apare repetitiv in benchmark, de exemplu Stagiu de practica, Limbi straine sau Educatie fizica."
              />
            )}
          </div>
        ) : null}

        {!loading && tab === "rules" ? (
          <div className="space-y-5">
            <form
              className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_170px_auto] xl:items-end"
              onSubmit={createRule}
            >
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Disciplina sursa
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  placeholder="Ex: Etica, integritate si scriere academica"
                  value={ruleDraft.source_name}
                  onChange={(event) =>
                    setRuleDraft((current) => ({
                      ...current,
                      source_name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Disciplina tinta
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  placeholder="Ex: Etica si integritate academica"
                  value={ruleDraft.target_name}
                  onChange={(event) =>
                    setRuleDraft((current) => ({
                      ...current,
                      target_name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Directie
                </label>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={ruleDraft.direction}
                  onChange={(event) =>
                    setRuleDraft((current) => ({
                      ...current,
                      direction: event.target.value,
                    }))
                  }
                >
                  {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                  Decizie
                </label>
                <select
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  value={ruleDraft.decision_status}
                  onChange={(event) =>
                    setRuleDraft((current) => ({
                      ...current,
                      decision_status: event.target.value,
                    }))
                  }
                >
                  <option value="needs_review">De verificat</option>
                  <option value="auto">Auto</option>
                  <option value="blocked">Blocat</option>
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={
                  busyAction === "create-rule" ||
                  !ruleDraft.source_name.trim() ||
                  !ruleDraft.target_name.trim()
                }
              >
                {busyAction === "create-rule" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Adauga regula
              </button>
            </form>

            {config.direct_rules.length ? (
              <div className="space-y-3">
                {config.direct_rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            rule.decision_status === "blocked"
                              ? "red"
                              : rule.decision_status === "auto"
                                ? "emerald"
                                : "amber"
                          }
                        >
                          {DECISION_LABELS[rule.decision_status]}
                        </Badge>
                        <Badge tone="slate">
                          {DIRECTION_LABELS[rule.direction]}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
                        <div className="font-medium text-slate-900">
                          {rule.source_name}
                        </div>
                        <ArrowLeftRight
                          className="text-slate-400"
                          size={17}
                        />
                        <div className="font-medium text-slate-900">
                          {rule.target_name}
                        </div>
                      </div>
                      {rule.notes ? (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {rule.notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleButton
                        active={Boolean(rule.is_active)}
                        disabled={busyAction.includes(String(rule.id))}
                        onClick={() => toggleItem("rule", rule)}
                      />
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        onClick={() => openEditDialog("rule", rule)}
                      >
                        <Edit3 size={14} />
                        Editeaza
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                        onClick={() => deleteItem("rule", rule)}
                      >
                        <Trash2 size={14} />
                        Sterge
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyTab
                title="Nu exista reguli directe"
                description="Foloseste regulile directe numai pentru decizii academice explicite intre doua denumiri concrete."
              />
            )}
          </div>
        ) : null}

        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
          <div>
            Configuratia activa se aplica rularilor noi din Operator.
            Rularile deja existente nu sunt recalculate automat.
          </div>
        </div>
      </div>

      {message ? (
        <div className="fixed bottom-5 right-5 z-[80] w-[calc(100%-2.5rem)] max-w-md">
          <Message
            type={message.type}
            onClose={() => setMessage(null)}
          >
            {message.text}
          </Message>
        </div>
      ) : null}

      {dialog ? (
        <ConfigModal
          title={
            dialog.type === "alias"
              ? "Editeaza aliasul"
              : dialog.type === "family"
                ? "Editeaza familia"
                : dialog.type === "term"
                  ? "Editeaza denumirea familiei"
                  : "Editeaza regula directa"
          }
          description="Modificarile sunt salvate pentru programul academic selectat."
          onClose={() => setDialog(null)}
          footer={
            <>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                onClick={() => setDialog(null)}
              >
                Renunta
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={busyAction.startsWith(`edit-${dialog.type}`)}
                onClick={saveDialog}
              >
                {busyAction.startsWith(`edit-${dialog.type}`) ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                Salveaza
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {dialog.type === "alias" ? (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Disciplina canonica
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.canonical_name || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          canonical_name: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Alias
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.alias_name || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          alias_name: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </>
            ) : null}

            {dialog.type === "family" ? (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Nume familie
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.name || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          name: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Cod intern
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.code || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          code: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Politica nivel
                    </label>
                    <select
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      value={dialog.values.level_policy || "same_if_present"}
                      onChange={(event) =>
                        setDialog((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            level_policy: event.target.value,
                          },
                        }))
                      }
                    >
                      {Object.entries(LEVEL_POLICY_LABELS).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Decizie implicita
                    </label>
                    <select
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      value={dialog.values.decision_status || "needs_review"}
                      onChange={(event) =>
                        setDialog((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            decision_status: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="needs_review">De verificat</option>
                      <option value="auto">Auto</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Observatii optional
                  </label>
                  <textarea
                    className="min-h-24 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.notes || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          notes: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </>
            ) : null}

            {dialog.type === "term" ? (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Denumire
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.term || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          term: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Tip potrivire
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.match_mode || "contains_phrase"}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          match_mode: event.target.value,
                        },
                      }))
                    }
                  >
                    {Object.entries(MATCH_MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(dialog.values.is_exclusion)}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          is_exclusion: event.target.checked,
                        },
                      }))
                    }
                  />
                  Este exceptie
                </label>
              </>
            ) : null}

            {dialog.type === "rule" ? (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Disciplina sursa
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.source_name || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          source_name: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Disciplina tinta
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.target_name || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          target_name: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Directie
                    </label>
                    <select
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      value={dialog.values.direction || "forward"}
                      onChange={(event) =>
                        setDialog((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            direction: event.target.value,
                          },
                        }))
                      }
                    >
                      {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Decizie
                    </label>
                    <select
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                      value={dialog.values.decision_status || "needs_review"}
                      onChange={(event) =>
                        setDialog((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            decision_status: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="needs_review">De verificat</option>
                      <option value="auto">Auto</option>
                      <option value="blocked">Blocat</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Observatii optional
                  </label>
                  <textarea
                    className="min-h-24 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                    value={dialog.values.notes || ""}
                    onChange={(event) =>
                      setDialog((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          notes: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </>
            ) : null}
          </div>
        </ConfigModal>
      ) : null}
    </section>
  );
}
