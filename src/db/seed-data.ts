/**
 * Reference pools for the seed generator. Kept separate from the generator
 * itself so the shape of the fake org is easy to read and tune.
 */

export const FIRST_NAMES = [
  "Amara", "Priya", "Daniel", "Sofia", "Marcus", "Elena", "Rohan", "Nadia", "Julian", "Keisha",
  "Tomas", "Imani", "Victor", "Lena", "Hassan", "Clara", "Diego", "Yuki", "Arjun", "Mira",
  "Felix", "Zara", "Owen", "Camila", "Noah", "Aisha", "Theo", "Ingrid", "Rafael", "Wren",
  "Kiran", "Beatriz", "Anders", "Leila", "Mateo", "Hana", "Silas", "Nour", "Dmitri", "Talia",
  "Emeka", "Rosa", "Jonas", "Ayesha", "Caleb", "Sana", "Milo", "Freya", "Isaac", "Naomi",
  "Andre", "Farah", "Gabriel", "Lucia", "Hugo", "Anika", "Colin", "Divya", "Ethan", "Margot",
  "Nikolai", "Simone", "Omar", "Thandi", "Pierre", "Valeria", "Quentin", "Rhea", "Sebastian", "Iris",
  "Tariq", "Ursula", "Vikram", "Willa", "Xavier", "Yara", "Zane", "Astrid", "Bram", "Chiara",
  "Devon", "Esme", "Finn", "Greta", "Idris", "Jade", "Kofi", "Liam", "Maya", "Nils",
  "Oscar", "Paloma", "Quinn", "Ravi", "Selma", "Tobias", "Uma", "Viktor", "Wesley", "Zoya",
];

export const LAST_NAMES = [
  "Okafor", "Raghavan", "Lindqvist", "Moreno", "Castellanos", "Whitfield", "Desai", "Hakimi",
  "Sorensen", "Brennan", "Almeida", "Varga", "Nakamura", "Oyelaran", "Petrova", "Fitzgerald",
  "Mbeki", "Kowalski", "Ferreira", "Haddad", "Lindgren", "Abubakar", "Salazar", "Novak",
  "Delacroix", "Mensah", "Bergstrom", "Iqbal", "Santoro", "Vasquez", "Oduya", "Kaminski",
  "Bhatt", "Eriksen", "Montoya", "Achebe", "Rasmussen", "Guerrero", "Tanaka", "Odinga",
  "Marchetti", "Solberg", "Chaudhry", "Espinoza", "Nwosu", "Lindstrom", "Aguilar", "Pillai",
  "Vogel", "Barros", "Hedlund", "Rahman", "Cardoso", "Jankowski", "Osei", "Beaumont",
  "Sandoval", "Thorne", "Malhotra", "Ivanova", "Castillo", "Adebayo", "Falk", "Reyes",
  "Mwangi", "Baptiste", "Carvalho", "Nilsson", "Srinivasan", "Dumont", "Koffi", "Larsen",
  "Quintero", "Bekele", "Fontaine", "Grimaldi", "Hoffmann", "Ivanov", "Jorgensen", "Kapoor",
];

export const UNIVERSITIES = [
  "University of Texas at Austin", "Georgia Institute of Technology", "Purdue University",
  "University of Illinois Urbana-Champaign", "North Carolina State University",
  "Arizona State University", "University of Washington", "Rutgers University",
  "Anna University", "BITS Pilani", "University of Waterloo", "Trinity College Dublin",
  "Technical University of Munich", "Universidad Politecnica de Madrid", "University of Toronto",
  "Delft University of Technology", "University of Manchester", "Politecnico di Milano",
] as const;

export const DEGREES = [
  { qualification: "BSc", weight: 42 },
  { qualification: "BEng", weight: 18 },
  { qualification: "MSc", weight: 24 },
  { qualification: "MEng", weight: 6 },
  { qualification: "MBA", weight: 6 },
  { qualification: "BA", weight: 4 },
] as const;

