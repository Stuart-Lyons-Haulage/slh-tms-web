import { useMsal } from "@azure/msal-react";
import { useState } from "react";
import {
  api,
  type MailboxAttachment,
  type MailboxEmailIntakeRequest,
} from "../lib/api";
import { useAccessToken } from "../lib/auth";

const mailboxQueueListId =
  import.meta.env.VITE_MAILBOX_INTAKE_LIST_ID ||
  "78db5249-de29-4134-8db0-79e1fe9d84c6";
const mailboxQueueHost =
  import.meta.env.VITE_MAILBOX_INTAKE_HOST ||
  "stuartlyonshaulage.sharepoint.com";
const mailboxAddress =
  import.meta.env.VITE_MAILBOX_INTAKE_ADDRESS || "info@lyonshaulage.com";
const graphScopes = [
  import.meta.env.VITE_GRAPH_SITES_SCOPE || "Sites.ReadWrite.All",
  import.meta.env.VITE_GRAPH_MAIL_SCOPE || "Mail.Read.Shared",
];

type MailboxQueueItem = {
  id: string;
  subject: string;
  sender?: string;
  senderEmail?: string;
  receivedAt?: string;
  classification?: string;
  plannerStatus?: string;
  messageId?: string;
};

type PlannerImportResult = {
  imported: number;
  existing: number;
  needsReview: MailboxQueueItem[];
  warnings: string[];
};

function fieldValue(
  fields: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  const normalise = (value: string) =>
    value.replace(/_x0020_/gi, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const name of names) {
    const direct = fields[name];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  for (const [key, value] of Object.entries(fields)) {
    if (names.some((name) => normalise(name) === normalise(key))) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
  }
  return undefined;
}

async function graphJson<T>(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Microsoft returned ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function readMailboxQueue(graphToken: string): Promise<MailboxQueueItem[]> {
  const site = await graphJson<{ id: string }>(
    `/sites/${mailboxQueueHost}:/`,
    graphToken,
  );
  const result = await graphJson<{
    value: Array<{ id: string; fields?: Record<string, unknown> }>;
  }>(
    `/sites/${encodeURIComponent(site.id)}/lists/${encodeURIComponent(mailboxQueueListId)}/items?$expand=fields&$top=100`,
    graphToken,
  );
  return result.value.map((item) => {
    const fields = item.fields || {};
    return {
      id: item.id,
      subject:
        fieldValue(fields, "Email Subject", "EmailSubject", "Title") ||
        "No subject",
      sender: fieldValue(fields, "Sender"),
      senderEmail: fieldValue(fields, "Sender Email", "SenderEmail"),
      receivedAt: fieldValue(fields, "Received At", "ReceivedAt"),
      classification: fieldValue(fields, "Classification"),
      plannerStatus: fieldValue(fields, "Planner Status", "PlannerStatus"),
      messageId: fieldValue(fields, "Outlook Message ID", "OutlookMessageID"),
    };
  });
}

async function readMailboxMessage(
  queueItem: MailboxQueueItem,
  graphToken: string,
): Promise<MailboxEmailIntakeRequest> {
  if (!queueItem.messageId)
    throw new Error("The queue item has no Outlook message ID.");
  const messageId = encodeURIComponent(queueItem.messageId);
  const message = await graphJson<{
    id: string;
    internetMessageId?: string;
    subject?: string;
    receivedDateTime?: string;
    bodyPreview?: string;
    webLink?: string;
    from?: { emailAddress?: { address?: string; name?: string } };
    body?: { content?: string };
  }>(
    `/users/${encodeURIComponent(mailboxAddress)}/messages/${messageId}?$select=id,internetMessageId,subject,receivedDateTime,from,body,bodyPreview,webLink`,
    graphToken,
  );
  const attachmentsResult = await graphJson<{
    value: Array<{
      name?: string;
      contentType?: string;
      contentBytes?: string;
      isInline?: boolean;
      "@odata.type"?: string;
    }>;
  }>(
    `/users/${encodeURIComponent(mailboxAddress)}/messages/${messageId}/attachments?$top=20`,
    graphToken,
  );
  const attachments: MailboxAttachment[] = (attachmentsResult.value || [])
    .filter((attachment) => attachment["@odata.type"]?.includes("fileAttachment"))
    .map((attachment) => ({
      name: attachment.name,
      contentType: attachment.contentType,
      contentBase64: attachment.contentBytes,
      isInline: attachment.isInline,
    }));
  return {
    messageId: message.id,
    internetMessageId: message.internetMessageId,
    mailbox: mailboxAddress,
    senderAddress: message.from?.emailAddress?.address || queueItem.senderEmail,
    senderName: message.from?.emailAddress?.name || queueItem.sender,
    subject: message.subject || queueItem.subject,
    receivedAtUtc: message.receivedDateTime || queueItem.receivedAt,
    bodyText: message.bodyPreview,
    bodyHtml: message.body?.content,
    webLink: message.webLink,
    attachments,
  };
}

function isAmendmentQueueItem(item: MailboxQueueItem) {
  const text = `${item.subject} ${item.classification || ""}`.toLowerCase();
  return /\b(amend|update|change|revised|cancel|eta|delay|resched|correction)\b/.test(
    text,
  );
}

function ignoredEmailNeedsReview(reason?: string) {
  const text = (reason || "").toLowerCase();
  return /manual review|requires|could not be parsed|no transport order|workbook content was not supplied|no .* rows/.test(text);
}

function canContinueAfterApprovalError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || "");
  return /409|already|Only PendingReview|preorder_not_ready|awaiting customer instruction|cannot be accepted/i.test(text);
}

