/** D5 — realistic PA facility sample CSVs shipped under public/import-samples/. */

export type ImportSample = {
  domain: "employees" | "training_records" | "credentials";
  label: string;
  href: string;
  fileName: string;
  description: string;
};

export const IMPORT_SAMPLES: readonly ImportSample[] = [
  {
    domain: "employees",
    label: "Employees (PA PCH)",
    href: "/import-samples/employees-sample-pa-pch.csv",
    fileName: "employees-sample-pa-pch.csv",
    description: "Five Harmony Personal Care Home staff with facility, job titles, and med-admin flags.",
  },
  {
    domain: "training_records",
    label: "Training records",
    href: "/import-samples/training_records-sample-pa-pch.csv",
    fileName: "training_records-sample-pa-pch.csv",
    description: "Annual fire, abuse, med-admin, and resident-rights completions keyed by employee_number.",
  },
  {
    domain: "credentials",
    label: "Credentials",
    href: "/import-samples/credentials-sample-pa-pch.csv",
    fileName: "credentials-sample-pa-pch.csv",
    description: "Act 33/34/73 clearances and TB screening examples for dry-run practice.",
  },
] as const;