export const FIELDS_OF_STUDY = [
  "Computer Science", "Software Engineering", "Information Systems", "Electrical Engineering",
  "Mathematics", "Data Science", "Physics", "Business Administration", "Cybersecurity",
  "Human-Computer Interaction", "Statistics", "Finance",
] as const;

export const EXPERIENCE_BLURBS = [
  "Owned the service end to end, from schema design through on-call rotation.",
  "Led a three-person squad through a platform migration with no customer-facing downtime.",
  "Rebuilt the reporting layer, taking a nightly batch down to minutes.",
  "Introduced the testing strategy the team still uses; flaky-test rate fell by two thirds.",
  "First engineer on the product; grew it from prototype to the company's largest revenue line.",
  "Ran the integration surface for enterprise customers, including the compliance work.",
  "Took over a system nobody wanted to touch and made it boring again.",
  "Partnered with design and support to close the loop on the ten worst reported issues.",
] as const;

export const CANDIDATE_COMPANIES = [
  "Accenture", "Infosys", "Tata Consultancy Services", "Cognizant", "Capgemini",
  "Deloitte Consulting", "HCLTech", "Wipro", "LTIMindtree", "Tech Mahindra",
  "Birlasoft", "Hexaware", "Apps Associates", "Inspirage", "Grant Thornton",
  "Northwind Logistics", "Helix Bio", "Vertex Payments", "Brightline Health",
  "Meridian Bank", "Ironwood Retail", "Tidewater Energy", "Solaris Grid",
  "Palisade Manufacturing", "Cobalt Utilities", "Ardent Mobility", "Corvus Systems",
] as const;

export const CITIES = [
  { city: "Austin, TX", tz: "America/Chicago" },
  { city: "Seattle, WA", tz: "America/Los_Angeles" },
  { city: "New York, NY", tz: "America/New_York" },
  { city: "Chicago, IL", tz: "America/Chicago" },
  { city: "Denver, CO", tz: "America/Denver" },
  { city: "Atlanta, GA", tz: "America/New_York" },
  { city: "Boston, MA", tz: "America/New_York" },
  { city: "San Francisco, CA", tz: "America/Los_Angeles" },
  { city: "Toronto, ON", tz: "America/Toronto" },
  { city: "Raleigh, NC", tz: "America/New_York" },
  { city: "Phoenix, AZ", tz: "America/Phoenix" },
  { city: "Minneapolis, MN", tz: "America/Chicago" },
  { city: "Dublin, IE", tz: "Europe/Dublin" },
  { city: "London, UK", tz: "Europe/London" },
  { city: "Berlin, DE", tz: "Europe/Berlin" },
  { city: "Bengaluru, IN", tz: "Asia/Kolkata" },
  { city: "Remote (US)", tz: "America/New_York" },
];

export interface JobFamily {
  key: string;
  department: string;
  titles: { title: string; seniority: string; base: [number, number] }[];
  skills: string[];
  requirements: string[];
  blurb: string;
}

