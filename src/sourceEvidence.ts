export type SourceEvidence = {
  messageId: string;
  internetMessageId: string;
  displayId: string;
  subject: string;
  receivedAt: string;
  webLink: string;
};

export function resolveSourceEvidence(payload: Record<string, unknown>): SourceEvidence {
  const messageId = String(payload.sourceMessageId ?? payload.sourceEmailMessageId ?? payload.messageId ?? '');
  const internetMessageId = String(payload.sourceInternetMessageId ?? payload.internetMessageId ?? '');
  return {
    messageId,
    internetMessageId,
    displayId: internetMessageId || messageId,
    subject: String(payload.sourceSubject ?? payload.sourceEmailSubject ?? payload.subject ?? ''),
    receivedAt: String(payload.sourceReceivedAtUtc ?? payload.sourceEmailReceivedAt ?? payload.receivedAt ?? ''),
    webLink: String(payload.sourceWebLink ?? payload.sourceEmailWebLink ?? payload.webLink ?? ''),
  };
}
