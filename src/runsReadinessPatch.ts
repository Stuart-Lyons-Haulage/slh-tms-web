import { request } from "./lib/api";
import { intelligenceApi, type ReadinessResponse } from "./lib/intelligenceApi";

intelligenceApi.readiness = (date: string, token?: string) =>
  request<ReadinessResponse>(`/api/v1/runs/readiness?date=${encodeURIComponent(date)}`, token, undefined, 40000);