export const JOB_FAMILIES: JobFamily[] = [
  {
    key: "oracle_dba",
    department: "Oracle",
    titles: [
      { title: "Oracle DBA", seniority: "mid", base: [115000, 140000] },
      { title: "Senior Oracle DBA", seniority: "senior", base: [140000, 175000] },
      { title: "Lead Database Engineer", seniority: "staff", base: [175000, 210000] },
    ],
    skills: [
      "Oracle 19c",
      "RAC",
      "Data Guard",
      "RMAN",
      "PL/SQL",
      "Performance Tuning",
      "GoldenGate",
      "ASM",
      "Exadata",
    ],
    requirements: [
      "Production ownership of a multi-terabyte Oracle estate",
      "Hands-on RAC and Data Guard, including a real failover you ran",
      "Comfortable being the escalation point during a month-end close",
    ],
    blurb:
      "Own the database layer behind the client's finance and supply-chain systems. Backup and recovery, upgrade planning, and the performance work that keeps period close inside its window.",
  },
  {
    key: "oracle_ebs",
    department: "Oracle",
    titles: [
      { title: "Oracle EBS Technical Consultant", seniority: "mid", base: [110000, 138000] },
      { title: "Senior Oracle EBS Consultant", seniority: "senior", base: [138000, 172000] },
      { title: "Oracle EBS Solution Architect", seniority: "principal", base: [175000, 215000] },
    ],
    skills: [
      "Oracle EBS R12",
      "PL/SQL",
      "Oracle Forms",
      "BI Publisher",
      "Workflow Builder",
      "AP / AR",
      "Order Management",
      "OAF",
      "Interfaces & Conversions",
    ],
    requirements: [
      "At least two full-lifecycle R12 implementations or upgrades",
      "Fluent across Financials and Supply Chain modules",
      "Able to write the functional spec and then build against it",
    ],
    blurb:
      "Extend and support an R12 estate that the client's finance operation runs on. Interfaces, custom reports, and the month-end issues nobody else can unpick.",
  },
  {
    key: "oracle_fusion",
    department: "Oracle",
    titles: [
      { title: "Oracle Fusion Functional Consultant", seniority: "mid", base: [118000, 145000] },
      { title: "Senior Fusion Cloud Consultant", seniority: "senior", base: [145000, 182000] },
      { title: "Fusion Cloud Architect", seniority: "principal", base: [185000, 225000] },
    ],
    skills: [
      "Oracle Fusion Cloud",
      "Fusion Financials",
      "Fusion SCM",
      "Fusion HCM",
      "FBDI",
      "BI Publisher",
      "OTBI",
      "Fast Formula",
      "Redwood",
    ],
    requirements: [
      "Delivered at least one EBS-to-Fusion migration end to end",
      "Strong on configuration workbooks and FBDI data loads",
      "Can run a CRP session with the client's finance team",
    ],
    blurb:
      "Lead the move from on-premise EBS to Fusion Cloud. Requirements workshops, configuration, data migration and the quarterly-update regression cycle that follows go-live.",
  },
  {
    key: "oracle_integration",
    department: "Integration",
    titles: [
      { title: "OIC Developer", seniority: "mid", base: [112000, 140000] },
      { title: "Senior Integration Developer", seniority: "senior", base: [140000, 178000] },
      { title: "Integration Architect", seniority: "principal", base: [180000, 220000] },
    ],
    skills: [
      "Oracle Integration Cloud",
      "SOA Suite",
      "REST / SOAP",
      "VBCS",
      "OCI",
      "XSLT",
      "API Gateway",
      "Oracle Autonomous DB",
      "Event Handling",
    ],
    requirements: [
      "Built production OIC integrations under a real SLA",
      "Comfortable debugging a failed flow against the client's downstream system",
      "Understands idempotency and replay, not just the happy path",
    ],
    blurb:
      "Own the integration layer between Fusion, legacy EBS and everything the client bolted on over twenty years. Error handling and observability matter here more than new build.",
  },
  {
    key: "sap",
    department: "SAP",
    titles: [
      { title: "SAP ABAP Developer", seniority: "mid", base: [115000, 142000] },
      { title: "Senior SAP S/4HANA Consultant", seniority: "senior", base: [145000, 185000] },
      { title: "SAP Solution Architect", seniority: "principal", base: [190000, 235000] },
    ],
    skills: [
      "SAP S/4HANA",
      "ABAP",
      "SAP Fiori",
      "SAP MM",
      "SAP FICO",
      "CDS Views",
      "BTP",
      "IDoc",
      "SAP BW",
    ],
    requirements: [
      "At least one S/4HANA conversion or greenfield implementation",
      "Strong in one core module plus the ABAP to extend it",
      "Has worked through a hypercare period, not only a build phase",
    ],
    blurb:
      "Deliver against an S/4HANA programme already in flight. Expect a mix of configuration, custom development and the integration work that appears once the first data load runs.",
  },
  {
    key: "salesforce",
    department: "Salesforce",
    titles: [
      { title: "Salesforce Developer", seniority: "mid", base: [110000, 138000] },
      { title: "Senior Salesforce Developer", seniority: "senior", base: [138000, 175000] },
      { title: "Salesforce Technical Architect", seniority: "principal", base: [180000, 220000] },
    ],
    skills: [
      "Salesforce",
      "Apex",
      "Lightning Web Components",
      "SOQL",
      "Sales Cloud",
      "Service Cloud",
      "Flow",
      "MuleSoft",
      "CPQ",
    ],
    requirements: [
      "Shipped Apex and LWC into a managed release process",
      "Understands governor limits well enough to design around them",
      "Has owned a sandbox-to-production deployment pipeline",
    ],
    blurb:
      "Build on a Salesforce org that has grown past what clicks-not-code can carry. Declarative where it fits, Apex where it does not, and a real deployment pipeline either way.",
  },
  {
    key: "dotnet",
    department: "Application Development",
    titles: [
      { title: ".NET Developer", seniority: "mid", base: [110000, 138000] },
      { title: "Senior .NET Engineer", seniority: "senior", base: [140000, 178000] },
      { title: "Lead Application Engineer", seniority: "staff", base: [180000, 220000] },
    ],
    skills: [
      ".NET 8",
      "C#",
      "ASP.NET Core",
      "Entity Framework",
      "SQL Server",
      "Azure",
      "REST APIs",
      "xUnit",
      "Blazor",
    ],
    requirements: [
      "Production ownership of an ASP.NET Core service",
      "Strong relational modelling and query tuning on SQL Server",
      "Comfortable working against an enterprise release calendar",
    ],
    blurb:
      "Build and maintain the applications sitting around the client's ERP: approval workflows, customer portals, and the reporting front ends finance actually uses.",
  },
  {
    key: "data",
    department: "Data & Analytics",
    titles: [
      { title: "Data Engineer", seniority: "mid", base: [120000, 148000] },
      { title: "Senior Data Engineer", seniority: "senior", base: [148000, 188000] },
      { title: "Lead Data Engineer", seniority: "staff", base: [190000, 230000] },
    ],
    skills: [
      "Informatica",
      "Snowflake",
      "SQL",
      "Python",
      "Oracle Analytics Cloud",
      "Data Modelling",
      "dbt",
      "Airflow",
      "Power BI",
    ],
    requirements: [
      "Built a warehouse the business actually reports from",
      "Fluent in dimensional modelling, not just pipeline plumbing",
      "Has reconciled a warehouse against a source ERP and won",
    ],
    blurb:
      "Move finance and supply-chain data out of the ERP and into something the business can report on, and keep the numbers agreeing with the source when it changes.",
  },
  {
    key: "cloud",
    department: "Cloud & Infrastructure",
    titles: [
      { title: "Cloud Engineer", seniority: "mid", base: [122000, 150000] },
      { title: "Senior Cloud Engineer", seniority: "senior", base: [150000, 190000] },
      { title: "Principal Infrastructure Engineer", seniority: "principal", base: [195000, 240000] },
    ],
    skills: [
      "OCI",
      "Azure",
      "Terraform",
      "Kubernetes",
      "Linux",
      "CI/CD",
      "Observability",
      "Networking",
      "Disaster Recovery",
    ],
    requirements: [
      "Run production infrastructure under a real availability target",
      "Infrastructure as code by default, not as an afterthought",
      "Has been on call for something that mattered",
    ],
    blurb:
      "Own the platform the ERP estate runs on. Landing zones, resilience, and the migration work that comes with moving a regulated workload off the client's own metal.",
  },
  {
    key: "security",
    department: "Security",
    titles: [
      { title: "Application Security Engineer", seniority: "mid", base: [125000, 152000] },
      { title: "Senior Security Engineer", seniority: "senior", base: [152000, 192000] },
      { title: "Security Architect", seniority: "principal", base: [195000, 240000] },
    ],
    skills: [
      "IAM",
      "SoD Controls",
      "SIEM",
      "Cloud Security",
      "Application Security",
      "SOX Compliance",
      "Incident Response",
      "Threat Modelling",
      "Penetration Testing",
    ],
    requirements: [
      "Has run an access review that survived an external audit",
      "Understands segregation of duties in an ERP context",
      "Can write the finding and the remediation, not just the finding",
    ],
    blurb:
      "Secure an estate that carries the client's financial controls. Access governance, segregation of duties, and the audit evidence that has to exist before the auditors ask.",
  },
  {
    key: "qa",
    department: "Quality",
    titles: [
      { title: "QA Automation Engineer", seniority: "mid", base: [102000, 128000] },
      { title: "Senior Test Engineer", seniority: "senior", base: [128000, 162000] },
      { title: "Test Architect", seniority: "staff", base: [165000, 200000] },
    ],
    skills: [
      "Selenium",
      "Tosca",
      "Test Strategy",
      "API Testing",
      "Oracle Fusion Testing",
      "Regression Automation",
      "Playwright",
      "CI/CD",
      "UAT Coordination",
    ],
    requirements: [
      "Automated regression against a package application, not just a web app",
      "Has coordinated UAT with business users through a release",
      "Knows what is worth automating and what is not",
    ],
    blurb:
      "Own regression for an estate that takes a vendor update every quarter. The job is keeping a release calendar credible without a test suite nobody trusts.",
  },
  {
    key: "delivery",
    department: "Program Delivery",
    titles: [
      { title: "Business Analyst", seniority: "mid", base: [105000, 130000] },
      { title: "Senior Project Manager", seniority: "senior", base: [135000, 172000] },
      { title: "Programme Director", seniority: "director", base: [180000, 225000] },
    ],
    skills: [
      "Requirements Gathering",
      "Stakeholder Management",
      "ERP Implementation",
      "Change Management",
      "Agile Delivery",
      "Vendor Management",
      "Cutover Planning",
      "Budget Ownership",
      "UAT Coordination",
    ],
    requirements: [
      "Has run a cutover weekend and the week that followed",
      "Comfortable holding a steering committee to a decision",
      "Credible with both the client's finance lead and the technical team",
    ],
    blurb:
      "Run the delivery side of an ERP programme: scope, sequencing, the client relationship, and the cutover plan everyone will be working from at 2am.",
  },
];

