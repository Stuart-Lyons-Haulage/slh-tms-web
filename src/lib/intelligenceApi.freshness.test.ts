import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { intelligenceApi } from "./intelligenceApi";

vi.mock("./api", () => ({ request: vi.fn() }));

const mockedRequest = vi.mocked(request);

function isoMinutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("system feed health", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it("uses the shared system-sync state instead of inventing different dashboard thresholds", async () => {
    mockedRequest.mockImplementation(async (url) => {
      if (url === "/api/v1/system-sync/state") {
        return {
          status: "current",
          generatedAtUtc: new Date().toISOString(),
          lastPlatformUpdateUtc: isoMinutesAgo(2),
          schedules: {
            dot: "continuous ingestion",
            tachoMaster: "every 5 minutes",
            sageHr: "05:30 Europe/London daily",
            fleetio: "every hour",
          },
          providers: [
            { name: "DOT / Falcon", configured: true, state: "current", lastUpdatedUtc: isoMinutesAgo(2), ageMinutes: 2 },
            { name: "TachoMaster", configured: true, state: "current", lastUpdatedUtc: isoMinutesAgo(4), ageMinutes: 4 },
            { name: "Sage HR", configured: true, state: "current", lastUpdatedUtc: isoMinutesAgo(600), ageMinutes: 600 },
            { name: "Fleetio", configured: true, state: "current", lastUpdatedUtc: isoMinutesAgo(30), ageMinutes: 30 },
          ],
        } as never;
      }
      if (url === "/api/v1/operations/confidence") {
        return {
          generatedAtUtc: new Date().toISOString(),
          sageHr: { lastSyncUtc: isoMinutesAgo(600) },
          tachoMaster: { lastSyncUtc: isoMinutesAgo(4) },
          dotTracking: { latestEventUtc: isoMinutesAgo(2) },
          emailIntake: { lastReceivedUtc: isoMinutesAgo(120) },
        } as never;
      }
      throw new Error(`Unexpected request ${url}`);
    });

    const result = await intelligenceApi.freshness("token");
    const byName = new Map(result.sources.map((feed) => [feed.name, feed]));

    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/system-sync/state", "token");
    expect(byName.get("Tracking")?.state).toBe("green");
    expect(byName.get("TachoMaster")?.state).toBe("green");
    expect(byName.get("Sage HR")?.state).toBe("green");
    expect(byName.get("Fleetio")?.state).toBe("green");
    expect(byName.get("Sage HR")?.ageMinutes).toBe(600);
  });

  it("does not call an event-driven mailbox feed failed simply because no order email arrived in the last hour", async () => {
    mockedRequest.mockImplementation(async (url) => {
      if (url === "/api/v1/system-sync/state") {
        return {
          status: "current",
          generatedAtUtc: new Date().toISOString(),
          schedules: { dot: "continuous ingestion", tachoMaster: "every 5 minutes", sageHr: "daily", fleetio: "hourly" },
          providers: [],
        } as never;
      }
      if (url === "/api/v1/operations/confidence") {
        return {
          generatedAtUtc: new Date().toISOString(),
          sageHr: {}, tachoMaster: {}, dotTracking: {},
          emailIntake: { lastReceivedUtc: isoMinutesAgo(48 * 60) },
        } as never;
      }
      throw new Error(`Unexpected request ${url}`);
    });

    const result = await intelligenceApi.freshness("token");
    const mailbox = result.sources.find((feed) => feed.name === "Info mailbox");

    expect(mailbox?.state).toBe("amber");
    expect(mailbox?.detail).toContain("event-driven");
  });

  it("uses the scheduled mailbox heartbeat as authoritative health even when a recent order email exists", async () => {
    mockedRequest.mockImplementation(async (url) => {
      if (url === "/api/v1/system-sync/state") {
        return {
          status: "attention",
          generatedAtUtc: new Date().toISOString(),
          schedules: {
            dot: "continuous ingestion",
            tachoMaster: "every 5 minutes",
            sageHr: "daily",
            fleetio: "hourly",
            infoMailbox: "every 5 minutes heartbeat",
          },
          providers: [
            { name: "Info mailbox", configured: true, state: "stale", lastUpdatedUtc: isoMinutesAgo(25), ageMinutes: 25 },
          ],
          mailbox: {
            mailbox: "info@lyonshaulage.com",
            lastHeartbeatUtc: isoMinutesAgo(25),
            heartbeatAgeMinutes: 25,
            latestInboxReceivedAtUtc: isoMinutesAgo(1),
            lastOrderReceivedUtc: isoMinutesAgo(1),
            heartbeatFlowName: "SLH-TMS | Info Mailbox | Heartbeat | PROD",
            heartbeatFlowRunId: "run-stale",
            probe: "shared Outlook mailbox read + TMS API write",
          },
        } as never;
      }
      if (url === "/api/v1/operations/confidence") {
        return {
          generatedAtUtc: new Date().toISOString(),
          sageHr: {}, tachoMaster: {}, dotTracking: {},
          emailIntake: { lastReceivedUtc: isoMinutesAgo(1) },
        } as never;
      }
      throw new Error(`Unexpected request ${url}`);
    });

    const result = await intelligenceApi.freshness("token");
    const mailboxFeeds = result.sources.filter((feed) => feed.name === "Info mailbox");

    expect(mailboxFeeds).toHaveLength(1);
    expect(mailboxFeeds[0].state).toBe("red");
    expect(mailboxFeeds[0].cadence).toBe("every 5 minutes heartbeat");
    expect(mailboxFeeds[0].detail?.toLowerCase()).toContain("heartbeat");
    expect(mailboxFeeds[0].detail).toContain("Outlook");
  });
});
