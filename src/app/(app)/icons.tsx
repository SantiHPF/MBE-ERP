/**
 * The shell's icons, as data.
 *
 * Every one is a single path on a 0 0 16 16 viewBox at 1.4 stroke-width,
 * taken verbatim from the design prototype's ICONS map. No icon library and
 * no assets: nineteen strings weigh less than a dependency, and `currentColor`
 * means the active-nav colour change costs nothing.
 *
 * `perf` and `attendance` have no screens yet -- they arrive with
 * Rendimiento and Asistencia in sub-project 4. They live here now because the
 * map is one object, and splitting it across two passes would be worse than
 * carrying two unused strings.
 */
export const ICON_PATHS = {
  day: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M8 4.6V8l2.4 1.7",
  plan: "M2.5 2.5h11v11h-11zM2.5 6.2h11M6.2 6.2v7.3M9.9 6.2v7.3",
  calendar: "M2.5 3.6h11v10h-11zM2.5 6.6h11M5.4 1.9v2.4M10.6 1.9v2.4",
  meetings:
    "M5.8 7.2a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2M1.9 13.4c0-2.3 1.7-3.9 3.9-3.9s3.9 1.6 3.9 3.9M11 4.3a2 2 0 0 1 0 3.8M12.1 13.4c0-1.8-.6-3-1.6-3.7",
  p1n: "M8 2.3 14.4 13.4H1.6zM8 6.4v3.2M8 11.3h.01",
  messages: "M2.2 3.2h11.6v8.2H8l-3.4 2.6v-2.6H2.2z",
  team: "M4 6.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8M12 6.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8M1.6 13.4c0-1.8 1.1-3 2.4-3s2.4 1.2 2.4 3M9.6 13.4c0-1.8 1.1-3 2.4-3s2.4 1.2 2.4 3",
  triage: "M2.4 9.4h3l1 2h3.2l1-2h3M2.4 9.4 4.2 3h7.6l1.8 6.4v4H2.4z",
  catalogue: "M2.5 4h11M2.5 8h11M2.5 12h7",
  perf: "M2.5 13.4h11M4.6 11V6.8M8 11V3.4M11.4 11V8.6",
  attendance: "M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6M5.2 8.2l2 2 3.6-4.2",
  requests: "M2 4.4h12v7.8H2zM2 4.4l6 4.4 6-4.4",
  people: "M8 7.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8M2.9 13.7c0-2.6 2.3-4.4 5.1-4.4s5.1 1.8 5.1 4.4",
  sources: "M3 13.5V3.4h6.4v10.1M9.4 6.6H13v6.9M5 6h2.4M5 9h2.4M11 9h1",
  candidates: "M2.6 3h10.8L9.4 8.1v5.4l-2.8-1.5V8.1z",
  me: "M2 3.4h12v9.2H2zM5.6 8.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M3.4 11.4c0-1.2 1-1.9 2.2-1.9s2.2.7 2.2 1.9M9.9 6.7h2.4M9.9 9.2h2.4",
  mobile: "M5 1.8h6v12.4H5zM7 12.6h2",
  search: "M7.3 12.6a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6M14 14l-2.9-2.9",
  bell: "M8 1.9a3.9 3.9 0 0 0-3.9 3.9c0 4.1-1.4 5.2-1.4 5.2h10.6s-1.4-1.1-1.4-5.2A3.9 3.9 0 0 0 8 1.9M9.4 13.4a1.6 1.6 0 0 1-2.8 0",
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * `currentColor` and no explicit size: the icon inherits both from whatever
 * is drawing it, so the same node works in a nav link, a button and a table
 * cell without a variant for each.
 */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
