-- Refresh existing Help Center content with healthcare-appropriate documentation language.
-- The original seed is also updated so new environments start with the same wording.

create function public._refresh_help_center_healthcare_text(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select replace(
    regexp_replace(
      regexp_replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                replace(p_value,
                                  '/app/evidence', '__CAREBASE_REVIEW_ROUTE__'),
                                'Evidence Room', 'Review Room'),
                              'evidence room', 'review room'),
                            'Evidence packets', 'Review packets'),
                          'evidence packets', 'review packets'),
                        'Evidence packet', 'Review packet'),
                      'evidence packet', 'review packet'),
                    'Evidence documents', 'Supporting documents'),
                  'evidence documents', 'supporting documents'),
                'Evidence records', 'Supporting records'),
              'evidence records', 'supporting records'),
            'Evidence captured', 'Supporting documentation captured'),
          'evidence captured', 'supporting documentation captured'),
        E'\\mEvidence\\M', 'Documentation', 'g'),
      E'\\mevidence\\M', 'documentation', 'g'),
    '__CAREBASE_REVIEW_ROUTE__', '/app/evidence'
  );
$$;

create function public._refresh_help_center_healthcare_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select jsonb_object_agg(
        entry.key,
        case
          when entry.key = 'href' then entry.value
          else public._refresh_help_center_healthcare_json(entry.value)
        end
      )
      into v_result
      from jsonb_each(p_value) as entry;

      return coalesce(v_result, '{}'::jsonb);
    when 'array' then
      select jsonb_agg(
        public._refresh_help_center_healthcare_json(item.value)
        order by item.ordinality
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);

      return coalesce(v_result, '[]'::jsonb);
    when 'string' then
      return to_jsonb(public._refresh_help_center_healthcare_text(p_value #>> '{}'));
    else
      return p_value;
  end case;
end;
$$;

update public.help_articles
set content = public._refresh_help_center_healthcare_json(content)
where content::text ~* E'\\mevidence\\M';

drop function public._refresh_help_center_healthcare_json(jsonb);
drop function public._refresh_help_center_healthcare_text(text);