export const CLIENT_SEEDS = [
  { name: "Northgate Financial", industry: "Financial Services", location: "New York, NY", tier: "strategic" },
  { name: "Helios Health Systems", industry: "Healthcare", location: "Boston, MA", tier: "strategic" },
  { name: "Arclight Software", industry: "SaaS", location: "Austin, TX", tier: "key" },
  { name: "Vantage Logistics", industry: "Supply Chain", location: "Chicago, IL", tier: "key" },
  { name: "Cinder Energy", industry: "Energy", location: "Denver, CO", tier: "standard" },
  { name: "Bluepeak Retail", industry: "Retail", location: "Minneapolis, MN", tier: "key" },
  { name: "Terraform Insurance", industry: "Insurance", location: "Hartford, CT", tier: "standard" },
  { name: "Quanta Semiconductor", industry: "Hardware", location: "Phoenix, AZ", tier: "strategic" },
  { name: "Larkspur Education", industry: "EdTech", location: "Raleigh, NC", tier: "standard" },
  { name: "Cardinal Media Group", industry: "Media", location: "Los Angeles, CA", tier: "standard" },
  { name: "Fathom Marine", industry: "Industrial", location: "Seattle, WA", tier: "standard" },
  { name: "Aurora Biotech", industry: "Life Sciences", location: "San Diego, CA", tier: "key" },
];

