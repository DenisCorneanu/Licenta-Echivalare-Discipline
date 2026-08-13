// Baza URL pentru API: .env sau proxy-ul Vite
// .env exemplu: VITE_API_URL=http://localhost:4000/api
const API_BASE = import.meta.env.VITE_API_URL || '/api';

/* ===================== OPERATOR ===================== */

export async function uploadAndMatch({
  file,
  programId,
  variantId,
  studentName
}) {
  const form = new FormData();
  form.append('xlsx', file);
  form.append('program_id', programId || '');
  form.append('variant_id', variantId || '');
  form.append('student_name', studentName || '');
  const r = await fetch(`${API_BASE}/match`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function fetchRunCourses(runId) {
  const r = await fetch(`${API_BASE}/runs/${runId}/courses`);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function saveOverrides(runId, items) {
  const r = await fetch(`${API_BASE}/runs/${runId}/overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function saveRunStudentData(runId, studentData) {
  const r = await fetch(`${API_BASE}/runs/${runId}/student-data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(studentData)
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

function getDownloadFilename(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, ''));
    } catch {
      return utf8Match[1].replace(/["']/g, '');
    }
  }

  const normalMatch = disposition.match(/filename="?([^";]+)"?/i);
  return normalMatch?.[1] || fallback;
}

export async function exportDocx(runId) {
  const r = await fetch(`${API_BASE}/export/${runId}`, { method: 'POST' });
  if (!r.ok) throw new Error(await r.text());
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getDownloadFilename(r, `echivalare_${runId}.docx`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ====================== ADMIN ======================= */

async function readApiError(response) {
  const text = await response.text();

  try {
    const parsed = JSON.parse(text);
    const base = parsed?.error || text;
    const details = String(parsed?.details || '').trim();
    return details ? `${base}: ${details}` : base;
  } catch {
    return text || `Eroare HTTP ${response.status}`;
  }
}

async function downloadApiFile(response, fallbackName) {
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const disposition = response.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const normalMatch = disposition.match(/filename="?([^";]+)"?/i);

  let filename = fallbackName;

  if (utf8Match?.[1]) {
    try {
      filename = decodeURIComponent(utf8Match[1].replace(/["']/g, ''));
    } catch {
      filename = utf8Match[1].replace(/["']/g, '');
    }
  } else if (normalMatch?.[1]) {
    filename = normalMatch[1];
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function createFaculty(name) {
  const response = await fetch(`${API_BASE}/faculties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function listFaculties() {
  const response = await fetch(`${API_BASE}/faculties`);

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateFaculty(facultyId, name) {
  const response = await fetch(`${API_BASE}/faculties/${facultyId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteFaculty(facultyId) {
  const response = await fetch(`${API_BASE}/faculties/${facultyId}`, {
    method: 'DELETE'
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function downloadFacultyData(facultyId) {
  const response = await fetch(
    `${API_BASE}/admin/backup/faculty/${facultyId}`
  );

  await downloadApiFile(
    response,
    `backup_facultate_${facultyId}.zip`
  );
}

export async function getAdminDeletePreview(entityType, entityId) {
  const response = await fetch(
    `${API_BASE}/admin/delete-preview/${entityType}/${entityId}`
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteAdminEntity({
  entityType,
  entityId,
  confirmationName,
  withBackup
}) {
  const response = await fetch(
    `${API_BASE}/admin/delete/${entityType}/${entityId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: withBackup ? 'backup_and_delete' : 'delete',
        confirmation_name: confirmationName
      })
    }
  );

  if (withBackup) {
    await downloadApiFile(
      response,
      `backup_${entityType}_${entityId}.zip`
    );
    return { ok: true, backup_downloaded: true };
  }

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function createProgram(faculty_id, name) {
  const response = await fetch(`${API_BASE}/programs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ faculty_id, name })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function listPrograms(
  facultyId,
  { includeInactive = false } = {}
) {
  const params = new URLSearchParams({
    facultyId: String(facultyId || '')
  });

  if (includeInactive) {
    params.set('includeInactive', '1');
  }

  const response = await fetch(`${API_BASE}/programs?${params.toString()}`);

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function createProgramVariant({
  programId,
  code,
  name = '',
  studyYear = null
}) {
  const response = await fetch(`${API_BASE}/program-variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      program_id: programId,
      code,
      name,
      study_year: studyYear
    })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function listProgramVariants(
  programId,
  { includeInactive = false } = {}
) {
  const params = new URLSearchParams({
    programId: String(programId || '')
  });

  if (includeInactive) {
    params.set('includeInactive', '1');
  }

  const response = await fetch(
    `${API_BASE}/program-variants?${params.toString()}`
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateProgramVariant(variantId, payload) {
  const response = await fetch(`${API_BASE}/program-variants/${variantId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function setProgramVariantActive(variantId, isActive) {
  const response = await fetch(
    `${API_BASE}/program-variants/${variantId}/active`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: Boolean(isActive) })
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateProgram(programId, name) {
  const response = await fetch(`${API_BASE}/programs/${programId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function setProgramActive(programId, isActive) {
  const response = await fetch(`${API_BASE}/programs/${programId}/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: Boolean(isActive) })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteProgram(programId) {
  const response = await fetch(`${API_BASE}/programs/${programId}`, {
    method: 'DELETE'
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function uploadTemplate({
  file,
  programId,
  variantId,
  templateName,
  version
}) {
  const form = new FormData();

  form.append('template', file);
  form.append('program_id', programId || '');
  form.append('variant_id', variantId || '');
  form.append('name', templateName || version || '');

  const response = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function listTemplates(options = {}) {
  const normalizedOptions =
    typeof options === 'object' && options !== null
      ? options
      : { programId: options };
  const programId = normalizedOptions.programId || '';
  const variantId = normalizedOptions.variantId || '';
  const params = new URLSearchParams();

  if (variantId) {
    params.set('variantId', String(variantId));
  } else if (programId) {
    params.set('programId', String(programId));
  }

  const response = await fetch(
    `${API_BASE}/templates?${params.toString()}`
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function activateTemplate(templateId) {
  const response = await fetch(
    `${API_BASE}/templates/${templateId}/activate`,
    { method: 'PUT' }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function renameTemplate(templateId, name) {
  const response = await fetch(`${API_BASE}/templates/${templateId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteTemplate(templateId) {
  const response = await fetch(`${API_BASE}/templates/${templateId}`, {
    method: 'DELETE'
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function downloadTemplate(templateId, fallbackName = null) {
  const response = await fetch(
    `${API_BASE}/templates/${templateId}/download`
  );

  await downloadApiFile(
    response,
    fallbackName || `template_${templateId}.docx`
  );
}

// Aliasurile vechi raman disponibile pana la noul editor.
export async function importAliases(pairs) {
  const response = await fetch(`${API_BASE}/aliases/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairs })
  });

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function listAliases() {
  const response = await fetch(`${API_BASE}/aliases`);

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}


// Configuratia noua de matching, legata de programul academic.

export async function getProgramMatchingConfig(programId) {
  const response = await fetch(
    `${API_BASE}/programs/${programId}/matching-config`
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function createProgramMatchingAlias(programId, payload) {
  const response = await fetch(
    `${API_BASE}/programs/${programId}/matching-aliases`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateProgramMatchingAlias(aliasId, payload) {
  const response = await fetch(
    `${API_BASE}/program-matching-aliases/${aliasId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteProgramMatchingAlias(aliasId) {
  const response = await fetch(
    `${API_BASE}/program-matching-aliases/${aliasId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function createProgramMatchingFamily(programId, payload) {
  const response = await fetch(
    `${API_BASE}/programs/${programId}/matching-families`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateProgramMatchingFamily(familyId, payload) {
  const response = await fetch(
    `${API_BASE}/program-matching-families/${familyId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteProgramMatchingFamily(familyId) {
  const response = await fetch(
    `${API_BASE}/program-matching-families/${familyId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function createProgramMatchingFamilyTerm(
  familyId,
  payload
) {
  const response = await fetch(
    `${API_BASE}/program-matching-families/${familyId}/terms`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateProgramMatchingFamilyTerm(termId, payload) {
  const response = await fetch(
    `${API_BASE}/program-matching-family-terms/${termId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteProgramMatchingFamilyTerm(termId) {
  const response = await fetch(
    `${API_BASE}/program-matching-family-terms/${termId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function createProgramMatchingDirectRule(
  programId,
  payload
) {
  const response = await fetch(
    `${API_BASE}/programs/${programId}/matching-direct-rules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function updateProgramMatchingDirectRule(ruleId, payload) {
  const response = await fetch(
    `${API_BASE}/program-matching-direct-rules/${ruleId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}

export async function deleteProgramMatchingDirectRule(ruleId) {
  const response = await fetch(
    `${API_BASE}/program-matching-direct-rules/${ruleId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json();
}
