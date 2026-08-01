# Import Center sample CSVs (D5)

Realistic PA personal-care-home shaped samples for the Import and Data Migration Center.

| File | Domain | Notes |
| --- | --- | --- |
| `employees-sample-pa-pch.csv` | employees | 5 staff at a fictional Harmony PCH |
| `training_records-sample-pa-pch.csv` | training_records | Annual topics mapped to employee numbers |
| `credentials-sample-pa-pch.csv` | credentials | Act 33/34/73 + TB screening examples |

These are **samples for dry-run practice**, not production data. Facility and employee identifiers must match rows already present in the target org before apply succeeds.

Column order matches `importTemplate()` in `src/lib/dataImportCenter.ts`.
