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

function calcStatus(
  completionDate: string | null,
  renewalDays: number | null,
  warningDays: number,
  today: Date
): "compliant" | "due_soon" | "expired" | "missing" {
  if (!completionDate) return "missing";
  if (!renewalDays) return "compliant";
  const due = new Date(completionDate);
  due.setDate(due.getDate() + renewalDays);
  const daysUntil = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return "expired";
  if (daysUntil <= warningDays) return "due_soon";
  return "compliant";
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

  // --- Organizations ---
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
    maxUsers: 100,
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
    maxFacilities: 5,
    maxUsers: 30,
  }).returning();

  const [valleycare] = await db.insert(organizationsTable).values({
    name: "Valley Care Residences",
    slug: "valley-care",
    contactName: "Thomas Greenberg",
    contactEmail: "tgreenberg@valleycare.com",
    contactPhone: "610-555-0300",
    address: "500 Valley Road",
    city: "Allentown",
    state: "PA",
    zip: "18101",
    subscriptionStatus: "active",
    planName: "Starter",
    maxFacilities: 3,
    maxUsers: 25,
  }).returning();

  // --- Users ---
  await db.insert(usersTable).values({
    email: "admin@pamedtrack.com",
    passwordHash: await hash("admin123"),
    firstName: "Platform",
    lastName: "Admin",
    role: "platform_admin",
    organizationId: null,
    isActive: true,
  });

  const [sunriseAdmin] = await db.insert(usersTable).values({
    email: "admin@sunrisehealthcare.com",
    passwordHash: await hash("demo123"),
    firstName: "Robert",
    lastName: "Chen",
    role: "org_admin",
    organizationId: sunrise.id,
    isActive: true,
  }).returning();

  await db.insert(usersTable).values({
    email: "manager@sunrisemanor.com",
    passwordHash: await hash("demo123"),
    firstName: "Jennifer",
    lastName: "Martinez",
    role: "facility_manager",
    organizationId: sunrise.id,
    isActive: true,
  });

  await db.insert(usersTable).values({
    email: "manager2@sunrisegard.com",
    passwordHash: await hash("demo123"),
    firstName: "David",
    lastName: "Kim",
    role: "facility_manager",
    organizationId: sunrise.id,
    isActive: true,
  });

  await db.insert(usersTable).values({
    email: "trainer@sunrisehealthcare.com",
    passwordHash: await hash("demo123"),
    firstName: "Michael",
    lastName: "Thompson",
    role: "trainer",
    organizationId: sunrise.id,
    isActive: true,
  });

  await db.insert(usersTable).values({
    email: "admin@maplegrove.com",
    passwordHash: await hash("demo123"),
    firstName: "Patricia",
    lastName: "Williams",
    role: "org_admin",
    organizationId: maplegrove.id,
    isActive: true,
  });

  await db.insert(usersTable).values({
    email: "admin@valleycare.com",
    passwordHash: await hash("demo123"),
    firstName: "Thomas",
    lastName: "Greenberg",
    role: "org_admin",
    organizationId: valleycare.id,
    isActive: true,
  });

  // --- Facilities: 4 for Sunrise, 2 for Maple Grove, 1 for Valley Care = 7 total ---
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
    capacity: 40,
    currentCensus: 35,
    administratorName: "Jennifer Martinez",
    administratorEmail: "manager@sunrisemanor.com",
    licenseExpiration: "2026-06-30",
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
    capacity: 55,
    currentCensus: 48,
    administratorName: "David Kim",
    administratorEmail: "manager2@sunrisegard.com",
    licenseExpiration: "2026-09-15",
  }).returning();

  const [ridge] = await db.insert(facilitiesTable).values({
    organizationId: sunrise.id,
    name: "Sunrise Ridge PCH",
    facilityType: "PCH",
    licenseNumber: "PCH-2021-0077",
    address: "120 Ridge Way",
    city: "Norristown",
    state: "PA",
    zip: "19401",
    phone: "215-555-0103",
    capacity: 30,
    currentCensus: 27,
    administratorName: "Angela Foster",
    administratorEmail: "afoster@sunriseridge.com",
    licenseExpiration: "2026-12-01",
  }).returning();

  const [pavilion] = await db.insert(facilitiesTable).values({
    organizationId: sunrise.id,
    name: "Sunrise Pavilion ALR",
    facilityType: "ALR",
    licenseNumber: "ALR-2022-0205",
    address: "900 Pavilion Rd",
    city: "Chester",
    state: "PA",
    zip: "19013",
    phone: "215-555-0104",
    capacity: 45,
    currentCensus: 40,
    administratorName: "Samuel Parks",
    administratorEmail: "sparks@sunrisepavilion.com",
    licenseExpiration: "2027-03-10",
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
    capacity: 35,
    currentCensus: 30,
    administratorName: "Patricia Williams",
    administratorEmail: "pwilliams@maplegrove.com",
    licenseExpiration: "2025-11-30",
  }).returning();

  const [mapleEast] = await db.insert(facilitiesTable).values({
    organizationId: maplegrove.id,
    name: "Maple Grove East",
    facilityType: "ALR",
    licenseNumber: "ALR-2021-0144",
    address: "450 Elm Street",
    city: "York",
    state: "PA",
    zip: "17401",
    phone: "717-555-0202",
    capacity: 28,
    currentCensus: 22,
    administratorName: "Nancy Cole",
    administratorEmail: "ncole@maplegroveeast.com",
    licenseExpiration: "2026-08-20",
  }).returning();

  const [valleyMain] = await db.insert(facilitiesTable).values({
    organizationId: valleycare.id,
    name: "Valley Care Main",
    facilityType: "PCH",
    licenseNumber: "PCH-2020-0065",
    address: "500 Valley Road",
    city: "Allentown",
    state: "PA",
    zip: "18101",
    phone: "610-555-0301",
    capacity: 50,
    currentCensus: 44,
    administratorName: "Thomas Greenberg",
    administratorEmail: "tgreenberg@valleycare.com",
    licenseExpiration: "2026-04-15",
  }).returning();

  // --- Training Types ---
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
    name: "ALR Annual Training Hours (16 hrs)",
    category: "Annual Requirements",
    description: "16 required annual training hours for all ALR staff (per Pennsylvania ALR regulations).",
    appliesToFacilityType: "ALR",
    renewalIntervalDays: 365,
    warningDaysDefault: 90,
    documentRequired: false,
    isSystemDefault: true,
    sortOrder: 7,
  }).returning();

  const [firstAid] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "FIRST_AID_CPR",
    name: "First Aid and CPR Certification",
    category: "Safety",
    description: "Required first aid and CPR certification for direct care staff.",
    appliesToFacilityType: "BOTH",
    renewalIntervalDays: 730,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 8,
  }).returning();

  const [dementiaCare] = await db.insert(trainingTypesTable).values({
    organizationId: null,
    code: "DEMENTIA_CARE",
    name: "Dementia Care Training",
    category: "Specialized Training",
    description: "Training for staff providing care to residents with dementia.",
    appliesToFacilityType: "BOTH",
    renewalIntervalDays: 730,
    warningDaysDefault: 90,
    documentRequired: true,
    isSystemDefault: true,
    sortOrder: 9,
  }).returning();

  const today = new Date();
  function daysAgo(n: number) { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; }
  function daysFromNow(n: number) { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; }

  // ========== SUNRISE MANOR employees (12) ==========
  const manorEmployeeData = [
    { firstName: "Alice", lastName: "Johnson", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(730), department: "Nursing", status: "active" as const },
    { firstName: "Bob", lastName: "Smith", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(400), department: "Nursing", status: "active" as const },
    { firstName: "Carol", lastName: "Davis", jobTitle: "Lead Trainer / Medication Aide", administersMedications: true, trainerStatus: true, hireDate: daysAgo(900), department: "Nursing", status: "active" as const },
    { firstName: "Derek", lastName: "Wilson", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(200), department: "Direct Care", status: "active" as const },
    { firstName: "Emily", lastName: "Brown", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(60), department: "Nursing", status: "active" as const },
    { firstName: "Frank", lastName: "Miller", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(500), department: "Direct Care", status: "active" as const },
    { firstName: "Gina", lastName: "Russo", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(850), department: "Nursing", status: "active" as const },
    { firstName: "Harold", lastName: "Patel", jobTitle: "Activities Director", administersMedications: false, trainerStatus: false, hireDate: daysAgo(1100), department: "Activities", status: "active" as const },
    { firstName: "Irene", lastName: "Nguyen", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(280), department: "Nursing", status: "active" as const },
    { firstName: "James", lastName: "O'Brien", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(180), department: "Direct Care", status: "active" as const },
    { firstName: "Keisha", lastName: "Monroe", jobTitle: "LPN", administersMedications: true, trainerStatus: false, hireDate: daysAgo(620), department: "Nursing", status: "active" as const },
    { firstName: "Luis", lastName: "Vargas", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(90), department: "Direct Care", status: "on_leave" as const },
  ];

  const manorEmployees = [];
  for (const emp of manorEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: sunrise.id,
      facilityId: manor.id,
      employeeNumber: `SM-${String(manorEmployees.length + 1001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    manorEmployees.push(e);
  }

  // ========== SUNRISE GARDENS employees (10) ==========
  const gardensEmployeeData = [
    { firstName: "Grace", lastName: "Lee", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(550), department: "Nursing", status: "active" as const },
    { firstName: "Henry", lastName: "Taylor", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(300), department: "Nursing", status: "active" as const },
    { firstName: "Isabel", lastName: "Anderson", jobTitle: "Trainer / Medication Aide", administersMedications: true, trainerStatus: true, hireDate: daysAgo(800), department: "Nursing", status: "active" as const },
    { firstName: "Jack", lastName: "Thomas", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(120), department: "Direct Care", status: "active" as const },
    { firstName: "Linda", lastName: "Hoffman", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(450), department: "Nursing", status: "active" as const },
    { firstName: "Marcus", lastName: "Reed", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(230), department: "Direct Care", status: "active" as const },
    { firstName: "Nina", lastName: "Castillo", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(375), department: "Nursing", status: "active" as const },
    { firstName: "Oscar", lastName: "Fleming", jobTitle: "Activities Aide", administersMedications: false, trainerStatus: false, hireDate: daysAgo(480), department: "Activities", status: "active" as const },
    { firstName: "Paula", lastName: "Grant", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(150), department: "Nursing", status: "active" as const },
    { firstName: "Quinn", lastName: "Delgado", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(65), department: "Direct Care", status: "active" as const },
  ];

  const gardensEmployees = [];
  for (const emp of gardensEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: sunrise.id,
      facilityId: gardens.id,
      employeeNumber: `SG-${String(gardensEmployees.length + 2001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    gardensEmployees.push(e);
  }

  // ========== SUNRISE RIDGE employees (6) ==========
  const ridgeEmployeeData = [
    { firstName: "Rachel", lastName: "Stone", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(320), department: "Nursing", status: "active" as const },
    { firstName: "Steven", lastName: "Park", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(140), department: "Nursing", status: "active" as const },
    { firstName: "Teresa", lastName: "Bloom", jobTitle: "Lead Trainer", administersMedications: true, trainerStatus: true, hireDate: daysAgo(760), department: "Nursing", status: "active" as const },
    { firstName: "Ulysses", lastName: "Carr", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(95), department: "Direct Care", status: "active" as const },
    { firstName: "Victoria", lastName: "Lane", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(410), department: "Direct Care", status: "active" as const },
    { firstName: "Walter", lastName: "Cruz", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(260), department: "Nursing", status: "active" as const },
  ];

  const ridgeEmployees = [];
  for (const emp of ridgeEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: sunrise.id,
      facilityId: ridge.id,
      employeeNumber: `SR-${String(ridgeEmployees.length + 3001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    ridgeEmployees.push(e);
  }

  // ========== SUNRISE PAVILION employees (5) ==========
  const pavilionEmployeeData = [
    { firstName: "Xena", lastName: "Holt", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(480), department: "Nursing", status: "active" as const },
    { firstName: "Yusuf", lastName: "Abboud", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(100), department: "Direct Care", status: "active" as const },
    { firstName: "Zoe", lastName: "Fischer", jobTitle: "Trainer / Medication Aide", administersMedications: true, trainerStatus: true, hireDate: daysAgo(670), department: "Nursing", status: "active" as const },
    { firstName: "Aaron", lastName: "Moss", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(210), department: "Direct Care", status: "active" as const },
    { firstName: "Bette", lastName: "Yuen", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(330), department: "Nursing", status: "active" as const },
  ];

  const pavilionEmployees = [];
  for (const emp of pavilionEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: sunrise.id,
      facilityId: pavilion.id,
      employeeNumber: `SP-${String(pavilionEmployees.length + 4001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    pavilionEmployees.push(e);
  }

  // ========== MAPLE GROVE RESIDENCE employees (8) ==========
  const mapleEmployeeData = [
    { firstName: "Karen", lastName: "Jackson", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(400), department: "Nursing", status: "active" as const },
    { firstName: "Larry", lastName: "White", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(150), department: "Direct Care", status: "active" as const },
    { firstName: "Mary", lastName: "Harris", jobTitle: "Lead Trainer / Medication Aide", administersMedications: true, trainerStatus: true, hireDate: daysAgo(600), department: "Nursing", status: "active" as const },
    { firstName: "Nathan", lastName: "Fox", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(220), department: "Nursing", status: "active" as const },
    { firstName: "Olivia", lastName: "Reed", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(75), department: "Direct Care", status: "active" as const },
    { firstName: "Peter", lastName: "Quinn", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(340), department: "Direct Care", status: "active" as const },
    { firstName: "Rosa", lastName: "Medina", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(510), department: "Nursing", status: "active" as const },
    { firstName: "Sam", lastName: "Horton", jobTitle: "Activities Director", administersMedications: false, trainerStatus: false, hireDate: daysAgo(880), department: "Activities", status: "active" as const },
  ];

  const mapleEmployees = [];
  for (const emp of mapleEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: maplegrove.id,
      facilityId: mapleFacility.id,
      employeeNumber: `MG-${String(mapleEmployees.length + 5001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    mapleEmployees.push(e);
  }

  // ========== MAPLE GROVE EAST employees (5) ==========
  const mapleEastEmployeeData = [
    { firstName: "Tina", lastName: "Burke", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(290), department: "Nursing", status: "active" as const },
    { firstName: "Uma", lastName: "Soto", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(110), department: "Direct Care", status: "active" as const },
    { firstName: "Vincent", lastName: "Lamb", jobTitle: "Trainer / Medication Aide", administersMedications: true, trainerStatus: true, hireDate: daysAgo(520), department: "Nursing", status: "active" as const },
    { firstName: "Wendy", lastName: "Chan", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(190), department: "Direct Care", status: "active" as const },
    { firstName: "Xavier", lastName: "Owens", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(420), department: "Nursing", status: "active" as const },
  ];

  const mapleEastEmployees = [];
  for (const emp of mapleEastEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: maplegrove.id,
      facilityId: mapleEast.id,
      employeeNumber: `ME-${String(mapleEastEmployees.length + 6001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    mapleEastEmployees.push(e);
  }

  // ========== VALLEY CARE MAIN employees (7) ==========
  const valleyEmployeeData = [
    { firstName: "Yvonne", lastName: "Byrd", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(560), department: "Nursing", status: "active" as const },
    { firstName: "Zachary", lastName: "Cole", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(200), department: "Nursing", status: "active" as const },
    { firstName: "Amanda", lastName: "Frost", jobTitle: "Lead Trainer", administersMedications: true, trainerStatus: true, hireDate: daysAgo(720), department: "Nursing", status: "active" as const },
    { firstName: "Brad", lastName: "Knox", jobTitle: "Caregiver", administersMedications: false, trainerStatus: false, hireDate: daysAgo(85), department: "Direct Care", status: "active" as const },
    { firstName: "Chloe", lastName: "Ingram", jobTitle: "CNA", administersMedications: false, trainerStatus: false, hireDate: daysAgo(390), department: "Direct Care", status: "active" as const },
    { firstName: "Dylan", lastName: "Marsh", jobTitle: "Medication Aide", administersMedications: true, trainerStatus: false, hireDate: daysAgo(130), department: "Nursing", status: "active" as const },
    { firstName: "Elena", lastName: "Wise", jobTitle: "Activities Director", administersMedications: false, trainerStatus: false, hireDate: daysAgo(640), department: "Activities", status: "active" as const },
  ];

  const valleyEmployees = [];
  for (const emp of valleyEmployeeData) {
    const [e] = await db.insert(employeesTable).values({
      organizationId: valleycare.id,
      facilityId: valleyMain.id,
      employeeNumber: `VC-${String(valleyEmployees.length + 7001).padStart(4, "0")}`,
      ...emp,
    }).returning();
    valleyEmployees.push(e);
  }

  // Total employees: 12 + 10 + 6 + 5 + 8 + 5 + 7 = 53

  const currentYear = today.getFullYear();
  const [alice, bob, carol, derek, emily, frank, gina, harold, irene, james, keisha, luis] = manorEmployees;
  const [grace, henry, isabel, jack, linda, marcus, nina, oscar, paula, quinn] = gardensEmployees;
  const [rachel, steven, teresa, ulysses, victoria, walter] = ridgeEmployees;
  const [xena, yusuf, zoe, aaron, bette] = pavilionEmployees;
  const [karen, larry, mary, nathan, olivia, peter, rosa, sam] = mapleEmployees;
  const [tina, uma, vincent, wendy, xavier] = mapleEastEmployees;
  const [yvonne, zachary, amanda, brad, chloe, dylan, elena] = valleyEmployees;

  // --- Training Records ---
  type TrainingRecord = {
    employee: typeof alice;
    trainingType: typeof medAdminInit;
    completionDate: string | null;
    facilityId: number;
    orgId: number;
  };

  const trainingRecords: TrainingRecord[] = [
    // Sunrise Manor - Alice (compliant)
    { employee: alice, trainingType: medAdminInit, completionDate: daysAgo(600), facilityId: manor.id, orgId: sunrise.id },
    { employee: alice, trainingType: medAdminPracticum, completionDate: daysAgo(20), facilityId: manor.id, orgId: sunrise.id },
    { employee: alice, trainingType: diabetesEd, completionDate: daysAgo(45), facilityId: manor.id, orgId: sunrise.id },
    { employee: alice, trainingType: firstAid, completionDate: daysAgo(180), facilityId: manor.id, orgId: sunrise.id },
    // Sunrise Manor - Bob (due_soon practicum)
    { employee: bob, trainingType: medAdminInit, completionDate: daysAgo(400), facilityId: manor.id, orgId: sunrise.id },
    { employee: bob, trainingType: medAdminPracticum, completionDate: daysAgo(340), facilityId: manor.id, orgId: sunrise.id },
    { employee: bob, trainingType: firstAid, completionDate: daysAgo(600), facilityId: manor.id, orgId: sunrise.id },
    // Sunrise Manor - Carol (trainer, compliant)
    { employee: carol, trainingType: medAdminInit, completionDate: daysAgo(900), facilityId: manor.id, orgId: sunrise.id },
    { employee: carol, trainingType: trainerInit, completionDate: daysAgo(700), facilityId: manor.id, orgId: sunrise.id },
    { employee: carol, trainingType: trainerRecert, completionDate: daysAgo(50), facilityId: manor.id, orgId: sunrise.id },
    { employee: carol, trainingType: dementiaCare, completionDate: daysAgo(200), facilityId: manor.id, orgId: sunrise.id },
    // Sunrise Manor - Emily (missing training, new hire)
    { employee: emily, trainingType: medAdminInit, completionDate: null, facilityId: manor.id, orgId: sunrise.id },
    { employee: emily, trainingType: medAdminPracticum, completionDate: null, facilityId: manor.id, orgId: sunrise.id },
    // Sunrise Manor - Gina
    { employee: gina, trainingType: medAdminInit, completionDate: daysAgo(850), facilityId: manor.id, orgId: sunrise.id },
    { employee: gina, trainingType: medAdminPracticum, completionDate: daysAgo(410), facilityId: manor.id, orgId: sunrise.id },
    { employee: gina, trainingType: diabetesEd, completionDate: daysAgo(370), facilityId: manor.id, orgId: sunrise.id },
    // Sunrise Manor - Irene
    { employee: irene, trainingType: medAdminInit, completionDate: daysAgo(280), facilityId: manor.id, orgId: sunrise.id },
    { employee: irene, trainingType: medAdminPracticum, completionDate: null, facilityId: manor.id, orgId: sunrise.id },
    // Sunrise Manor - Keisha
    { employee: keisha, trainingType: medAdminInit, completionDate: daysAgo(620), facilityId: manor.id, orgId: sunrise.id },
    { employee: keisha, trainingType: medAdminPracticum, completionDate: daysAgo(80), facilityId: manor.id, orgId: sunrise.id },
    { employee: keisha, trainingType: diabetesEd, completionDate: daysAgo(100), facilityId: manor.id, orgId: sunrise.id },

    // Sunrise Gardens - Grace (compliant)
    { employee: grace, trainingType: medAdminInit, completionDate: daysAgo(550), facilityId: gardens.id, orgId: sunrise.id },
    { employee: grace, trainingType: medAdminPracticum, completionDate: daysAgo(30), facilityId: gardens.id, orgId: sunrise.id },
    { employee: grace, trainingType: firstAid, completionDate: daysAgo(200), facilityId: gardens.id, orgId: sunrise.id },
    // Sunrise Gardens - Henry (missing practicum)
    { employee: henry, trainingType: medAdminInit, completionDate: daysAgo(300), facilityId: gardens.id, orgId: sunrise.id },
    { employee: henry, trainingType: medAdminPracticum, completionDate: null, facilityId: gardens.id, orgId: sunrise.id },
    // Sunrise Gardens - Isabel (trainer, recert expired)
    { employee: isabel, trainingType: trainerInit, completionDate: daysAgo(800), facilityId: gardens.id, orgId: sunrise.id },
    { employee: isabel, trainingType: trainerRecert, completionDate: daysAgo(750), facilityId: gardens.id, orgId: sunrise.id },
    // Sunrise Gardens - Linda
    { employee: linda, trainingType: medAdminInit, completionDate: daysAgo(450), facilityId: gardens.id, orgId: sunrise.id },
    { employee: linda, trainingType: medAdminPracticum, completionDate: daysAgo(60), facilityId: gardens.id, orgId: sunrise.id },
    // Sunrise Gardens - Nina
    { employee: nina, trainingType: medAdminInit, completionDate: daysAgo(375), facilityId: gardens.id, orgId: sunrise.id },
    { employee: nina, trainingType: medAdminPracticum, completionDate: daysAgo(120), facilityId: gardens.id, orgId: sunrise.id },
    { employee: nina, trainingType: diabetesEd, completionDate: daysAgo(90), facilityId: gardens.id, orgId: sunrise.id },
    // Sunrise Gardens - Paula (new hire)
    { employee: paula, trainingType: medAdminInit, completionDate: null, facilityId: gardens.id, orgId: sunrise.id },

    // Sunrise Ridge - Rachel
    { employee: rachel, trainingType: medAdminInit, completionDate: daysAgo(320), facilityId: ridge.id, orgId: sunrise.id },
    { employee: rachel, trainingType: medAdminPracticum, completionDate: daysAgo(50), facilityId: ridge.id, orgId: sunrise.id },
    // Sunrise Ridge - Steven (new hire)
    { employee: steven, trainingType: medAdminInit, completionDate: null, facilityId: ridge.id, orgId: sunrise.id },
    // Sunrise Ridge - Teresa (trainer)
    { employee: teresa, trainingType: medAdminInit, completionDate: daysAgo(760), facilityId: ridge.id, orgId: sunrise.id },
    { employee: teresa, trainingType: trainerInit, completionDate: daysAgo(700), facilityId: ridge.id, orgId: sunrise.id },
    { employee: teresa, trainingType: trainerRecert, completionDate: daysAgo(100), facilityId: ridge.id, orgId: sunrise.id },
    // Sunrise Ridge - Walter
    { employee: walter, trainingType: medAdminInit, completionDate: daysAgo(260), facilityId: ridge.id, orgId: sunrise.id },
    { employee: walter, trainingType: medAdminPracticum, completionDate: daysAgo(200), facilityId: ridge.id, orgId: sunrise.id },

    // Sunrise Pavilion - Xena
    { employee: xena, trainingType: medAdminInit, completionDate: daysAgo(480), facilityId: pavilion.id, orgId: sunrise.id },
    { employee: xena, trainingType: medAdminPracticum, completionDate: daysAgo(350), facilityId: pavilion.id, orgId: sunrise.id },
    // Sunrise Pavilion - Zoe (trainer)
    { employee: zoe, trainingType: trainerInit, completionDate: daysAgo(670), facilityId: pavilion.id, orgId: sunrise.id },
    { employee: zoe, trainingType: trainerRecert, completionDate: daysAgo(200), facilityId: pavilion.id, orgId: sunrise.id },
    // Sunrise Pavilion - Bette
    { employee: bette, trainingType: medAdminInit, completionDate: daysAgo(330), facilityId: pavilion.id, orgId: sunrise.id },
    { employee: bette, trainingType: medAdminPracticum, completionDate: null, facilityId: pavilion.id, orgId: sunrise.id },

    // Maple Grove Residence - Karen (compliant)
    { employee: karen, trainingType: medAdminInit, completionDate: daysAgo(400), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: karen, trainingType: medAdminPracticum, completionDate: daysAgo(370), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: karen, trainingType: firstAid, completionDate: daysAgo(180), facilityId: mapleFacility.id, orgId: maplegrove.id },
    // Maple Grove - Mary (trainer, due_soon recert)
    { employee: mary, trainingType: trainerInit, completionDate: daysAgo(600), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: mary, trainingType: trainerRecert, completionDate: daysAgo(590), facilityId: mapleFacility.id, orgId: maplegrove.id },
    // Maple Grove - Nathan
    { employee: nathan, trainingType: medAdminInit, completionDate: daysAgo(220), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: nathan, trainingType: medAdminPracticum, completionDate: null, facilityId: mapleFacility.id, orgId: maplegrove.id },
    // Maple Grove - Rosa
    { employee: rosa, trainingType: medAdminInit, completionDate: daysAgo(510), facilityId: mapleFacility.id, orgId: maplegrove.id },
    { employee: rosa, trainingType: medAdminPracticum, completionDate: daysAgo(280), facilityId: mapleFacility.id, orgId: maplegrove.id },

    // Maple Grove East - Tina
    { employee: tina, trainingType: medAdminInit, completionDate: daysAgo(290), facilityId: mapleEast.id, orgId: maplegrove.id },
    { employee: tina, trainingType: medAdminPracticum, completionDate: daysAgo(70), facilityId: mapleEast.id, orgId: maplegrove.id },
    // Maple Grove East - Vincent (trainer)
    { employee: vincent, trainingType: trainerInit, completionDate: daysAgo(520), facilityId: mapleEast.id, orgId: maplegrove.id },
    { employee: vincent, trainingType: trainerRecert, completionDate: daysAgo(300), facilityId: mapleEast.id, orgId: maplegrove.id },
    // Maple Grove East - Xavier
    { employee: xavier, trainingType: medAdminInit, completionDate: daysAgo(420), facilityId: mapleEast.id, orgId: maplegrove.id },
    { employee: xavier, trainingType: medAdminPracticum, completionDate: null, facilityId: mapleEast.id, orgId: maplegrove.id },

    // Valley Care - Yvonne
    { employee: yvonne, trainingType: medAdminInit, completionDate: daysAgo(560), facilityId: valleyMain.id, orgId: valleycare.id },
    { employee: yvonne, trainingType: medAdminPracticum, completionDate: daysAgo(200), facilityId: valleyMain.id, orgId: valleycare.id },
    // Valley Care - Zachary
    { employee: zachary, trainingType: medAdminInit, completionDate: daysAgo(200), facilityId: valleyMain.id, orgId: valleycare.id },
    { employee: zachary, trainingType: medAdminPracticum, completionDate: null, facilityId: valleyMain.id, orgId: valleycare.id },
    // Valley Care - Amanda (trainer)
    { employee: amanda, trainingType: trainerInit, completionDate: daysAgo(720), facilityId: valleyMain.id, orgId: valleycare.id },
    { employee: amanda, trainingType: trainerRecert, completionDate: daysAgo(350), facilityId: valleyMain.id, orgId: valleycare.id },
    // Valley Care - Dylan
    { employee: dylan, trainingType: medAdminInit, completionDate: null, facilityId: valleyMain.id, orgId: valleycare.id },
  ];

  for (const tr of trainingRecords) {
    const status = calcStatus(tr.completionDate ?? null, tr.trainingType.renewalIntervalDays ?? null, tr.trainingType.warningDaysDefault, today);
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

  // --- Practicums ---
  type PracticumRecord = {
    employee: typeof alice;
    orgId: number;
    facilityId: number;
    completionDate: string | null;
    status: "compliant" | "due_soon" | "expired" | "missing";
    observedBy?: string;
  };

  const practicumData: PracticumRecord[] = [
    { employee: alice, orgId: sunrise.id, facilityId: manor.id, completionDate: daysAgo(20), status: "compliant", observedBy: "Carol Davis" },
    { employee: bob, orgId: sunrise.id, facilityId: manor.id, completionDate: null, status: "due_soon" },
    { employee: carol, orgId: sunrise.id, facilityId: manor.id, completionDate: daysAgo(180), status: "compliant", observedBy: "Carol Davis" },
    { employee: emily, orgId: sunrise.id, facilityId: manor.id, completionDate: null, status: "missing" },
    { employee: gina, orgId: sunrise.id, facilityId: manor.id, completionDate: daysAgo(410), status: "due_soon" },
    { employee: irene, orgId: sunrise.id, facilityId: manor.id, completionDate: null, status: "missing" },
    { employee: keisha, orgId: sunrise.id, facilityId: manor.id, completionDate: daysAgo(80), status: "compliant", observedBy: "Carol Davis" },

    { employee: grace, orgId: sunrise.id, facilityId: gardens.id, completionDate: daysAgo(30), status: "compliant", observedBy: "Isabel Anderson" },
    { employee: henry, orgId: sunrise.id, facilityId: gardens.id, completionDate: null, status: "missing" },
    { employee: linda, orgId: sunrise.id, facilityId: gardens.id, completionDate: daysAgo(60), status: "compliant", observedBy: "Isabel Anderson" },
    { employee: nina, orgId: sunrise.id, facilityId: gardens.id, completionDate: daysAgo(120), status: "compliant", observedBy: "Isabel Anderson" },
    { employee: paula, orgId: sunrise.id, facilityId: gardens.id, completionDate: null, status: "missing" },

    { employee: rachel, orgId: sunrise.id, facilityId: ridge.id, completionDate: daysAgo(50), status: "compliant", observedBy: "Teresa Bloom" },
    { employee: walter, orgId: sunrise.id, facilityId: ridge.id, completionDate: daysAgo(200), status: "due_soon" },

    { employee: xena, orgId: sunrise.id, facilityId: pavilion.id, completionDate: daysAgo(350), status: "due_soon" },
    { employee: bette, orgId: sunrise.id, facilityId: pavilion.id, completionDate: null, status: "missing" },

    { employee: karen, orgId: maplegrove.id, facilityId: mapleFacility.id, completionDate: daysAgo(370), status: "due_soon", observedBy: "Mary Harris" },
    { employee: nathan, orgId: maplegrove.id, facilityId: mapleFacility.id, completionDate: null, status: "missing" },
    { employee: rosa, orgId: maplegrove.id, facilityId: mapleFacility.id, completionDate: daysAgo(280), status: "compliant", observedBy: "Mary Harris" },

    { employee: tina, orgId: maplegrove.id, facilityId: mapleEast.id, completionDate: daysAgo(70), status: "compliant", observedBy: "Vincent Lamb" },
    { employee: xavier, orgId: maplegrove.id, facilityId: mapleEast.id, completionDate: null, status: "missing" },

    { employee: yvonne, orgId: valleycare.id, facilityId: valleyMain.id, completionDate: daysAgo(200), status: "compliant", observedBy: "Amanda Frost" },
    { employee: zachary, orgId: valleycare.id, facilityId: valleyMain.id, completionDate: null, status: "missing" },
  ];

  for (const p of practicumData) {
    await db.insert(practicumsTable).values({
      organizationId: p.orgId,
      facilityId: p.facilityId,
      employeeId: p.employee.id,
      practicumYear: currentYear,
      completionDate: p.completionDate ?? undefined,
      observedBy: p.observedBy,
      marReviewCompleted: !!p.completionDate,
      directObservationCompleted: !!p.completionDate,
      status: p.status,
      dueDate: p.status === "due_soon" ? daysFromNow(25) : daysFromNow(90),
    });
  }

  // --- Annual Training Hour Buckets ---
  type HourBucket = {
    employee: typeof alice;
    orgId: number;
    facilityId: number;
    completed: string;
    status: "compliant" | "incomplete" | "due_soon";
    facilityType: "PCH" | "ALR";
  };

  const hourBucketData: HourBucket[] = [
    // Sunrise Manor (PCH)
    { employee: alice, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: bob, orgId: sunrise.id, facilityId: manor.id, completed: "6.0", status: "incomplete", facilityType: "PCH" },
    { employee: carol, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: derek, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: emily, orgId: sunrise.id, facilityId: manor.id, completed: "2.0", status: "incomplete", facilityType: "PCH" },
    { employee: frank, orgId: sunrise.id, facilityId: manor.id, completed: "9.0", status: "incomplete", facilityType: "PCH" },
    { employee: gina, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: harold, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: irene, orgId: sunrise.id, facilityId: manor.id, completed: "7.5", status: "incomplete", facilityType: "PCH" },
    { employee: james, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: keisha, orgId: sunrise.id, facilityId: manor.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: luis, orgId: sunrise.id, facilityId: manor.id, completed: "4.0", status: "incomplete", facilityType: "PCH" },
    // Sunrise Gardens (ALR) - requires 16 hrs
    { employee: grace, orgId: sunrise.id, facilityId: gardens.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: henry, orgId: sunrise.id, facilityId: gardens.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: isabel, orgId: sunrise.id, facilityId: gardens.id, completed: "14.5", status: "due_soon", facilityType: "ALR" },
    { employee: jack, orgId: sunrise.id, facilityId: gardens.id, completed: "5.0", status: "incomplete", facilityType: "ALR" },
    { employee: linda, orgId: sunrise.id, facilityId: gardens.id, completed: "11.5", status: "incomplete", facilityType: "ALR" },
    { employee: marcus, orgId: sunrise.id, facilityId: gardens.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: nina, orgId: sunrise.id, facilityId: gardens.id, completed: "12.0", status: "incomplete", facilityType: "ALR" },
    { employee: oscar, orgId: sunrise.id, facilityId: gardens.id, completed: "10.0", status: "incomplete", facilityType: "ALR" },
    { employee: paula, orgId: sunrise.id, facilityId: gardens.id, completed: "1.5", status: "incomplete", facilityType: "ALR" },
    { employee: quinn, orgId: sunrise.id, facilityId: gardens.id, completed: "3.0", status: "incomplete", facilityType: "ALR" },
    // Sunrise Ridge (PCH)
    { employee: rachel, orgId: sunrise.id, facilityId: ridge.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: steven, orgId: sunrise.id, facilityId: ridge.id, completed: "2.0", status: "incomplete", facilityType: "PCH" },
    { employee: teresa, orgId: sunrise.id, facilityId: ridge.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: ulysses, orgId: sunrise.id, facilityId: ridge.id, completed: "5.5", status: "incomplete", facilityType: "PCH" },
    { employee: victoria, orgId: sunrise.id, facilityId: ridge.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: walter, orgId: sunrise.id, facilityId: ridge.id, completed: "9.0", status: "incomplete", facilityType: "PCH" },
    // Sunrise Pavilion (ALR) - requires 16 hrs
    { employee: xena, orgId: sunrise.id, facilityId: pavilion.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: yusuf, orgId: sunrise.id, facilityId: pavilion.id, completed: "6.0", status: "incomplete", facilityType: "ALR" },
    { employee: zoe, orgId: sunrise.id, facilityId: pavilion.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: aaron, orgId: sunrise.id, facilityId: pavilion.id, completed: "12.0", status: "incomplete", facilityType: "ALR" },
    { employee: bette, orgId: sunrise.id, facilityId: pavilion.id, completed: "8.0", status: "incomplete", facilityType: "ALR" },
    // Maple Grove Residence (PCH)
    { employee: karen, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: larry, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "8.0", status: "incomplete", facilityType: "PCH" },
    { employee: mary, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: nathan, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "4.5", status: "incomplete", facilityType: "PCH" },
    { employee: olivia, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: peter, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "10.0", status: "incomplete", facilityType: "PCH" },
    { employee: rosa, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: sam, orgId: maplegrove.id, facilityId: mapleFacility.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    // Maple Grove East (ALR) - requires 16 hrs
    { employee: tina, orgId: maplegrove.id, facilityId: mapleEast.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: uma, orgId: maplegrove.id, facilityId: mapleEast.id, completed: "7.5", status: "incomplete", facilityType: "ALR" },
    { employee: vincent, orgId: maplegrove.id, facilityId: mapleEast.id, completed: "16.0", status: "compliant", facilityType: "ALR" },
    { employee: wendy, orgId: maplegrove.id, facilityId: mapleEast.id, completed: "14.5", status: "due_soon", facilityType: "ALR" },
    { employee: xavier, orgId: maplegrove.id, facilityId: mapleEast.id, completed: "9.5", status: "incomplete", facilityType: "ALR" },
    // Valley Care Main (PCH)
    { employee: yvonne, orgId: valleycare.id, facilityId: valleyMain.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: zachary, orgId: valleycare.id, facilityId: valleyMain.id, completed: "6.5", status: "incomplete", facilityType: "PCH" },
    { employee: amanda, orgId: valleycare.id, facilityId: valleyMain.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: brad, orgId: valleycare.id, facilityId: valleyMain.id, completed: "3.0", status: "incomplete", facilityType: "PCH" },
    { employee: chloe, orgId: valleycare.id, facilityId: valleyMain.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
    { employee: dylan, orgId: valleycare.id, facilityId: valleyMain.id, completed: "4.0", status: "incomplete", facilityType: "PCH" },
    { employee: elena, orgId: valleycare.id, facilityId: valleyMain.id, completed: "12.0", status: "compliant", facilityType: "PCH" },
  ];

  for (const b of hourBucketData) {
    const requiredHours = b.facilityType === "ALR" ? "16" : "12";
    await db.insert(trainingHourBucketsTable).values({
      organizationId: b.orgId,
      facilityId: b.facilityId,
      employeeId: b.employee.id,
      trainingYear: currentYear,
      requiredHours,
      completedHours: b.completed,
      status: b.status,
    });
  }

  // --- Alerts ---
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
      facilityId: manor.id,
      employeeId: irene.id,
      alertType: "overdue",
      title: "Annual Practicum Missing - Irene Nguyen",
      message: "Irene Nguyen has not completed the current year annual practicum.",
      severity: "critical",
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
      organizationId: sunrise.id,
      facilityId: gardens.id,
      employeeId: isabel.id,
      alertType: "expired",
      title: "Trainer Recertification Expired - Isabel Anderson",
      message: "Isabel Anderson's trainer recertification has expired. She cannot train new medication administrators until renewed.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: sunrise.id,
      facilityId: gardens.id,
      employeeId: paula.id,
      alertType: "missing_document",
      title: "Initial Medication Training Missing - Paula Grant",
      message: "Paula Grant has not completed initial medication administration training.",
      severity: "warning",
      status: "open",
    },
    {
      organizationId: sunrise.id,
      facilityId: ridge.id,
      employeeId: steven.id,
      alertType: "missing_document",
      title: "Initial Medication Training Missing - Steven Park",
      message: "Steven Park (hired 140 days ago) has not completed initial medication administration training.",
      severity: "warning",
      status: "open",
    },
    {
      organizationId: sunrise.id,
      facilityId: pavilion.id,
      employeeId: bette.id,
      alertType: "overdue",
      title: "Annual Practicum Missing - Bette Yuen",
      message: "Bette Yuen has not completed the current year annual practicum.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: maplegrove.id,
      facilityId: mapleFacility.id,
      alertType: "due_90",
      title: "Trainer Recertification Due - Mary Harris",
      message: "Mary Harris's trainer recertification is due within 90 days.",
      severity: "info",
      status: "open",
    },
    {
      organizationId: maplegrove.id,
      facilityId: mapleFacility.id,
      employeeId: nathan.id,
      alertType: "overdue",
      title: "Annual Practicum Missing - Nathan Fox",
      message: "Nathan Fox has not completed the current year annual practicum.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: maplegrove.id,
      facilityId: mapleFacility.id,
      alertType: "license_expiring",
      title: "Facility License Expiring Soon - Maple Grove Residence",
      message: "Maple Grove Residence facility license (PCH-2018-0031) expires on 2025-11-30.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: maplegrove.id,
      facilityId: mapleEast.id,
      employeeId: xavier.id,
      alertType: "overdue",
      title: "Annual Practicum Missing - Xavier Owens",
      message: "Xavier Owens has not completed the current year annual practicum.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: valleycare.id,
      facilityId: valleyMain.id,
      employeeId: dylan.id,
      alertType: "missing_document",
      title: "Initial Medication Training Missing - Dylan Marsh",
      message: "Dylan Marsh (hired 130 days ago) has not completed initial medication administration training.",
      severity: "warning",
      status: "open",
    },
    {
      organizationId: valleycare.id,
      facilityId: valleyMain.id,
      employeeId: zachary.id,
      alertType: "overdue",
      title: "Annual Practicum Missing - Zachary Cole",
      message: "Zachary Cole has not completed the current year annual practicum.",
      severity: "critical",
      status: "open",
    },
    {
      organizationId: valleycare.id,
      facilityId: valleyMain.id,
      alertType: "license_expiring",
      title: "Facility License Expiring - Valley Care Main",
      message: "Valley Care Main facility license (PCH-2020-0065) expires on 2026-04-15.",
      severity: "warning",
      status: "open",
    },
  ]);

  console.log("Database seeded successfully!");
  console.log("\nOrganizations: 3 (Sunrise Healthcare, Maple Grove, Valley Care)");
  console.log("Facilities: 7 (4 Sunrise, 2 Maple Grove, 1 Valley Care)");
  console.log("Employees: 53 total");
  console.log("\nDemo credentials:");
  console.log("  Platform Admin: admin@pamedtrack.com / admin123");
  console.log("  Org Admin:      admin@sunrisehealthcare.com / demo123");
  console.log("  Facility Mgr:   manager@sunrisemanor.com / demo123");
  console.log("  Trainer:        trainer@sunrisehealthcare.com / demo123");
  console.log("  Org Admin 2:    admin@maplegrove.com / demo123");
  console.log("  Org Admin 3:    admin@valleycare.com / demo123");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
