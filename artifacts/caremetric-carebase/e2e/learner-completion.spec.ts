import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Request, type Route } from "@playwright/test";
import { hasLiveSupabaseEnv, signInAs } from "./helpers/auth";

const LESSON_TEXT = "This synthetic lesson teaches one action: report a concern to the supervisor. Read this orientation, watch the complete local video, and pass the knowledge check before recording that the training is complete.";

/** Setup only: completion, video watch state, and quiz attempts must come from the learner UI. */
async function provisionLearner(service: SupabaseClient, url: string, password: string) {
  const suffix = crypto.randomUUID();
  const { data: organization, error: organizationError } = await service.from("organizations").insert({
    name: `Learner completion ${suffix}`, slug: `learner-completion-${suffix}`, subscription_status: "active",
  }).select("id").single();
  if (organizationError) throw organizationError;
  const organizationId = organization.id;
  const { data: facility, error: facilityError } = await service.from("facilities").insert({
    organization_id: organizationId, name: "Learner completion facility", facility_type: "PCH",
  }).select("id").single();
  if (facilityError) throw facilityError;

  async function account(role: "employee" | "platform_admin") {
    const email = `learner-completion-${role}-${suffix}@test.local`;
    const { data, error } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { role, ...(role === "employee" ? { organization_id: organizationId } : {}) },
      user_metadata: { first_name: "Synthetic", last_name: "Learner" },
    });
    if (error || !data.user) throw error ?? new Error("Fixture account was not created");
    const { error: profileError } = await service.rpc("admin_update_profile", {
      p_user_id: data.user.id, p_role: role, p_is_active: true,
      ...(role === "employee" ? { p_organization_id: organizationId } : {}),
    });
    if (profileError) throw profileError;
    return { id: data.user.id, email };
  }
  const learner = await account("employee");
  const publisher = await account("platform_admin");
  const { data: employee, error: employeeError } = await service.from("employees").insert({
    organization_id: organizationId, facility_id: facility.id, profile_id: learner.id,
    first_name: "Synthetic", last_name: "Learner", email: learner.email,
    job_title: "Direct Care Worker", status: "active",
  }).select("id").single();
  if (employeeError) throw employeeError;

  const courseTitle = `Learner completion course ${suffix}`;
  const { data: course, error: courseError } = await service.from("courses").insert({
    organization_id: organizationId, title: courseTitle, status: "draft", estimated_duration_minutes: 1,
  }).select("id").single();
  if (courseError) throw courseError;
  const { data: version, error: versionError } = await service.from("course_versions").insert({
    course_id: course.id, organization_id: organizationId, version_number: 1,
    title: courseTitle, status: "draft", content_standard: "legacy",
  }).select("id").single();
  if (versionError) throw versionError;
  const textBlockId = crypto.randomUUID();
  const videoBlockId = crypto.randomUUID();
  const quizBlockId = crypto.randomUUID();
  const videoPath = `${organizationId}/${videoBlockId}.mp4`;
  const { error: uploadError } = await service.storage.from("course-videos").upload(
    videoPath, await readFile(new URL("./fixtures/course-videos/placeholder.mp4", import.meta.url)),
    { contentType: "video/mp4", upsert: false },
  );
  if (uploadError) throw uploadError;
  // PostgREST bulk inserts share one column list: omitted values become NULL when another
  // row supplies that column. Keep every row explicit, including the generated primary key.
  const { error: blocksError } = await service.from("course_blocks").insert([
    { id: textBlockId, course_version_id: version.id, organization_id: organizationId, block_type: "text", sort_order: 0,
      title: "Read the orientation", video_url: null, body: { content: LESSON_TEXT } },
    { id: videoBlockId, course_version_id: version.id, organization_id: organizationId, block_type: "video", sort_order: 1,
      title: "Watch the orientation", video_url: `storage://course-videos/${videoPath}`,
      body: { transcript: "Synthetic local video used to verify watched-through progress." } },
    { id: quizBlockId, course_version_id: version.id, organization_id: organizationId, block_type: "quiz", sort_order: 2,
      title: "Orientation check", video_url: null, body: {} },
  ]);
  if (blocksError) throw blocksError;
  // Org-scoped legacy authoring uses the same authenticated writes as useQuizzes.
  // The service role intentionally cannot write these tables. Governed draft RPCs apply
  // only to global drafts; using them here would change which authoring path is tested.
  const publisherClient = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await publisherClient.auth.signInWithPassword({ email: publisher.email, password });
  if (signInError) throw signInError;
  const { data: quiz, error: quizError } = await publisherClient.from("quizzes").insert({
    course_block_id: quizBlockId, organization_id: organizationId, title: "Orientation check",
    quiz_kind: "knowledge_check", passing_score_percent: 100, max_attempts: 3,
    shuffle_questions: true, shuffle_answers: true, reveals_answers_after_attempt: false,
  }).select("id").single();
  if (quizError) throw quizError;
  const { data: question, error: questionError } = await publisherClient.from("quiz_questions").insert({
    quiz_id: quiz.id, organization_id: organizationId, question_text: "What should you do with a concern?",
    question_type: "single_choice", sort_order: 0,
  }).select("id").single();
  if (questionError) throw questionError;
  const { error: answersError } = await publisherClient.from("quiz_answers").insert([
    { question_id: question.id, organization_id: organizationId, answer_text: "Report it to the supervisor", is_correct: true, sort_order: 0 },
    { question_id: question.id, organization_id: organizationId, answer_text: "Ignore it", is_correct: false, sort_order: 1 },
  ]);
  if (answersError) throw answersError;

  // Use ordinary publication and assignment authorization; never bypass the readiness checks.
  const { error: publicationError } = await publisherClient.rpc("publish_course_version", { p_course_version_id: version.id });
  if (publicationError) throw publicationError;
  const { error: activationError } = await publisherClient.from("courses").update({ status: "published" }).eq("id", course.id);
  if (activationError) throw activationError;
  const { data: assignment, error: assignmentError } = await publisherClient.from("course_assignments").insert({
    organization_id: organizationId, facility_id: facility.id, employee_id: employee.id,
    course_id: course.id, course_version_id: version.id, assigned_by: publisher.id,
  }).select("id").single();
  if (assignmentError) throw assignmentError;
  await publisherClient.auth.signOut();
  return { learner, courseTitle, assignmentId: assignment.id, quizId: quiz.id, videoBlockId, quizBlockId };
}

