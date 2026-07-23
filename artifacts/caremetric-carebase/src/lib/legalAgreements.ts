export const LEGAL_EFFECTIVE_DATE = "July 14, 2026";
export const LEGAL_COMPANY_NAME = "CareMetric AI LLC";
export const LEGAL_COMPANY_LOCATION = "Cambria County, Pennsylvania";
export const SERVICE_AGREEMENT_VERSION = "CareMetric-Facility-Admin-Service-Agreement-v2026-07-14";
export const BAA_VERSION = "CareMetric-HIPAA-BAA-v2026-07-14";

export interface LegalSection {
  title: string;
  body: string[];
}

export const facilityAdminAgreementSections: LegalSection[] = [
  { title: "Parties and authority", body: [
    `This Facility Administrator Platform Agreement is between ${LEGAL_COMPANY_NAME}, a Pennsylvania limited liability company located in ${LEGAL_COMPANY_LOCATION} ("CareMetric," "we," "us," or "our"), and the facility, provider, organization, or legal entity identified during signup ("Customer," "Facility," "you," or "your"). The individual completing signup represents that they are authorized to bind the Customer and each facility they onboard to these terms.`,
    "If the signer is acting for multiple licensed facilities or affiliated entities, the signer confirms they have authority for each participating entity and will keep facility, license, administrator, and billing information accurate.",
  ] },
  { title: "Services", body: [
    "CareMetric provides a healthcare learning, training, compliance, documentation, reporting, documentation-management, resident operations, and administrative workflow platform for Pennsylvania personal care homes, assisted living facilities (ALFs), and related care settings.",
    "The platform may include training matrices, employee records, credential tracking, incident and complaint workflows, resident-administrative workflows, policy attestation, notifications, reporting, AI-assisted drafting or summaries, guest documentation links, integrations, and related support services.",
    "CareMetric is not a law firm, accounting firm, insurer, licensing agency, medical provider, clinical decision maker, or substitute for Customer's professional judgment. Customer remains responsible for determining whether platform outputs, templates, reminders, and workflows satisfy applicable law, survey expectations, contracts, payer requirements, and internal policy.",
  ] },
  { title: "Customer responsibilities", body: [
    "Customer is responsible for obtaining and maintaining all licenses, registrations, consents, notices, policies, workforce permissions, user authorizations, and resident or representative permissions required for Customer's use of the services.",
    "Customer will ensure that data entered into the platform is accurate, lawful, minimum necessary, and appropriate for the intended workflow. Customer will not upload data unless it has the right to do so.",
    "Customer will configure roles, facility assignments, user access, notification recipients, and integrations using the principle of least privilege and will promptly deactivate users who no longer need access.",
    "Customer is responsible for reviewing AI-assisted or template-generated materials before relying on, distributing, filing, or submitting them. Customer will not treat generated content as legal, clinical, licensing, employment, or reimbursement advice.",
  ] },
  { title: "Acceptable use", body: [
    "Customer and its users may use the services only for lawful business operations related to facilities Customer owns, operates, manages, audits, or supports with proper authorization.",
    "Customer will not misuse the services, attempt unauthorized access, probe security controls, reverse engineer restricted components, interfere with service operation, submit malicious code, use the services to train competing models or products, or use the services for unlawful discrimination, harassment, surveillance, or retaliation.",
    "Customer will not upload payment-card data, consumer credit reports, psychotherapy notes, genetic information, biometric templates, or other high-risk data unless CareMetric has expressly agreed in writing that the data type is supported.",
  ] },
  { title: "Accounts, security, and audit logs", body: [
    "Customer is responsible for all activity under its tenant and user accounts except to the extent caused by CareMetric's breach of this Agreement. Customer will require strong passwords, protect credentials, and promptly notify CareMetric of suspected unauthorized access.",
    "CareMetric may maintain audit logs, access records, security events, delivery records, and administrative metadata to operate the services, investigate abuse, support compliance, preserve documentation, and satisfy legal obligations.",
  ] },
  { title: "Data rights and confidentiality", body: [
    "As between the parties, Customer owns Customer Data. Customer grants CareMetric the rights needed to host, process, transmit, display, secure, back up, analyze, and support Customer Data for the services and as otherwise allowed by this Agreement and the Business Associate Agreement below.",
    "Each party will protect the other's nonpublic information using reasonable administrative, technical, and physical safeguards and will use it only for purposes permitted by the parties' agreements or law.",
  ] },
  { title: "Privacy, HIPAA, and regulated data", body: [
    "To the extent Customer is a Covered Entity or Business Associate and CareMetric creates, receives, maintains, or transmits Protected Health Information for Customer, the Business Associate Agreement displayed with this signup is incorporated into and controls HIPAA-regulated processing.",
    "If there is a conflict between this Agreement and the Business Associate Agreement regarding Protected Health Information, the Business Associate Agreement controls for that information.",
  ] },
  { title: "Fees, subscriptions, and taxes", body: [
    "Fees, subscription terms, pilots, trials, usage limits, implementation services, and payment timing are governed by the order form, online checkout, invoice, quote, or written commercial terms accepted by Customer. Unless stated otherwise, fees are non-refundable except where required by law or expressly agreed in writing.",
    "Customer is responsible for taxes, governmental charges, and third-party fees arising from Customer's subscription or integrations, excluding taxes based on CareMetric's net income.",
  ] },
  { title: "Availability, support, and changes", body: [
    "CareMetric will use commercially reasonable efforts to make the services available and secure. The services may be unavailable for maintenance, upgrades, emergencies, third-party outages, force majeure events, or circumstances beyond CareMetric's reasonable control.",
    "CareMetric may update features, user interfaces, templates, documentation, controls, and integrations. CareMetric will not materially reduce core security commitments for active subscriptions without a reasonable replacement or notice where practicable.",
  ] },
  { title: "Third-party services and integrations", body: [
    "The services may interoperate with hosting providers, email or SMS providers, Supabase, AI providers, identity services, payment processors, and Customer-selected integrations. Third-party services are governed by their own terms, and CareMetric is not responsible for third-party acts or omissions outside CareMetric's control.",
    "Customer authorizes CareMetric to transmit Customer Data to configured third-party services as needed to provide the requested functionality.",
  ] },
  { title: "Compliance disclaimers", body: [
    "Regulatory citations, readiness tools, surveys, reminders, and document templates are operational aids. Laws, regulations, agency interpretations, and facility-specific requirements can change. Customer must verify current requirements with qualified counsel, licensing advisors, clinicians, administrators, or regulators as appropriate.",
    "CareMetric does not guarantee survey outcomes, licensing decisions, reimbursement, employment decisions, deficiency avoidance, or legal compliance.",
  ] },
  { title: "Intellectual property", body: [
    "CareMetric and its licensors retain all rights in the services, software, designs, workflows, platform content, documentation, analytics, and know-how, excluding Customer Data. Customer receives a limited, non-exclusive, non-transferable right to use the services during the applicable subscription term.",
    "Customer may use platform-generated operational records for Customer's internal business, compliance, and facility operations, subject to this Agreement and applicable law.",
  ] },
  { title: "Warranties and disclaimers", body: [
    "Each party represents that it has authority to enter into this Agreement. Customer represents that its use of the services and Customer Data will comply with applicable law.",
    "Except as expressly stated, the services are provided without warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted operation, or error-free results to the maximum extent permitted by law.",
  ] },
  { title: "Limitation of liability", body: [
    "To the maximum extent permitted by law, neither party will be liable for indirect, incidental, special, consequential, exemplary, punitive, lost-profit, lost-revenue, business-interruption, or loss-of-goodwill damages arising from this Agreement.",
    "Except for payment obligations, confidentiality breaches, HIPAA obligations under the Business Associate Agreement, misuse of intellectual property, fraud, willful misconduct, or liabilities that cannot legally be limited, each party's aggregate liability is limited to the amounts Customer paid or payable to CareMetric for the services during the twelve months before the event giving rise to liability.",
  ] },
  { title: "Indemnification", body: [
    "Customer will defend and indemnify CareMetric from third-party claims arising from Customer Data, Customer's unlawful use of the services, Customer's facility operations, Customer's professional decisions, or Customer's breach of this Agreement.",
    "CareMetric will defend and indemnify Customer from third-party claims alleging that the unmodified services, as provided by CareMetric, infringe a United States intellectual property right, subject to customary exclusions for Customer Data, combinations not supplied by CareMetric, misuse, or continued use after CareMetric provides a non-infringing alternative.",
  ] },
  { title: "Term, suspension, and termination", body: [
    "This Agreement begins when the facility administrator accepts it during signup and continues while Customer uses the services or has an active order, unless terminated earlier.",
    "CareMetric may suspend access for nonpayment, security risk, suspected unlawful use, material breach, or legal requirement. Either party may terminate for material breach if the breach is not cured within thirty days after written notice, unless immediate action is required by law or security necessity.",
    "Upon termination, Customer should export needed records before access ends. CareMetric may retain or delete Customer Data according to its retention practices, legal obligations, backup cycles, and the Business Associate Agreement.",
  ] },
  { title: "Governing law and venue", body: [
    "This Agreement is governed by the laws of the Commonwealth of Pennsylvania, without regard to conflict-of-law rules. Subject to any mandatory arbitration or small-claims rights in an applicable order form, the state and federal courts serving Cambria County, Pennsylvania are the exclusive venue for disputes arising from this Agreement.",
  ] },
  { title: "Electronic signature and complete agreement", body: [
    "By checking the acceptance box and submitting signup, the signer electronically signs this Agreement and the Business Associate Agreement, confirms authority to bind Customer, and agrees that electronic records and signatures have the same effect as handwritten signatures.",
    "This Agreement, the Business Associate Agreement, and any accepted order form or written commercial terms are the complete agreement for the services and supersede prior discussions about the same subject.",
  ] },
];

