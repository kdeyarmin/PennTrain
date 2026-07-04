export type ExportRow = Record<string, string | number | boolean | null | undefined>;

function escapeCsv(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toCsv(rows: ExportRow[]) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(header => escapeCsv(row[header])).join(','))].join('\n');
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildComplianceBinderHtml(input: {
  organization: string;
  facility: string;
  dateRange: string;
  sections: string[];
  generatedAt: string;
  summary: string;
}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Compliance Binder</title><style>body{font-family:Inter,Arial,sans-serif;margin:40px;color:#0f172a}h1{color:#0f766e}.toc li{margin:8px 0}.section{page-break-before:always;border-top:1px solid #cbd5e1;padding-top:24px}.muted{color:#64748b}</style></head><body><h1>CareMetric Train Compliance Binder</h1><p><strong>Organization:</strong> ${escapeHtml(input.organization)}</p><p><strong>Facility:</strong> ${escapeHtml(input.facility)}</p><p><strong>Date range:</strong> ${escapeHtml(input.dateRange)}</p><p class="muted">Generated ${escapeHtml(input.generatedAt)}</p><h2>Table of contents</h2><ol class="toc">${input.sections.map(section => `<li>${escapeHtml(section)}</li>`).join('')}</ol><div class="section"><h2>Facility compliance dashboard</h2><p>${escapeHtml(input.summary)}</p></div>${input.sections.map(section => `<div class="section"><h2>${escapeHtml(section)}</h2><p>Exported evidence index, completion dates, expiration dates, hours, status, and documentation indicators are included in the production packet for this section.</p></div>`).join('')}</body></html>`;
}

export function openPrintablePdf(html: string) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  return true;
}
