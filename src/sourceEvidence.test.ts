import { describe, expect, it } from "vitest";
import * as sourceEvidenceModule from "./sourceEvidence";

describe("resolveSourceEvidence", () => {
  it("keeps existing review rows linked when the API uses sourceEmail field names", () => {
    // Production defect caught: mapping-exception rows store sourceEmailWebLink,
    // while the review screen only reads sourceWebLink and hides the evidence link.
    const resolve = (sourceEvidenceModule as {
      resolveSourceEvidence?: (payload: Record<string, unknown>) => {
        messageId: string;
        internetMessageId: string;
        displayId: string;
        subject: string;
        receivedAt: string;
        webLink: string;
      };
    }).resolveSourceEvidence;

    expect(resolve?.({
      sourceEmailMessageId: "outlook-123",
      sourceInternetMessageId: "<mail-123@example.com>",
      sourceEmailSubject: "Order 456",
      sourceEmailReceivedAt: "2026-08-27T08:15:00Z",
      sourceEmailWebLink: "https://outlook.office365.com/message/123",
    })).toEqual({
      messageId: "outlook-123",
      internetMessageId: "<mail-123@example.com>",
      displayId: "<mail-123@example.com>",
      subject: "Order 456",
      receivedAt: "2026-08-27T08:15:00Z",
      webLink: "https://outlook.office365.com/message/123",
    });
  });

  it("prefers the established source fields when both contracts are present", () => {
    const resolve = (sourceEvidenceModule as {
      resolveSourceEvidence?: (payload: Record<string, unknown>) => {
        messageId: string;
        internetMessageId: string;
        displayId: string;
        subject: string;
        receivedAt: string;
        webLink: string;
      };
    }).resolveSourceEvidence;

    expect(resolve?.({
      sourceMessageId: "current-id",
      sourceInternetMessageId: "<current@example.com>",
      sourceEmailMessageId: "legacy-id",
      sourceSubject: "Current subject",
      sourceEmailSubject: "Legacy subject",
      sourceReceivedAtUtc: "2026-08-27T09:00:00Z",
      sourceEmailReceivedAt: "2026-08-27T08:00:00Z",
      sourceWebLink: "https://outlook/current",
      sourceEmailWebLink: "https://outlook/legacy",
    })).toEqual({
      messageId: "current-id",
      internetMessageId: "<current@example.com>",
      displayId: "<current@example.com>",
      subject: "Current subject",
      receivedAt: "2026-08-27T09:00:00Z",
      webLink: "https://outlook/current",
    });
  });
});