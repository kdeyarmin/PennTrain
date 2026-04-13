import { db } from "./index";
import {
  usersTable, organizationsTable, facilitiesTable, employeesTable,
  trainingTypesTable, trainingRecordsTable, practicumsTable,
  trainingHourBucketsTable, alertsTable,
} from "./schema";
import bcrypt from "bcryptjs";

async function hash(p: string) {
  return bcrypt.hash(p, 10);
}

async function seed() {
  console.log("Seeding database...");

  await db.delete(alertsTable);
  await db.delete(trainingHourBucketsTable);
  await db.delete(practicumsTable);
  await db.delete(trainingRecordsTable);
  await db.delete(trainingTypesTable);
  await db.delete(employeesTable);
  await db.delete(facilitiesTable);
  await db.delete(usersTable);
  await db.delete(organizationsTable);

  const [sunrise] = await db.insert(organizationsTable).values({
    name: "Sunrise Healthcare Group",
    slug: "sunrise-healthcare",
    contactName: "Dr. Robert Chen",
    contactEmail: "robert.chen@sunrisehealthcare.com",
    contactPhone: "215-555-0100",
    address: "100 Corporate Blvd",
    city: "Philadelphia",
    state: "PA",
    zip: "19103",
    subscriptionStatus: "active",
    planName: "Professional",
    maxFacilities: 10,
    maxUsers: 50,
  }).returning();

  const [maplegrove] = await db.insert(organizationsTable).values({
    name: "Maple Grove Senior Living",
    slug: "maple-grove",
    contactName: "Patricia Williams",
    contactEmail: "pwilliams@maplegrove.com",
    contactPhone: "717-555-0200",
    address: "200 Oak Lane",
    city: "Harrisburg",
    state: "PA",
    zip: "17101",
    subscriptionStatus: "trial",
    planName: "Starter",
    maxFacilities: 3,
    maxUsers: 15,
  }).returning();

  const [adminUser] = await db.insert(usersTable).values({
    email: "admin@pamedtrack.com",
    passwordHash: await hash("admin123"),
    firstName: "Platform",
    lastName: "Admin",
    role: "platform_admin",
    organizationId: null,
    isActive: true,
  }).returning();

  const [sunriseAdmin] = await db.insert(usersTable).values({
    email: "admin@sunrisehealthcare.com",
    passwordHash: await hash("demo123"),
    firstName: "Robert",
    lastName: "Chen",
    role: "org_admin",
    organizationId: sunrise.id,
    isActive: true,
  }).returning();

  const [manorManager] = await db.insert(usersTable).values({
    email: "manager@sunrisemanor.com",
    passwordHash: await hash("demo123"),
    firstName: "Jennifer",
    lastName: "Martinez",
    role: "facility_manager",
    organizationId: sunrise.id,
    isActive: true,
  }).returning();

  const [trainerUser] = await db.insert(usersTable).values({
    email: "trainer@sunrisehealthcare.com",
    passwordHash: await hash("demo123"),
    firstName: "Michael",
    lastName: "Thompson",
    role: "trainer",
    organizationId: sunrise.id,
    isActive: true,
  }).returning();

  const [mapleAdmin] = await db.insert(usersTable).values({
    email: "admin@maplegrove.com",
    passwordHash: await hash("demo123"),
    firstName: "Patricia",
    lastName: "Williams",
    role: "org_admin",
    organizationId: maplegrove.id,
    isActive: true,
  }).returning();

  const [manor] = await db.insert(facilitiesTable).values({
    organizationId: sunrise.id,
    name: "Sunrise Manor",
    facilityType: "PCH",
    licenseNumber: "PCH-2019-0042",
    address: "456 Chestnut Ave",
    city: "Philadelphia",
    state: "PA",
    zip: "19104",
    phone: "215-555-0101",
    administratorName: "Jennifer Martinez",
    administratorEmail: "manager@sunrisemanor.com",
  }).returning();

  const [gardens] = await db.insert(facilitiesTable).values({
    organizationId: sunrise.id,
    name: "Sunrise Gardens ALR",
    facilityType: "ALR",
    licenseNumber: "ALR-2020-0118",
    address: "789 Rose Blvd",
    city: "Philadelphia",
    state: "PA",
    zip: "19105",
    phone: "215-555-0102",
    administratorName: "David Kim",
    administratorEmail: "dkim@sunrisegardens.com",
  }).returning();

  const [mapleFacility] = await db.insert(facilitiesTable).values({
    organizationId: maplegrove.id,
    name: "Maple Grove Residence",
    facilityType: "PCH",
    licenseNumber: "PCH-2018-0031",
    address: "300 Maple Drive",
    city: "Harrisburg",
    state: "PA",
    zip: "17102",
    phone: "717-555-0201",
    administratorName: "Patricia Williams",
    administratorEmail: "pwilliams@maplegrove.com",
  }).returning();

  const [medAdminInit] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "MED_ADMIN_INITIAL",
    name: "Medication Administration Initial Training",
    category: "Medication Administration",
    description: "Initial required training for all staff who administer medications in a PCH/ALR setting.",
    appliesToFacilityType: "BOTH",
    appliesToAdministersMeds: true,
    renewalIntervalDays: null,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 1,
  }).returning();

  const [medAdminPracticum] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "MED_ADMIN_ANNUAL_PRACTICUM",
    name: "Medication Administration Annual Practicum",
    category: "Medication Administration",
    description: "Annual practicum review required for all medication administrators.",
    appliesToFacilityType: "BOTH",
    appliesToAdministersMeds: true,
    renewalIntervalDays: 365,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 2,
  }).returning();

  const [trainerInit] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "TRAINER_INITIAL",
    name: "Trainer Initial Certification",
    category: "Trainer Certification",
    description: "Initial certification for designated trainers who train medication administrators.",
    appliesToFacilityType: "BOTH",
    appliesToTrainers: true,
    renewalIntervalDays: null,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 3,
  }).returning();

  const [trainerRecert] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "TRAINER_RECERT",
    name: "Trainer Recertification",
    category: "Trainer Certification",
    description: "Required recertification for trainers every 2 years.",
    appliesToFacilityType: "BOTH",
    appliesToTrainers: true,
    renewalIntervalDays: 730,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 4,
  }).returning();

  const [diabetesEd] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "DIABETES_INSULIN_ED",
    name: "Diabetes and Insulin Education",
    category: "Specialized Training",
    description: "Required training for staff who assist residents with diabetes management.",
    appliesToFacilityType: "BOTH",
    renewalIntervalDays: 365,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 5,
  }).returning();

  const [pchHours] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "PCH_ANNUAL_HOURS",
    name: "PCH Annual Training Hours (12 hrs)",
    category: "Annual Requirements",
    description: "12 required annual training hours for all PCH staff.",
    appliesToFacilityType: "PCH",
    renewalIntervalDays: 365,
    warningDaysDefault: 90,
    documentRequired: false,
    isSystemDefault: true,
    sortOrder: 6,
  }).returning();

  const [alrHours] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "ALR_ANNUAL_HOURS",
    name: "ALR Annual Training Hours (12 hrs)",
    category: "Annual Requirements",
    description: "12 required annual training hours for all ALR staff.",
    appliesToFacilityType: "ALR",
    renewalIntervalDays: 365,
    warningDaysDefault: 90,
    documentRequired: false,
    isSystemDefault: true,
    sortOrder: 7,
  }).returning();

  const today = new Date();
  function daysAgo(n: number) { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; }
  function daysFromNow(n: number) { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; }

  const employeeData = [
    { firstName: "Alice", lastName: "Johnson", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(730) },
    { firstName: "Bob", lastName: "Smith", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(400) },
    { firstName: "Carol", lastName: "Davis", jobTitle: "Lead Trainer", administersMedications: true, trainerStatus: true, hireDate: daysAgo(900) },
    { firstName: "Derek", lastName: "Wilson", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(200) },
    { firstName: "Emily", lastName: "Brown", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(60) },
    { firstName: "Frank", lastName: "Miller", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(500) },
  ];

  const manorEmployees = [];
  for (const emp of employeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: sunrise.id,
      facilityId: manor.id,
      ...emp,
      status: "active",
    }).returning();
    manorEmployees.push(e);
  }

  const gardensEmployeeData = [
    { firstName: "Grace", lastName: "Lee", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(550) },
    { firstName: "Henry", lastName: "Taylor", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(300) },
    { firstName: "Isabel", lastName: "Anderson", jobTitle: "Trainer", administersMedications: true, trainerStatus: true, hireDate: daysAgo(800) },
    { firstName: "Jack", lastName: "Thomas", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(120) },
  ];

  const gardensEmployees = [];
  for (const emp of gardensEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: sunrise.id,
      facilityId: gardens.id,
      ...emp,
      status: "active",
    }).returning();
    gardensEmployees.push(e);
  }

  const mapleEmployeeData = [
    { firstName: "Karen", lastName: "Jackson", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(400) },
    { firstName: "Larry", lastName: "White", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(150) },
    { firstName: "Mary", lastName: "Harris", jobTitle: "Lead Trainer", administersMedications: true, trainerStatus: true, hireDate: daysAgo(600) },
  ];

  const mapleEmployees = [];
  for (const emp of mapleEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: maplegrove.id,
      facilityId: mapleFacility.id,
      ...emp,
      status: "active",
    }).returning();
    mapleEmployees.push(e);
  }

  const [alice, bob, carol, derek, emily, frank] = manorEmployees;
  const [grace, henry, isabel, jack] = gardensEmployees;
  const [karen, larry, mary] = mapleEmployees;

  const trainingRecords = [
    { employee: alice, trainingType: medAdminInit, completionDate: daysAgo(600), facilityId: manor.id, orgId: sunrise.id },
    { employee: alice, trainingType: medAdminPracticum, completionDate: daysAgo(20), facilityId: manor.id, orgId: sunrise.id },
    { employee: alice, trainingType: diabetesEd, completionDate: daysAgo(45), facilityId: manor.id, orgId: sunrise.id },
    { employee: bob, trainingType: medAdminInit, completionDate: daysAgo(400), facilityId: manor.id, orgId: sunrise.id },
    { employee: bob, trainingType: medAdminPracticum, completionDate: daysAgo(340), facilityId: manor.id, orgId: sunrise.id },
    { employee: carol, trainingType: medAdminInit, completionDate: daysAgo(900), facilityId: manor.id, orgId: sunrise.id },
    { employee: carol, trainingType: trainerInit, completionDate: daysAgo(700), facilityId: manor.id, orgId: sunrise.id },
    { employee: carol, trainingType: trainerRecert, completionDate: daysAgo(50), facilityId: manor.id, orgId: sunrise.id },
    { employee: emily, trainingType: medAdminInit, completionDate: null, facilityId: manor.id, orgId: sunrise.id },
    { employee: emily, trainingType: medAdminPracticum, completionDate: null, facilityId: manor.id, orgId: sunrise.id },
    { employee: grace, trainingType: medAdminInit, completionDate: daysAgo(550), facilityId: gardens.id, orgId: sunrise.id },
    { employee: grace, trainingType: medAdminPracticum, completionDate: daysAgo(300), facilityId: gardens.id, orgId: sunrise.id },
    { employee: henry, trainingType: medAdminInit, completionDate: daysAgo(300), facilityId: gardens.id, orgId: sunrise.id },
    { employee: henry, trainingType: medAdminPracticum, completionDate: null, facilityId: gardens.id, orgId: sunrise.id },
    { employee: isabel, trainingType: trainerInit, completionDate: daysAgo(800), facilityId: gardens.id, orgId: sunrise.id },
    { employee: isabel, trainingType: trainerRecert, completionDate: daysAgo(750), facilityId: gardens.id, orgId: sunrise.id },
    { employee: karen, trainingType: medAdminInit, completionDate: daysAgo(400), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: karen, trainingType: medAdminPracticum, completionDate: daysAgo(370), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: mary, trainingType: trainerInit, completionDate: daysAgo(600), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: mary, trainingType: trainerRecert, completionDate: daysAgo(590), facilityId: mapleFacility.id, orgId: maplegrove.id },
  ];

  function calcStatus(completionDate: string | null, renewalDays: number | null, warningDays: number): "compliant" | "due_soon" | "expired" | "missing" {
    if (!completionDate) return "missing";
    if (!renewalDays) return "compliant";
    const due = new Date(completionDate);
    due.setDate(due.getDate() + renewalDays);
    const daysUntil = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return "expired";
    if (daysUntil <= warningDays) return "due_soon";
    return "compliant";
  }

  for (const tr of trainingRecords) {
    const status = calcStatus(tr.completionDate ?? null, tr.trainingType.renewalIntervalDays ?? null, tr.trainingType.warningDaysDefault);
    let dueDate: string | null = null;
    if (tr.completionDate && tr.trainingType.renewalIntervalDays) {
      const d = new Date(tr.completionDate);
      d.setDate(d.getDate() + tr.trainingType.renewalIntervalDays);
      dueDate = d.toISOString().split("T")[0];
    }
    await db.insert(trainingRecordsTable).values({
      organizationId: tr.orgId,
      facilityId: tr.facilityId,
      employeeId: tr.employee.id,
      trainingTypeId: tr.trainingType.id,
      completionDate: tr.completionDate ?? undefined,
      dueDate: dueDate ?? undefined,
      status,
      documentRequired: tr.trainingType.documentRequired,
    });
  }

  const currentYear = today.getFullYear();

  const practicumData = [
    { employee: alice, orgId: sunrise.id, facilityId: manor.id, completionDate: daysAgo(20), status: "compliant" as const },
    { employee: bob, orgId: sunrise.id, facilityId: manor.id, completionDate: null, status: "due_soon" as const },
    { employee: carol, orgId: sunrise.id, facilityId: manor.id, completionDate: daysAgo(180), status: "compliant" as const },
    { employee: emily, orgId: sunrise.id, facilityId: manor.id, completionDate: null, status: "missing" as const },
    { employee: grace, orgId: sunrise.id, facilityId: gardens.id, completionDate: daysAgo(90), status: "compliant" as const },
    { employee: henry, orgId: sunrise.id, facilityId: gardens.id, completionDate: null, status: "missing" as const },
    { employee: karen, orgId: maplegrove.id, facilityId: mapleFacility.id, completionDate: daysAgo(270), status: "compliant" as const },
  ];

  for (const p of practicumData) {
    await db.insert(practicumsTable).values({
      organizationId: p.orgId,
      facilityId: p.facilityId,
      employeeId: p.employee.id,
      practicumYear: currentYear,
      completionDate: p.completionDate ?? undefined,
      observedBy: p.completionDate ? "Carol Davis" : undefined,
      marReviewCompleted: !!p.completionDate,
      directObservationCompleted: !!p.completionDate,
      status: p.status,
      dueDate: daysFromNow(p.status === "due_soon" ? 25 : 90),
    });
  }

  const hourBucketData = [
    { employee: alice, orgId: sunrise.id, facilityId: manor.id, completed: "11.5", status: "due_soon" as const },
    { employee: bob, orgId: sunrise.id, facilityId: manor.id, completed: "6.0", status: "incomplete" as const },
    { employee: carol, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant" as const },
    { employee: derek, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant" as const },
    { employee: emily, orgId: sunrise.id, facilityId: manor.id, completed: "2.0", status: "incomplete" as const },
    { employee: frank, orgId: sunrise.id, facilityId: manor.id, completed: "9.0", status: "incomplete" as const },
    { employee: grace, orgId: sunrise.id, facilityId: gardens.id, completed: "12.0", status: "compliant" as const },
    { employee: henry, orgId: sunrise.id, facilityId: gardens.id, completed: "12.0", status: "compliant" as const },
    { employee: isabel, orgId: sunrise.id, facilityId: gardens.id, completed: "12.0", status: "compliant" as const },
    { employee: jack, orgId: sunrise.id, facilityId: gardens.id, completed: "5.0", status: "incomplete" as const },
    { employee: karen, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant" as const },
    { employee: larry, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "8.0", status: "incomplete" as const },
    { employee: mary, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant" as const },
  ];

  for (const b of hourBucketData) {
    await db.insert(trainingHourBucketsTable).values({
      organizationId: b.orgId,
      facilityId: b.facilityId,
      employeeId: b.employee.id,
      trainingYear: currentYear,
      requiredHours: "12",
      completedHours: b.completed,
      status: b.status,
    });
  }

  await db.insert(alertsTable).values([
    {
      organizationId: sunrise.id,
      facilityId: manor.id,
      employeeId: emily.id,
      alertType: "missing_document",
      title: "Initial Medication Training Missing - Emily Brown",
      message: "Emily Brown (hired 60 days ago) has not completed initial medication administration training.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: sunrise.id,
      facilityId: manor.id,
      employeeId: bob.id,
      alertType: "due_90",
      title: "Annual Practicum Due - Bob Smith",
      message: "Bob Smith's annual medication administration practicum is due within 90 days.",
      severity: "info",
      status: "open",
    },
    {
      organizationId: sunrise.id,
      facilityId: gardens.id,
      employeeId: henry.id,
      alertType: "overdue",
      title: "Annual Practicum Missing - Henry Taylor",
      message: "Henry Taylor has not completed the current year annual practicum.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: maplegrove.id,
      facilityId: mapleFacility.id,
      alertType: "due_90",
      title: "Trainer Recertification Due",
      message: "Mary Harris's trainer recertification is due within 90 days.",
      severity: "info",
      status: "open",
    },
  ]);

  console.log("Database seeded successfully!");
  console.log("\nDemo credentials:");
  console.log("  Platform Admin: admin@pamedtrack.com / admin123");
  console.log("  Org Admin:      admin@sunrisehealthcare.com / demo123");
  console.log("  Facility Mgr:   manager@sunrisemanor.com / demo123");
  console.log("  Trainer:        trainer@sunrisehealthcare.com / demo123");
  console.log("  Org Admin 2:    admin@maplegrove.com / demo123");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
