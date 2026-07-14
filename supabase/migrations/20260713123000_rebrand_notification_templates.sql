-- Keep database-backed notification templates aligned with the CareMetric Train brand.
-- Existing deployments may already have the earlier CareMetric CareBase seed rows, so update
-- published/default templates in place rather than relying only on Edge Function fallback strings.
update public.notification_templates
set
  subject_template = replace(subject_template, 'CareMetric CareBase', 'CareMetric Train'),
  body_template = replace(body_template, 'CareMetric CareBase', 'CareMetric Train'),
  from_name = replace(from_name, 'CareMetric CareBase', 'CareMetric Train')
where subject_template like '%CareMetric CareBase%'
   or body_template like '%CareMetric CareBase%'
   or from_name like '%CareMetric CareBase%';
