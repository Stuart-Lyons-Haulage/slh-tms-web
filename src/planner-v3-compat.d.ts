export {};

declare global {
  interface Object {
    /** Optional legacy/API timestamp used only for stable planner ordering. */
    readonly createdAtUtc?: string;
  }
}
