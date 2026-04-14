import { db } from "@workspace/db";
import { organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateAlertsForOrganization } from "./compliance";
import { logger } from "./logger";

const MIDNIGHT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

async function runDailyComplianceCheck() {
  logger.info("Starting daily compliance recalculation");
  try {
    const orgs = await db
      .select({ id: organizationsTable.id, name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.subscriptionStatus, "active"));

    let totalAlerts = 0;
    for (const org of orgs) {
      try {
        await generateAlertsForOrganization(org.id);
        logger.info({ organizationId: org.id, name: org.name }, "Compliance check complete for org");
      } catch (err) {
        logger.error({ err, organizationId: org.id }, "Failed compliance check for org");
      }
    }
    logger.info({ organizationCount: orgs.length }, "Daily compliance recalculation finished");
  } catch (err) {
    logger.error({ err }, "Daily compliance cron failed");
  }
}

let cronTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNext() {
  const delay = msUntilMidnight();
  logger.info({ delayMs: delay, delayHours: (delay / 3600000).toFixed(1) }, "Scheduling next compliance check at midnight");
  cronTimer = setTimeout(async () => {
    await runDailyComplianceCheck();
    scheduleNext();
  }, delay);
}

export function startComplianceCron() {
  if (process.env.DISABLE_CRON === "true") {
    logger.info("Compliance cron disabled via DISABLE_CRON env var");
    return;
  }
  logger.info("Initializing daily compliance cron job");
  scheduleNext();
}

export function stopComplianceCron() {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
}
