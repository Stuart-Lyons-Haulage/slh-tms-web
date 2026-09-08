export type SourceEvidence = {
  messageId: string;
  internetMessageId: string;
  displayId: string;
  subject: string;
  receivedAt: string;
  webLink: string;
};

function value(payload: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const candidate = String(payload[name] ?? "").trim();
    if (candidate) return candidate;
  }
  return "";
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function recipients(payload: Record<string, unknown>, field: string) {
  const source = payload[field];
  if (!Array.isArray(source)) return "";
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return String(record.address ?? record.emailAddress ?? record.name ?? "").trim();
    })
    .filter(Boolean)
    .join(", ");
}

function attachmentNames(payload: Record<string, unknown>) {
  const source = payload.sourceAttachments;
  if (!Array.isArray(source)) return "";
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (record.isInline === true) return "";
      const name = String(record.name ?? "").trim();
      const size = Number(record.size ?? 0);
      return name ? `${name}${Number.isFinite(size) && size > 0 ? ` (${Math.ceil(size / 1024)} KB)` : ""}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

function buildSnapshotLink(payload: Record<string, unknown>, originalWebLink: string, subject: string, receivedAt: string) {
  const body = value(payload, "sourceBodyText", "sourceEmailBodyText", "sourceBodyPreview");
  if (!body) return originalWebLink;

  const senderName = value(payload, "sourceSenderName");
  const sender = value(payload, "sourceSender");
  const to = recipients(payload, "sourceToRecipients");
  const cc = recipients(payload, "sourceCcRecipients");
  const attachments = attachmentNames(payload);
  const truncated = payload.sourceBodyPreviewTruncated === true;
  const originalLink = /^https?:\/\//i.test(originalWebLink)
    ? `<p><a href="${escapeHtml(originalWebLink)}" target="_blank" rel="noreferrer">Open original message in Outlook</a></p>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject || "Source email")}</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:32px auto;padding:0 24px;color:#17324d}dl{display:grid;grid-template-columns:110px 1fr;gap:8px 16px;background:#f6f8fa;border:1px solid #d8e0e8;border-radius:10px;padding:18px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 Arial,sans-serif;border:1px solid #d8e0e8;border-radius:10px;padding:20px;background:#fff}.note{background:#fff4d6;border:1px solid #e8c76b;border-radius:8px;padding:10px 12px}</style></head><body><h1>Source email</h1><dl><dt>Subject</dt><dd>${escapeHtml(subject || "—")}</dd><dt>From</dt><dd>${escapeHtml([senderName, sender].filter(Boolean).join(" · ") || "—")}</dd><dt>Received</dt><dd>${escapeHtml(receivedAt || "—")}</dd>${to ? `<dt>To</dt><dd>${escapeHtml(to)}</dd>` : ""}${cc ? `<dt>Cc</dt><dd>${escapeHtml(cc)}</dd>` : ""}${attachments ? `<dt>Attachments</dt><dd>${escapeHtml(attachments)}</dd>` : ""}</dl>${truncated ? '<p class="note">The retained review copy is a shortened body preview. Use the Outlook link below for the complete original message.</p>' : ""}<pre>${escapeHtml(body)}</pre>${originalLink}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function resolveSourceEvidence(payload: Record<string, unknown>): SourceEvidence {
  const messageId = value(payload, "sourceMessageId", "sourceEmailMessageId", "messageId");
  const internetMessageId = value(payload, "sourceInternetMessageId", "internetMessageId");
  const subject = value(payload, "sourceSubject", "sourceEmailSubject", "subject");
  const receivedAt = value(payload, "sourceReceivedAtUtc", "sourceEmailReceivedAt", "receivedAt");
  const originalWebLink = value(payload, "sourceWebLink", "sourceEmailWebLink", "webLink");
  return {
    messageId,
    internetMessageId,
    displayId: internetMessageId || messageId,
    subject,
    receivedAt,
    webLink: buildSnapshotLink(payload, originalWebLink, subject, receivedAt),
  };
}
