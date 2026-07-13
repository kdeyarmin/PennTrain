-- The five migrations reconstructed as 20260704190000-20260704230000 (quiz question
-- explanations/review, notification center, compliance alert coverage, course feedback,
-- training plan traceability) added nine new functions, none of which ever had their default
-- EXECUTE grant to `anon`/PUBLIC revoked the way 20260704180605_revoke_public_grant_on_
-- privileged_functions.sql did for the functions that existed before them. Confirmed live via
-- has_function_privilege('anon', ...): all nine are currently callable by anon, matching the
-- exact category of issue that migration fixed.
--
-- get_quiz_review/mark_notification_read/mark_all_notifications_read have their own internal
-- auth.uid()/ownership checks and are legitimately called by authenticated users directly (a
-- employee reviewing their quiz, marking their own notifications read) -- keep authenticated,
-- strip anon and the redundant PUBLIC grant.
revoke execute on function public.get_quiz_review(uuid) from public;
revoke execute on function public.get_quiz_review(uuid) from anon;
grant execute on function public.get_quiz_review(uuid) to authenticated;

revoke execute on function public.mark_notification_read(uuid) from public;
revoke execute on function public.mark_notification_read(uuid) from anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

revoke execute on function public.mark_all_notifications_read() from public;
revoke execute on function public.mark_all_notifications_read() from anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- These six only ever fire implicitly as AFTER triggers -- like audit_log_trigger()/
-- handle_new_user() before them, they should never be directly RPC-callable by anyone.
revoke execute on function public.normalize_answers_on_question_type_change() from public;
revoke execute on function public.normalize_answers_on_question_type_change() from anon;
revoke execute on function public.normalize_answers_on_question_type_change() from authenticated;

revoke execute on function public.notify_course_assigned() from public;
revoke execute on function public.notify_course_assigned() from anon;
revoke execute on function public.notify_course_assigned() from authenticated;

revoke execute on function public.notify_certificate_issued() from public;
revoke execute on function public.notify_certificate_issued() from anon;
revoke execute on function public.notify_certificate_issued() from authenticated;

revoke execute on function public.notify_competency_recorded() from public;
revoke execute on function public.notify_competency_recorded() from anon;
revoke execute on function public.notify_competency_recorded() from authenticated;

revoke execute on function public.notify_quiz_graded() from public;
revoke execute on function public.notify_quiz_graded() from anon;
revoke execute on function public.notify_quiz_graded() from authenticated;

revoke execute on function public.notify_training_alert() from public;
revoke execute on function public.notify_training_alert() from anon;
revoke execute on function public.notify_training_alert() from authenticated;
