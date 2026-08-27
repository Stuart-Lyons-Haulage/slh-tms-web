const text = (value: unknown) => String(value ?? "").trim();

export function resolveSourceEvidence(payload: Record<string, unknown>) {
  const messageId = text(payload.sourceMessageId) || text(payload.sourceEmailMessageId);
  const internetMessageId = text(payload.sourceInternetMessageId);
  return {
    messageId,
    internetMessageId,
    displayId: internetMessageId || messageId,
    subject: text(payload.sourceSubject) || text(payload.sourceEmailSubject),
    receivedAt: text(payload.sourceReceivedAtUtc) || text(payload.sourceEmailReceivedAt),
    webLink: text(payload.sourceWebLink) || text(payload.sourceEmailWebLink),
  };
}