/**
 * The desk.
 *
 * Recruiters and coordinators work for the agency; hiring managers and
 * interviewers stand in for the client-side people who actually run the loop.
 * Their departments match the practice areas in `JOB_FAMILIES`, which is how
 * the generator pairs a requirement with a plausible panel.
 */
export const TEAM_SEEDS = [
  { name: "Dana Whitfield", role: "admin", title: "Managing Director", department: "Leadership", capacity: 0 },
  { name: "Marcus Ellery", role: "admin", title: "Head of Delivery", department: "Leadership", capacity: 4 },

  { name: "Priya Raghavan", role: "recruiter", title: "Principal Recruiter, Oracle Practice", department: "Delivery", capacity: 14 },
  { name: "Jordan Okafor", role: "recruiter", title: "Senior Recruiter, Oracle Practice", department: "Delivery", capacity: 12 },
  { name: "Sofia Moreno", role: "recruiter", title: "Senior Recruiter, SAP Practice", department: "Delivery", capacity: 12 },
  { name: "Elias Brennan", role: "recruiter", title: "Recruiter, Salesforce & Apps", department: "Delivery", capacity: 10 },
  { name: "Naomi Sorensen", role: "recruiter", title: "Recruiter, Cloud & Infrastructure", department: "Delivery", capacity: 10 },
  { name: "Rohan Desai", role: "recruiter", title: "Recruiter, Data & Analytics", department: "Delivery", capacity: 11 },
  { name: "Camila Ferreira", role: "recruiter", title: "Recruiter, Programme Delivery", department: "Delivery", capacity: 10 },
  { name: "Tobias Lindqvist", role: "recruiter", title: "Sourcing Lead", department: "Delivery", capacity: 9 },

  { name: "Aisha Hakimi", role: "coordinator", title: "Senior Delivery Coordinator", department: "Delivery", capacity: 0 },
  { name: "Felix Novak", role: "coordinator", title: "Delivery Coordinator", department: "Delivery", capacity: 0 },

  { name: "Victor Castellanos", role: "hiring_manager", title: "Director, Oracle Applications", department: "Oracle", capacity: 0 },
  { name: "Yuki Nakamura", role: "hiring_manager", title: "Head of ERP", department: "Oracle", capacity: 0 },
  { name: "Lena Petrova", role: "hiring_manager", title: "Integration Delivery Manager", department: "Integration", capacity: 0 },
  { name: "Imani Mbeki", role: "hiring_manager", title: "SAP Programme Director", department: "SAP", capacity: 0 },
  { name: "Clara Fitzgerald", role: "hiring_manager", title: "Head of CRM", department: "Salesforce", capacity: 0 },
  { name: "Diego Salazar", role: "hiring_manager", title: "Head of Application Development", department: "Application Development", capacity: 0 },
  { name: "Hassan Almeida", role: "hiring_manager", title: "Head of Data", department: "Data & Analytics", capacity: 0 },
  { name: "Beatriz Cardoso", role: "hiring_manager", title: "Infrastructure Director", department: "Cloud & Infrastructure", capacity: 0 },
  { name: "Anders Kowalski", role: "hiring_manager", title: "CISO", department: "Security", capacity: 0 },
  { name: "Silas Montoya", role: "hiring_manager", title: "PMO Lead", department: "Program Delivery", capacity: 0 },

  { name: "Kiran Pillai", role: "interviewer", title: "Oracle Fusion Architect", department: "Oracle", capacity: 0 },
  { name: "Margot Delacroix", role: "interviewer", title: "Principal EBS Consultant", department: "Oracle", capacity: 0 },
  { name: "Gabriel Santoro", role: "interviewer", title: "Integration Architect", department: "Integration", capacity: 0 },
  { name: "Talia Eriksen", role: "interviewer", title: "SAP S/4HANA Lead", department: "SAP", capacity: 0 },
  { name: "Freya Bergstrom", role: "interviewer", title: "Salesforce Technical Lead", department: "Salesforce", capacity: 0 },
  { name: "Oscar Lindgren", role: "interviewer", title: "Lead .NET Engineer", department: "Application Development", capacity: 0 },
  { name: "Emeka Nwosu", role: "interviewer", title: "Lead Data Engineer", department: "Data & Analytics", capacity: 0 },
  { name: "Ingrid Solberg", role: "interviewer", title: "Principal Cloud Engineer", department: "Cloud & Infrastructure", capacity: 0 },
  { name: "Nour Haddad", role: "interviewer", title: "Staff Security Engineer", department: "Security", capacity: 0 },
  { name: "Selma Vasquez", role: "interviewer", title: "Test Architect", department: "Quality", capacity: 0 },
  { name: "Quentin Oduya", role: "interviewer", title: "Senior Programme Manager", department: "Program Delivery", capacity: 0 },
] as const;