test.describe("learner course completion", () => {
  test.skip(!hasLiveSupabaseEnv(), "local Supabase test credentials required");

  test("required video and quiz lead to a real learner-issued certificate", async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    const url = process.env.SUPABASE_URL!;
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    expect(new URL(String(testInfo.project.use.baseURL)).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = process.env.E2E_ACCOUNT_PASSWORD!;
    const fixture = await provisionLearner(service, url, password);
    // Read back evidence through the learner's own RLS boundary. Service-role SELECT on
    // course_progress is intentionally revoked, and no elevated evidence access is needed.
    const learnerClient = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: learnerSignInError } = await learnerClient.auth.signInWithPassword({ email: fixture.learner.email, password });
    if (learnerSignInError) throw learnerSignInError;
    page.setDefaultTimeout(15_000);

    await test.step("the assigned learner reads the lesson and must watch the video", async () => {
      await signInAs(page, fixture.learner.email, password, "/me");
      await page.goto("/me/courses");
      await expect(page.getByText(fixture.courseTitle, { exact: true })).toBeVisible();
      await page.locator(`a[href="/me/courses/${fixture.assignmentId}"]`).click();
      await expect(page.getByText(LESSON_TEXT, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      await expect(page.getByText("Watch the video above to continue.", { exact: true })).toBeVisible();
      const video = page.locator("video");
      await expect(video).toBeVisible();
      // Use native media playback at normal speed; never seek, dispatch completion, or seed watch state.
      await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
      await expect(page.getByText("Video watched -- you can continue.", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("button", { name: "Mark Training Complete", exact: true })).toBeDisabled();
    });

    await test.step("a failed quiz keeps completion locked and a successful retake unlocks it", async () => {
      await page.getByRole("link", { name: "Take Quiz", exact: true }).click();
      await page.getByRole("button", { name: "Start Quiz", exact: true }).click();
      await expect(page.getByRole("button", { name: "Submit Quiz", exact: true })).toBeDisabled();
      await page.getByRole("radio", { name: "Ignore it", exact: true }).check();
      await page.getByRole("button", { name: "Submit Quiz", exact: true }).click();
      await expect(page.getByText("You did not pass", { exact: true })).toBeVisible();
      const readOwnProgress = async () => {
        const { data, error } = await learnerClient.from("course_progress")
          .select("last_block_id,percent_complete,video_state,learning_tools").eq("assignment_id", fixture.assignmentId).single();
        if (error) throw error;
        return data;
      };
      const savedBeforeReview = await readOwnProgress();
      expect(savedBeforeReview.last_block_id).toBe(fixture.quizBlockId);
      expect(savedBeforeReview.percent_complete).toBe(100);
      expect(savedBeforeReview.video_state[fixture.videoBlockId].completedAt).toBeTruthy();

      // Hold the real return-trip read, never its contents. The prior player cached an earlier
      // lesson and checkpointed its empty watch state before this authoritative read completed.
      const progressUrl = (candidate: URL) => candidate.origin === new URL(url).origin && candidate.pathname === "/rest/v1/course_progress";
      const isOwnProgressRead = (request: Request) => request.method() === "GET" && progressUrl(new URL(request.url()))
        && new URL(request.url()).searchParams.get("assignment_id") === `eq.${fixture.assignmentId}`;
      let releaseRead!: () => void;
      const readBarrier = new Promise<void>(resolve => { releaseRead = resolve; });
      const holdProgress = async (route: Route) => {
        if (isOwnProgressRead(route.request())) await readBarrier;
        await route.continue();
      };
      const progressWrites: Request[] = [];
      const recordProgressWrite = (request: Request) => {
        if (request.method() === "POST" && progressUrl(new URL(request.url()))) progressWrites.push(request);
      };
      await page.route(progressUrl, holdProgress);
      page.on("request", recordProgressWrite);
      try {
        const returningRead = page.waitForRequest(isOwnProgressRead);
        await page.getByRole("button", { name: "Review Training", exact: true }).click();
        await returningRead;
        await expect(page.getByRole("button", { name: "Mark Training Complete", exact: true })).toHaveCount(0);
        expect(await readOwnProgress()).toEqual(savedBeforeReview);
        expect(progressWrites, "No checkpoint may overwrite evidence while the fresh progress read is held").toHaveLength(0);
        const checkpointResponse = page.waitForResponse(response => response.request().method() === "POST" && progressUrl(new URL(response.url())));
        releaseRead();
        await expect(page.getByRole("button", { name: "Mark Training Complete", exact: true })).toBeDisabled();
        const checkpoint = await checkpointResponse;
        expect(checkpoint.ok()).toBe(true);
        expect(progressWrites.length).toBeGreaterThan(0);
        for (const write of progressWrites) {
          expect(write.postDataJSON()).toMatchObject({
            assignment_id: fixture.assignmentId, last_block_id: fixture.quizBlockId, percent_complete: 100,
            video_state: savedBeforeReview.video_state, learning_tools: savedBeforeReview.learning_tools,
          });
        }
        expect(await readOwnProgress()).toEqual(savedBeforeReview);
      } finally {
        releaseRead();
        await page.unroute(progressUrl, holdProgress);
        page.off("request", recordProgressWrite);
      }
      await page.getByRole("link", { name: "Take Quiz", exact: true }).click();
      await page.getByRole("button", { name: "Retake Quiz", exact: true }).click();
      await page.getByRole("radio", { name: "Report it to the supervisor", exact: true }).check();
      await page.getByRole("button", { name: "Submit Quiz", exact: true }).click();
      await expect(page.getByText("You passed!", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back to Training", exact: true }).click();
      await expect(page.getByRole("button", { name: "Mark Training Complete", exact: true })).toBeEnabled();
      const { data: prematureCertificates, error } = await learnerClient.from("certificates").select("id").eq("course_assignment_id", fixture.assignmentId);
      if (error) throw error;
      expect(prematureCertificates, "passing a quiz alone must not issue a certificate").toEqual([]);
    });

    await test.step("completion persists watch and quiz evidence and issues a publicly verifiable certificate", async () => {
      // Even a tiny synthetic course enforces one real minute of seat time on the server.
      // Honor it instead of backdating progress, replacing clocks, or completing as an administrator.
      const { data: started, error: startedError } = await learnerClient.from("course_progress")
        .select("started_at").eq("assignment_id", fixture.assignmentId).single();
      if (startedError) throw startedError;
      expect(Number.isFinite(Date.parse(started.started_at))).toBe(true);
      await expect.poll(() => Date.now() - Date.parse(started.started_at), {
        message: "the learner must satisfy the actual server-enforced minimum seat time",
        timeout: 65_000, intervals: [1_000],
      }).toBeGreaterThanOrEqual(61_000);
      await page.getByRole("button", { name: "Mark Training Complete", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Rate this training", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(page.getByRole("heading", { name: "My Certificates", exact: true })).toBeVisible();
      await expect(page.getByText(fixture.courseTitle, { exact: true })).toBeVisible();
      const { data: assignment, error: assignmentError } = await learnerClient.from("course_assignments").select("status,completed_at").eq("id", fixture.assignmentId).single();
      if (assignmentError) throw assignmentError;
      expect(assignment.status).toBe("completed");
      expect(assignment.completed_at).toBeTruthy();
      const { data: progress, error: progressError } = await learnerClient.from("course_progress").select("video_state,last_block_id,percent_complete").eq("assignment_id", fixture.assignmentId).single();
      if (progressError) throw progressError;
      expect(progress.last_block_id).toBe(fixture.quizBlockId);
      expect(progress.percent_complete).toBe(100);
      expect(progress.video_state[fixture.videoBlockId].completedAt).toBeTruthy();
      expect(progress.video_state[fixture.videoBlockId].maxWatched).toBeGreaterThan(0);
      const { data: attempts, error: attemptsError } = await learnerClient.from("quiz_attempts").select("passed,score_percent").eq("assignment_id", fixture.assignmentId).eq("quiz_id", fixture.quizId).order("attempt_number");
      if (attemptsError) throw attemptsError;
      expect(attempts).toEqual([{ passed: false, score_percent: 0 }, { passed: true, score_percent: 100 }]);
      const { data: certificate, error: certificateError } = await learnerClient.from("certificates").select("slug").eq("course_assignment_id", fixture.assignmentId).single();
      if (certificateError) throw certificateError;
      await expect(page.locator(`a[href="/verify/${certificate.slug}"]`)).toBeVisible();

      // A fresh browser context proves verification works without the learner's session.
      const publicContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
      try {
        const publicPage = await publicContext.newPage();
        await publicPage.goto(`/verify/${certificate.slug}`);
        await expect(publicPage.getByText("Valid Certificate", { exact: true })).toBeVisible();
        await expect(publicPage.getByText("Synthetic Learner", { exact: true })).toBeVisible();
        await expect(publicPage.getByText(fixture.courseTitle, { exact: true })).toBeVisible();
      } finally {
        await publicContext.close();
      }
    });
    // Disposable local stacks retain regulated audit evidence until the whole stack is discarded.
  });
});
