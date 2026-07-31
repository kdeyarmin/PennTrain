### Release flags (pilot)
- Migration creates `carebase-pilot-2026` cohort and pre-enrolls demo orgs for:
  - `notifications.expanded_delivery_types`
  - `notifications.critical_multichannel`
  - `screening.on_hire_exclusion`
  - `learning.video_watch_gate`
- Flags are **enabled in cohort mode** (`rollout_mode=cohort`, `is_enabled=true`) on migration apply — operator equivalent of AAL2 `set_release_flag`. Non-demo orgs remain off until assigned to the cohort.
