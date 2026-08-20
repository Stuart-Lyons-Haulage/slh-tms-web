import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Start typing…",
  disabled = false,
  ariaLabel,
  className,
}: SearchableSelectProps) {
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) setQuery(selected?.label || "");
  }, [open, selected?.label]);

  const filtered = useMemo(() => {
    const needle = normalise(query);
    const selectedLabel = normalise(selected?.label || "");
    if (!needle || needle === selectedLabel) return options;

    return options
      .filter((option) => normalise(`${option.label} ${option.searchText || ""}`).includes(needle))
      .sort((left, right) => {
        const leftLabel = normalise(left.label);
        const rightLabel = normalise(right.label);
        const leftStarts = leftLabel.startsWith(needle) ? 0 : 1;
        const rightStarts = rightLabel.startsWith(needle) ? 0 : 1;
        return leftStarts - rightStarts || left.label.localeCompare(right.label);
      });
  }, [options, query, selected?.label]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [activeIndex, filtered.length]);

  function choose(option: SearchableOption) {
    if (option.disabled) return;
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selected?.label || "");
    }
  }

  return <div className={className} style={{ position: "relative", width: "100%", minWidth: 0 }}>
    <input
      role="combobox"
      aria-label={ariaLabel || placeholder}
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      autoComplete="off"
      disabled={disabled}
      value={query}
      placeholder={placeholder}
      onFocus={(event) => {
        setOpen(true);
        setActiveIndex(0);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setQuery(next);
        setOpen(true);
        setActiveIndex(0);
        if (!next.trim()) onChange("");
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => window.setTimeout(() => {
        setOpen(false);
        setQuery(options.find((option) => option.value === value)?.label || "");
      }, 120)}
      style={{ width: "100%" }}
    />
    {open && !disabled && <div
      id={listId}
      role="listbox"
      style={{
        position: "absolute",
        zIndex: 80,
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        maxHeight: 260,
        overflowY: "auto",
        border: "1px solid #cbd5dc",
        borderRadius: 8,
        background: "#fff",
        boxShadow: "0 12px 28px rgba(15, 40, 55, .16)",
        padding: 4,
      }}
    >
      {filtered.length ? filtered.slice(0, 60).map((option, index) => <button
        key={option.value}
        type="button"
        role="option"
        aria-selected={option.value === value}
        disabled={option.disabled}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(option)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          border: 0,
          borderRadius: 6,
          padding: "8px 10px",
          background: index === activeIndex || option.value === value ? "#eef5f7" : "transparent",
          color: "inherit",
          cursor: option.disabled ? "not-allowed" : "pointer",
        }}
      >{option.label}</button>) : <div style={{ padding: "8px 10px", color: "#667784" }}>No matching options</div>}
    </div>}
  </div>;
}
