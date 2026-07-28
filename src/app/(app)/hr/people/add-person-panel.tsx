"use client";

import { useState } from "react";
import { NewPersonForm } from "./new-person-form";

/**
 * The add-person form is full width rather than a sidebar: a weekly timetable
 * is four time inputs across seven rows, and that will not fit in a column
 * narrow enough to sit beside the list.
 */
export function AddPersonPanel({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary"
      >
        + Add someone
      </button>
    );
  }

  return (
    <section className="card mb-5 w-full">
      <header className="card-head">
        <span className="eyebrow">Add someone</span>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-sm">
          Close
        </button>
      </header>
      <div className="card-body">
        <NewPersonForm departments={departments} onDone={() => setOpen(false)} />
      </div>
    </section>
  );
}
