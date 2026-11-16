// plans.js — the floor plans a visitor sends from the planner (W2W-264). Pure: which
// files are accepted, and the fields the website's inquiry handler expects. The limits
// mirror that handler (plinthmade.com /wp-json/plinth/v1/inquire): 10 files, 25 MB each.

export const PLAN_EXTS = ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'heic', 'zip'];
export const PLAN_MAX_BYTES = 25 * 1024 * 1024;
export const PLAN_MAX_FILES = 10;
export const PLANS_ENDPOINT = 'https://plinthmade.com/wp-json/plinth/v1/inquire';

const ext = (name) => (String(name || '').split('.').pop() || '').toLowerCase();

/** '' when the file can go, else why not (a sentence without its full stop). */
export function planFileProblem(file, already = []) {
  const name = file && file.name ? file.name : 'This file';
  if (!PLAN_EXTS.includes(ext(name)) || !String(name).includes('.')) return `${name} is not a PDF, DWG, DXF, image or ZIP`;
  if (!(file.size > 0)) return `${name} is empty`;
  if (file.size > PLAN_MAX_BYTES) return `${name} is over 25 MB`;
  if (already.some((f) => f.name === file.name && f.size === file.size)) return 'duplicate';
  if (already.length >= PLAN_MAX_FILES) return `${name} is over the limit of ${PLAN_MAX_FILES} files`;
  return '';
}

export function fileSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Why the form cannot go yet ('' when it can). */
export function plansFormProblem({ name, company, email, files }) {
  if (!String(name || '').trim()) return 'Add a contact name.';
  if (!String(company || '').trim()) return 'Add the company.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) return 'That email does not look right.';
  if (!files || !files.length) return 'Add at least 1 floor plan.';
  return '';
}

/**
 * The handler's field names: fn / ln (name split at the first space), em, co, un (units,
 * required there), kt (kitchen types: the unit mix typed into the estimate, and the link
 * code the visitor arrived with). Returns [key, value] pairs; the files go on as plans[].
 */
export function plansFields({ name, company, email, est = null, ref = '' }) {
  const parts = String(name).trim().split(/\s+/);
  const mix = est && est.lines && est.lines.length
    ? est.lines.map((l) => `${l.beds} ${l.units} x ${l.cabs} cabinets`).join(', ') : '';
  const kt = [mix && `From the quick estimate: ${mix}`, ref && `Link code: ${ref}`].filter(Boolean).join('. ');
  return [
    ['fn', parts[0]], ['ln', parts.slice(1).join(' ')], ['em', String(email).trim()], ['co', String(company).trim()],
    ['un', est && est.units ? String(est.units) : 'Not given'], ['kt', kt || 'Sent from the PL/NNER'],
  ];
}
