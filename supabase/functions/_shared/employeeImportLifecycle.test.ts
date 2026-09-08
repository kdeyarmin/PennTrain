import { assertEquals } from "jsr:@std/assert@1.0.14";
import { stripEmployeeLifecycleFromImportUpdate } from "./employeeImportLifecycle.ts";

Deno.test("employee CSV update drops lifecycle columns even when they did not change", () => {
  const { payload, warnings } = stripEmployeeLifecycleFromImportUpdate(
    {
      organization_id: "org",
      facility_id: "fac-1",
      first_name: "Ada",
      status: "active",
      hire_date: "2024-01-01",
    },
    { facility_id: "fac-1", status: "active", hire_date: "2024-01-01" },
  );
  assertEquals(payload, { organization_id: "org", first_name: "Ada" });
  assertEquals(warnings, []);
});

Deno.test("employee CSV update warns instead of flipping status, hire date or facility", () => {
  const { payload, warnings } = stripEmployeeLifecycleFromImportUpdate(
    {
      organization_id: "org",
      facility_id: "fac-2",
      status: "active",
      hire_date: "2026-01-01",
      job_title: "Aide",
    },
    { facility_id: "fac-1", status: "on_leave", hire_date: "2024-01-01" },
  );
  assertEquals(payload, { organization_id: "org", job_title: "Aide" });
  assertEquals(warnings.length, 3);
});
