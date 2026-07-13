-- Keep the stored facility_type code "ALR", but use the organization's ALF terminology in
-- customer-facing seeded content.
update public.courses
set category = 'Assisted Living Facilities'
where category = 'Assisted Living Residences';

update public.help_articles
set content = jsonb_set(
  content,
  '{answer}',
  to_jsonb(replace(content ->> 'answer', 'assisted living residences', 'assisted living facilities'))
)
where article_type = 'faq'
  and content ->> 'answer' like '%assisted living residences%';
