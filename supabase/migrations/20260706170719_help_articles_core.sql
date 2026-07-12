-- Turns the previously-static FAQ/Job Aide content (src/lib/helpCenterContent.ts) into DB-backed,
-- platform_admin-authored content, so Help Center copy can be updated without a code deploy. No
-- organization_id: like packages/training content authored by platform_admin, this is shared
-- reference material for every organization, not tenant data.
--
-- `content` is jsonb because the two article types have genuinely different shapes (FAQ: just an
-- answer string; job aide: summary/audience/steps/tips/relatedRoute) -- a single flexible column
-- beats two near-duplicate tables or a wide table full of type-specific nullable columns.
create table public.help_articles (
  id            uuid primary key default gen_random_uuid(),
  article_type  text not null constraint help_articles_article_type_check check (article_type in ('faq', 'job_aide')),
  category      text not null,
  title         text not null,
  sort_order    integer not null default 0,
  is_published  boolean not null default true,
  content       jsonb not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index help_articles_type_idx on public.help_articles(article_type, is_published, sort_order);

create trigger set_updated_at before update on public.help_articles
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.help_articles
  for each row execute function public.audit_log_trigger();

alter table public.help_articles enable row level security;

-- Every authenticated user reads published articles; platform_admin also sees unpublished drafts
-- (so a new article can be written and previewed before going live) and is the only writer.
create policy help_articles_select on public.help_articles
  for select to authenticated
  using (is_published or public.is_platform_admin());

create policy help_articles_write on public.help_articles
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