export const CONTACT_TEMPLATES = [
  {
    channel: "call",
    direction: "outbound",
    subject: "Intro call",
    body: "Walked through the role and the client. Comfortable with the onsite expectation, wants to understand the contract length before committing. Sending the JD across.",
  },
  {
    channel: "call",
    direction: "inbound",
    subject: "Rate discussion",
    body: "Called back about the rate. Currently on {rate}/hr elsewhere and would move for the right project. Flagged that they are interviewing in one other process.",
  },
  {
    channel: "email",
    direction: "outbound",
    subject: "Submitting your profile",
    body: "Confirmed in writing what we are putting forward and to which client. Asked them to hold the date range we discussed for the interview.",
  },
  {
    channel: "email",
    direction: "inbound",
    subject: "Updated CV",
    body: "Sent through an updated CV with the most recent implementation added. Asked when the client is likely to come back.",
  },
  {
    channel: "linkedin",
    direction: "outbound",
    subject: "First approach",
    body: "Reached out cold about the requirement. Open to a conversation but not actively looking — worth keeping warm rather than pushing.",
  },
  {
    channel: "sms",
    direction: "outbound",
    subject: "Interview confirmation",
    body: "Texted the joining link and the panel names ahead of the round. Confirmed received.",
  },
  {
    channel: "call",
    direction: "outbound",
    subject: "Post-interview debrief",
    body: "Their read on the round was positive. Some concern about the pace of the programme; reassured them the client has budget approved through the year.",
  },
  {
    channel: "meeting",
    direction: "outbound",
    subject: "Coffee and briefing",
    body: "Met in person before the client round. Went through the panel, the way they run the interview, and what they will probe hardest on.",
  },
] as const;

