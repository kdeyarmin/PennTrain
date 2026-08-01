import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row {
  id: string;
  name: string;
  status: string;
}

const ROWS: Row[] = [
  { id: "a", name: "Fire extinguisher", status: "compliant" },
  { id: "b", name: "Smoke alarm", status: "expired" },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: "name", header: "Item", cell: (row) => row.name, sortField: "name" },
  { id: "status", header: "Status", cell: (row) => row.status },
];

function render(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return renderToStaticMarkup(
    <DataTable<Row>
      rows={ROWS}
      totalCount={ROWS.length}
      getRowId={(row) => row.id}
      columns={COLUMNS}
      page={1}
      pageSize={15}
      onPageChange={() => undefined}
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("renders rows and the record count", () => {
    const html = render();
    expect(html).toContain("Fire extinguisher");
    expect(html).toContain("Smoke alarm");
    expect(html).toContain("2 records");
  });

  it("singularizes the record count", () => {
    expect(render({ rows: [ROWS[0]], totalCount: 1 })).toContain("1 record<");
  });

  it("shows the shared error state instead of an empty table when a load fails", () => {
    // The whole point of routing through QueryError: a failed list must not look like
    // "no records found".
    const html = render({ rows: [], totalCount: 0, error: new Error("boom"), errorLabel: "inspection items" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t load inspection items");
    expect(html).not.toContain("No records found");
  });

  it("prefers the error state over the loading state", () => {
    const html = render({ rows: [], totalCount: 0, isLoading: true, error: new Error("boom") });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Loading records");
  });

  it("announces loading to assistive tech rather than rendering an empty list", () => {
    const html = render({ rows: [], totalCount: 0, isLoading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading records");
    expect(html).not.toContain("No records found");
  });

  it("renders the empty state with its optional action", () => {
    const html = render({
      rows: [],
      totalCount: 0,
      emptyTitle: "No inspection items found",
      emptyDescription: "Add an item to get started.",
      emptyAction: <button type="button">Add Item</button>,
    });
    expect(html).toContain("No inspection items found");
    expect(html).toContain("Add Item");
  });

  it("exposes a labelled select-all only when selection is wired up", () => {
    expect(render()).not.toContain("Select current page");
    const selectable = render({
      selectedIds: new Set(["a"]),
      onSelectedIdsChange: () => undefined,
    });
    expect(selectable).toContain("Select current page");
    expect(selectable).toContain('data-state="selected"');
  });

  it("marks the sorted column and keeps paging controls labelled", () => {
    const html = render({ sortField: "name", sortDir: "desc", onSort: () => undefined });
    expect(html).toContain("↓");
    expect(html).toContain("Previous page");
    expect(html).toContain("Next page");
  });

  it("reports the page count from totalCount, not the rows on screen", () => {
    // 41 records at 15/page is 3 pages even though only 2 rows were passed in.
    expect(render({ totalCount: 41 })).toContain("Page 1 of 3");
  });
});
