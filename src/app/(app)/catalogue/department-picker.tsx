"use client";

import { useRouter } from "next/navigation";

/**
 * Which department's catalogue you are looking at. Any manager can browse
 * every department -- knowing what another team does is useful and harmless --
 * but editing stays with your own, enforced on the server either way.
 */
export function DepartmentPicker({
  departments,
  current,
}: {
  departments: { id: string; name: string }[];
  current: string;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2">
      <span className="eyebrow">Department</span>
      <select
        value={current}
        onChange={(e) => router.push(`/catalogue?dept=${e.target.value}`)}
        className="field w-auto min-w-[210px]"
      >
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