export function PlannerMailboxImport({
  planningDate,
  onImported,
}: {
  planningDate: string;
  onImported?: () => Promise<void> | void;
}) {
  const { instance, accounts } = useMsal();
  const token = useAccessToken();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlannerImportResult>();
  const [message, setMessage] = useState<string>();
  const account = instance.getActiveAccount() || accounts[0];

  async function graphToken() {
    if (!account)
      throw new Error("Your Microsoft sign-in has expired. Please sign in again.");
    try {
      return (
        await instance.acquireTokenSilent({ account, scopes: graphScopes })
      ).accessToken;
    } catch {
      return (
        await instance.acquireTokenPopup({ account, scopes: graphScopes })
      ).accessToken;
    }
  }

  async function importOrders() {
    setRunning(true);
    setMessage(undefined);
    setResult(undefined);
    const needsReview: MailboxQueueItem[] = [];
    const warnings: string[] = [];
    let imported = 0;
    let existing = 0;
    try {
      const graphAccessToken = await graphToken();
      const apiToken = await token();
      const queue = await readMailboxQueue(graphAccessToken);
      const candidates = queue.filter((item) => {
        const status = (item.plannerStatus || "").toLowerCase();
        return !status.includes("imported") && !status.includes("complete");
      });
      for (const item of candidates) {
        try {
          if (isAmendmentQueueItem(item)) {
            needsReview.push(item);
            continue;
          }
          const mailboxEmail = await readMailboxMessage(item, graphAccessToken);
          const preview = await api.previewMailboxEmail(mailboxEmail, apiToken);
          if (preview.ignored) {
            if (ignoredEmailNeedsReview(preview.ignoredReason)) needsReview.push(item);
            continue;
          }
          if (!preview.orders.length) {
            needsReview.push(item);
            continue;
          }
          if (!preview.orders.some((order) => String(order.payload.collectionDate || "") === planningDate)) {
            needsReview.push(item);
            continue;
          }
          const intake = await api.intakeMailboxEmail(mailboxEmail, apiToken);
          existing += intake.existing || 0;
          for (const record of intake.records || []) {
            try {
              await api.approveStaging(
                record.stagingId,
                `Imported from info mailbox queue for ${planningDate}.`,
                apiToken,
              );
              imported++;
            } catch (exception) {
              const detail =
                exception instanceof Error
                  ? exception.message
                  : "Already reviewed or not ready.";
              if (canContinueAfterApprovalError(exception)) existing++;
              else
                warnings.push(`${item.subject}: ${detail}`);
            }
          }
        } catch (exception) {
          needsReview.push(item);
          warnings.push(
            `${item.subject}: ${
              exception instanceof Error
                ? exception.message
                : "Could not import this email."
            }`,
          );
        }
      }
      setResult({ imported, existing, needsReview, warnings });
      setMessage(
        `${imported} order${imported === 1 ? "" : "s"} imported for ${planningDate}. ${existing} already existed. ${needsReview.length} email${needsReview.length === 1 ? "" : "s"} need planner review.`,
      );
      await onImported?.();
    } catch (exception) {
      setMessage(
        exception instanceof Error
          ? exception.message
          : "The mailbox import could not run.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel planner-import-panel">
      <div className="title-row compact-title-row">
        <div>
          <p className="eyebrow">Info mailbox</p>
          <h2>Import orders for {planningDate}</h2>
          <p className="hint">
            Reads the mailbox queue and adds clean customer orders to Orders to
            Plan. Amendments stay visible for planner review.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => void importOrders()}
          disabled={running}
        >
          {running ? "Importing..." : "Import orders"}
        </button>
      </div>
      {message && <p className="notice inline-notice">{message}</p>}
      {result && result.needsReview.length > 0 && (
        <div className="amendment-list">
          <h3>Amendments or needs review</h3>
          {result.needsReview.slice(0, 8).map((item) => (
            <article key={item.id}>
              <strong>{item.subject}</strong>
              <small>
                {item.sender || item.senderEmail || "Unknown sender"} ·{" "}
                {item.receivedAt
                  ? new Date(item.receivedAt).toLocaleString()
                  : "No received time"}
              </small>
            </article>
          ))}
        </div>
      )}
      {result && result.warnings.length > 0 && (
        <div className="import-issues">
          <strong>Import warnings</strong>
          <ul>
            {result.warnings.slice(0, 6).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
