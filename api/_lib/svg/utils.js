// ─── SVG Utility Functions ──────────────────────────────────────────────────────
// Funzioni utility di base per la generazione SVG

export function escapeXml(s) {
  return String(s ?? '').replace(
    /[<>&'\\"]/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[c]
  );
}
