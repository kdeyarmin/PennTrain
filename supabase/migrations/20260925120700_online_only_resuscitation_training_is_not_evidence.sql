-- Online-only first aid, CPR and obstructed-airway training cannot be verified as evidence.
--
-- BACKLOG.md REG36. 2600.63(b) / 2800.63(b) require "current training in first aid and
-- certification in obstructed airway techniques and CPR" from a certified trainer, and both
-- Regulatory Compliance Guides say, in their discussion of 63(b) (2600 RCG p.52, 2800 RCG p.64):
-- "Training that is conducted online with no hands-on practice does not provide the necessary
-- training to ensure the staff person is able to properly perform CPR or first aid and will not be
-- considered when measuring compliance."
--
-- `save_training_workspace_item('review', ...)` checked only that such evidence named a qualified
-- instructor and attached a document, so a certificate from an online-only course could be marked
-- verified, and the Train workspace then counted it toward the ALF's before-direct-care
-- prerequisite (2800.65(c)). A course with a hands-on skills session is recorded as `hybrid`, and a
-- certifying agency's card as `external`; neither is affected.
--
-- A trigger rather than a redeclared RPC: the review branch is one arm of a long definer function,
-- and every path that can make a row `verified` passes through this table. Rows already verified are
-- left as they are (reviewed evidence is immutable; the workspace voids and re-records), and the
-- workspace itself stops counting them as current.

create or replace function public.refuse_online_only_resuscitation_evidence()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status = 'verified'
     and (tg_op = 'INSERT' or old.status is distinct from 'verified')
     and new.delivery = 'online'
     and new.topics && array['first_aid', 'cpr', 'airway']::text[] then
    raise exception 'First aid, CPR and obstructed-airway training needs hands-on practice. DHS does not count an online-only course (2600.63(b) / 2800.63(b) RCG). Record the skills session as hybrid, or the certifying agency''s card as external'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

comment on function public.refuse_online_only_resuscitation_evidence() is
  'Refuses to verify online-only first aid / CPR / obstructed-airway evidence: both RCGs say such '
  'training "will not be considered when measuring compliance" with 2600.63 / 2800.63.';

revoke all on function public.refuse_online_only_resuscitation_evidence() from public, anon, authenticated;

drop trigger if exists refuse_online_only_resuscitation_evidence on public.training_evidence_events;
create trigger refuse_online_only_resuscitation_evidence
  before insert or update of status, delivery, topics on public.training_evidence_events
  for each row execute function public.refuse_online_only_resuscitation_evidence();
