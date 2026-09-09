import type { DispatchFilter } from "./types";

type Props = {
  value: DispatchFilter;
  counts: Record<DispatchFilter, number>;
  onChange: (filter: DispatchFilter) => void;
};

const filters: Array<{ value: DispatchFilter; label: string }> = [
  { value: "all", label: "All drivers" },
  { value: "unallocated", label: "Unallocated" },
  { value: "backloads", label: "Backloads" },
  { value: "warnings", label: "Warnings" },
  { value: "skills-mismatch", label: "Skills mismatch" }
];

export function DispatchFilters({ value, counts, onChange }: Props) {
  return <div className="smart-dispatch-filters" role="group" aria-label="Dispatch filters">
    {filters.map(filter => <button
      key={filter.value}
      type="button"
      className={value === filter.value ? "active" : ""}
      aria-pressed={value === filter.value}
      onClick={() => onChange(filter.value)}
    >
      {filter.label}<span>{counts[filter.value]}</span>
    </button>)}
  </div>;
}