export const NOTE_TEMPLATES = [
  "Spoke for 25 minutes. Strong on {skill}, motivated by scope rather than title. Flagged compensation expectations early.",
  "Left a voicemail and followed up by email. Candidate is interviewing in two other processes, so we should compress the loop.",
  "Hiring manager reviewed the profile and wants to move forward, but asked us to probe depth on {skill} in the screen.",
  "Candidate is on a {notice}-day notice period. Worth aligning the start date conversation before we go to offer.",
  "Referral from an internal engineer who worked with them previously. Vouched for their debugging instincts under pressure.",
  "Background is adjacent rather than exact. Recommend we screen anyway given the shortage of {skill} in this market.",
  "Reschedule requested for the technical round. Coordinator has offered three new slots for next week.",
  "Panel debrief leaned positive overall. One dissenting signal on {skill}, so we added a follow-up conversation.",
  "Candidate asked detailed questions about the team's on-call rotation and roadmap ownership. Good sign of seriousness.",
  "Compensation expectations came in above band. Escalated to the hiring manager to check appetite for an exception.",
];

export const STRENGTH_TEMPLATES = [
  "Explained trade-offs clearly and reached for concrete production examples rather than theory.",
  "Strong systems instincts; decomposed the problem before touching implementation details.",
  "Handled ambiguity well and asked sharp clarifying questions throughout.",
  "Excellent collaboration signal. Took the hint, iterated, and credited the suggestion.",
  "Deep hands-on fluency with the core stack, including failure modes and operational edges.",
  "Communicated at the right altitude for the audience without over-explaining.",
];

export const CONCERN_TEMPLATES = [
  "Limited exposure to the scale we operate at; would need ramp support in the first quarter.",
  "Testing discipline was thinner than expected for the level.",
  "Struggled to articulate the reasoning behind an earlier architectural decision.",
  "Some hesitancy around ownership of on-call and production incidents.",
  "Depth is narrower than the breadth on the resume suggested.",
  "Answers stayed abstract when pushed for specifics on their own contribution.",
];

export const AGENDA_TEMPLATES = [
  "Intro, role context, walk through recent projects, candidate questions.",
  "Live problem-solving on a realistic scenario from the team backlog.",
  "Architecture discussion: scale the described system to 10x traffic.",
  "Behavioural deep dive on conflict, ownership and prioritisation.",
  "Portfolio walkthrough followed by a critique exercise.",
  "Values conversation and open Q&A with the hiring manager.",
];