export const baaSections: LegalSection[] = [
  { title: "Purpose and relationship", body: [
    `This Business Associate Agreement ("BAA") is between ${LEGAL_COMPANY_NAME} ("Business Associate") and the Customer identified during signup ("Covered Entity" or "Business Associate Customer," as applicable). It applies when CareMetric creates, receives, maintains, or transmits Protected Health Information ("PHI") for Customer in connection with the services.`,
    "This BAA is intended to satisfy HIPAA and HITECH requirements at 45 C.F.R. Parts 160 and 164. Capitalized terms not defined here have the meanings given in HIPAA.",
  ] },
  { title: "Permitted uses and disclosures", body: [
    "Business Associate may use and disclose PHI to provide, secure, support, improve, administer, and document the services for Customer; to perform obligations under the service agreement; and as Required by Law.",
    "Business Associate may use PHI for its proper management and administration and to carry out its legal responsibilities, provided disclosures for those purposes are Required by Law or Business Associate obtains reasonable assurances that the recipient will keep the PHI confidential and notify Business Associate of breaches.",
    "Business Associate may use PHI to create de-identified information under 45 C.F.R. § 164.514 and may use de-identified information as permitted by law and contract.",
  ] },
  { title: "Minimum necessary and restrictions", body: [
    "Business Associate will make reasonable efforts to use, disclose, and request only the minimum necessary PHI to accomplish the intended purpose, except where HIPAA does not require minimum necessary limitations.",
    "Business Associate will not use or disclose PHI in a manner that would violate the HIPAA Privacy Rule if done by Customer, except for permitted management, administration, data aggregation, and legal-responsibility uses described in this BAA.",
    "Business Associate will comply with restrictions on PHI use or disclosure that Customer communicates in writing to the extent the restriction is required by HIPAA and technically feasible within the services.",
  ] },
  { title: "Safeguards", body: [
    "Business Associate will implement reasonable and appropriate administrative, physical, and technical safeguards designed to protect the confidentiality, integrity, and availability of electronic PHI and to prevent uses or disclosures not permitted by this BAA.",
    "Safeguards may include access controls, role-based permissions, audit logging, encryption in transit, hosted infrastructure controls, backup practices, vulnerability management, incident response, workforce access management, and vendor management appropriate to the services.",
  ] },
  { title: "Reporting security incidents and breaches", body: [
    "Business Associate will report to Customer any Breach of Unsecured PHI without unreasonable delay and in no event later than sixty calendar days after discovery, unless a law-enforcement delay applies.",
    "The report will include, to the extent known, the nature of the Breach, types of PHI involved, affected individuals or records, mitigation steps, and information reasonably needed for Customer's notification obligations.",
    "Business Associate will report Security Incidents involving PHI. The parties acknowledge that routine unsuccessful attempts such as pings, scans, blocked malware, or unsuccessful login attempts may be reported in aggregate or through generally available security documentation rather than individual notices, unless they indicate a material threat or successful compromise.",
  ] },
  { title: "Subcontractors", body: [
    "Business Associate may use subcontractors and service providers to provide the services. Business Associate will ensure that subcontractors that create, receive, maintain, or transmit PHI on Business Associate's behalf agree to written restrictions and conditions at least as protective as those in this BAA for the PHI they handle.",
  ] },
  { title: "Access, amendment, and accounting", body: [
    "To the extent PHI in the services is part of a Designated Record Set maintained by Business Associate for Customer, Business Associate will make PHI available to Customer so Customer can meet access and amendment obligations under 45 C.F.R. §§ 164.524 and 164.526.",
    "Business Associate will document disclosures of PHI that must be accounted for under 45 C.F.R. § 164.528 and provide information reasonably necessary for Customer to respond to an accounting request, excluding disclosures not required to be included by HIPAA.",
  ] },
  { title: "Government access and compliance", body: [
    "Business Associate will make its internal practices, books, and records relating to PHI available to the Secretary of the U.S. Department of Health and Human Services as required to determine Customer's HIPAA compliance.",
    "Business Associate will comply with applicable provisions of the HIPAA Security Rule and with applicable Business Associate obligations under the Privacy Rule and Breach Notification Rule.",
  ] },
  { title: "Customer obligations", body: [
    "Customer will not request Business Associate to use or disclose PHI in a way that would violate HIPAA if done by Customer. Customer is responsible for notices of privacy practices, authorizations, consents, restrictions, user provisioning, minimum necessary configuration, facility policies, and determining whether information maintained in the services is part of a Designated Record Set.",
    "Customer will notify Business Associate of limitations in Customer's notice of privacy practices, agreed restrictions, or permission changes that may affect Business Associate's use or disclosure of PHI.",
  ] },
  { title: "Data aggregation and de-identification", body: [
    "Business Associate may provide data aggregation services relating to Customer's health care operations as permitted by HIPAA.",
    "Business Associate may de-identify PHI in accordance with HIPAA. De-identified information is not PHI and may be used for analytics, benchmarking, service improvement, safety, security, and product development, provided it is not re-identified except as permitted by law.",
  ] },
  { title: "Termination and return or destruction", body: [
    "Customer may terminate the services or this BAA if Business Associate materially breaches this BAA and does not cure the breach within a reasonable cure period, unless cure is not possible.",
    "Upon termination, Business Associate will return or destroy PHI if feasible. If return or destruction is infeasible, Business Associate may retain PHI subject to continued protections and limit further uses and disclosures to those purposes that make return or destruction infeasible, including legal, backup, archival, security, and dispute-resolution obligations.",
  ] },
  { title: "Precedence", body: [
    "If this BAA conflicts with the service agreement regarding PHI, this BAA controls. If HIPAA is amended in a way that materially affects this BAA, the parties will interpret this BAA to comply with HIPAA and will amend it if reasonably necessary.",
  ] },
];
