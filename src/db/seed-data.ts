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

export const CANDIDATE_COMPANIES = [
  "Northwind Logistics", "Helix Bio", "Aperture Labs", "Vertex Payments", "Brightline Health",
  "Corvus Systems", "Lumen Analytics", "Kestrel Robotics", "Solaris Grid", "Meridian Bank",
  "Ironwood Retail", "Palisade Software", "Cobalt Interactive", "Tidewater Energy", "Ardent Mobility",
  "Foundry Digital", "Crestline Insurance", "Juniper Networks Co", "Blackstone Media", "Summit Freight",
  "Riverstone Capital", "Wavelength AI", "Granite Telecom", "Orchard Foods", "Pinnacle Aerospace",
  "Lantern Education", "Sable Security", "Harborview Hotels", "Quarry Construction", "Beacon Legal",
];

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
    key: "backend",
    department: "Engineering",
    titles: [
      { title: "Backend Engineer", seniority: "mid", base: [125000, 155000] },
      { title: "Senior Backend Engineer", seniority: "senior", base: [160000, 200000] },
      { title: "Staff Backend Engineer", seniority: "staff", base: [205000, 255000] },
    ],
    skills: ["Go", "Java", "PostgreSQL", "gRPC", "Kafka", "Redis", "Microservices", "AWS", "Python"],
    requirements: [
      "Production ownership of a high-throughput service",
      "Strong relational data modelling and query tuning",
      "Comfortable operating what you build, including on-call",
    ],
    blurb:
      "Own core transactional services that sit on the critical path for every customer request. You will lead design reviews, drive schema decisions and mentor engineers through a multi-quarter platform migration.",
  },
  {
    key: "frontend",
    department: "Engineering",
    titles: [
      { title: "Frontend Engineer", seniority: "mid", base: [118000, 145000] },
      { title: "Senior Frontend Engineer", seniority: "senior", base: [150000, 190000] },
      { title: "Staff Frontend Engineer", seniority: "staff", base: [195000, 240000] },
    ],
    skills: ["TypeScript", "React", "Next.js", "GraphQL", "Accessibility", "Testing Library", "CSS Architecture"],
    requirements: [
      "Shipped and maintained a large TypeScript codebase",
      "Fluent in accessibility standards and performance budgets",
      "Partners closely with design on component systems",
    ],
    blurb:
      "Build the surfaces our customers use every day. This role pairs tightly with product design to evolve a shared component library and raise the quality bar across every product team.",
  },
  {
    key: "platform",
    department: "Engineering",
    titles: [
      { title: "Site Reliability Engineer", seniority: "senior", base: [155000, 195000] },
      { title: "Platform Engineer", seniority: "mid", base: [135000, 165000] },
      { title: "Principal Infrastructure Engineer", seniority: "principal", base: [230000, 285000] },
    ],
    skills: ["Kubernetes", "Terraform", "AWS", "Observability", "Go", "CI/CD", "Linux", "Incident Response"],
    requirements: [
      "Ran Kubernetes in production at meaningful scale",
      "Infrastructure-as-code discipline with reviewable change management",
      "Track record reducing MTTR through better observability",
    ],
    blurb:
      "Own the paved road every engineering team builds on: clusters, pipelines, observability and the incident practice that keeps it honest.",
  },
  {
    key: "data",
    department: "Data & Analytics",
    titles: [
      { title: "Data Engineer", seniority: "mid", base: [130000, 160000] },
      { title: "Senior Data Engineer", seniority: "senior", base: [162000, 198000] },
      { title: "Analytics Engineer", seniority: "mid", base: [120000, 150000] },
    ],
    skills: ["dbt", "Snowflake", "Airflow", "Python", "SQL", "Spark", "Data Modelling", "Fivetran"],
    requirements: [
      "Built and operated production ELT pipelines",
      "Dimensional modelling experience on a warehouse",
      "Treats data contracts and tests as first-class",
    ],
    blurb:
      "Turn scattered operational data into a warehouse the business actually trusts, with tested models, clear lineage and a contract-first approach to upstream changes.",
  },
  {
    key: "ml",
    department: "Data & Analytics",
    titles: [
      { title: "Machine Learning Engineer", seniority: "senior", base: [170000, 215000] },
      { title: "Applied Scientist", seniority: "senior", base: [180000, 230000] },
      { title: "Data Scientist", seniority: "mid", base: [135000, 170000] },
    ],
    skills: ["PyTorch", "Python", "MLOps", "Feature Engineering", "Experimentation", "LLMs", "Statistics"],
    requirements: [
      "Shipped a model that served live traffic",
      "Rigorous about offline/online evaluation parity",
      "Comfortable owning the full lifecycle, not just training",
    ],
    blurb:
      "Take models from notebook to production traffic: framing, evaluation design, serving and the monitoring that tells you when reality drifts away from your training set.",
  },
  {
    key: "mobile",
    department: "Engineering",
    titles: [
      { title: "iOS Engineer", seniority: "mid", base: [128000, 158000] },
      { title: "Senior Android Engineer", seniority: "senior", base: [155000, 192000] },
    ],
    skills: ["Swift", "SwiftUI", "Kotlin", "Jetpack Compose", "Mobile CI", "Offline Sync"],
    requirements: [
      "Owned a shipped app with meaningful daily usage",
      "Deep understanding of offline and sync behaviour",
      "Comfortable with release management and staged rollouts",
    ],
    blurb:
      "Own a native client end to end, from offline sync behaviour through to staged rollout and crash triage.",
  },
  {
    key: "security",
    department: "Security",
    titles: [
      { title: "Security Engineer", seniority: "senior", base: [155000, 195000] },
      { title: "Application Security Engineer", seniority: "senior", base: [160000, 200000] },
    ],
    skills: ["Threat Modelling", "AppSec", "SIEM", "Cloud Security", "Incident Response", "IAM", "Python"],
    requirements: [
      "Hands-on application security review experience",
      "Comfortable partnering with engineering rather than gatekeeping",
      "Cloud IAM and detection engineering fundamentals",
    ],
    blurb:
      "Embed with product teams to make the secure path the easy path, from design review through detection engineering and incident response.",
  },
  {
    key: "qa",
    department: "Engineering",
    titles: [
      { title: "QA Automation Engineer", seniority: "mid", base: [105000, 132000] },
      { title: "Senior SDET", seniority: "senior", base: [138000, 170000] },
    ],
    skills: ["Playwright", "Cypress", "TypeScript", "Test Strategy", "CI/CD", "API Testing"],
    requirements: [
      "Built a maintainable end-to-end suite that teams trust",
      "Strong opinions about what not to automate",
      "Works upstream with engineers on testability",
    ],
    blurb:
      "Raise release confidence by building a suite people actually trust, and by pushing testability upstream into how features are designed.",
  },
  {
    key: "product",
    department: "Product",
    titles: [
      { title: "Product Manager", seniority: "mid", base: [135000, 168000] },
      { title: "Senior Product Manager", seniority: "senior", base: [170000, 210000] },
      { title: "Director of Product", seniority: "director", base: [225000, 275000] },
    ],
    skills: ["Discovery", "Roadmapping", "Analytics", "Stakeholder Management", "Experimentation", "SQL"],
    requirements: [
      "Owned a P&L-relevant product area end to end",
      "Evidence of discovery work that changed a roadmap",
      "Strong written communication",
    ],
    blurb:
      "Own a product area with real revenue consequence: run the discovery, make the calls, and write the narrative that aligns engineering, design and go-to-market.",
  },
  {
    key: "design",
    department: "Design",
    titles: [
      { title: "Product Designer", seniority: "mid", base: [120000, 150000] },
      { title: "Senior Product Designer", seniority: "senior", base: [152000, 188000] },
      { title: "UX Researcher", seniority: "mid", base: [118000, 148000] },
    ],
    skills: ["Figma", "Design Systems", "Prototyping", "User Research", "Interaction Design", "Accessibility"],
    requirements: [
      "Portfolio showing shipped, measurable outcomes",
      "Systems thinking, not just screen production",
      "Comfortable running research directly with customers",
    ],
    blurb:
      "Shape complex workflows into interfaces that feel obvious, and grow the design system that keeps the rest of the product coherent.",
  },
  {
    key: "sales",
    department: "Go-to-Market",
    titles: [
      { title: "Enterprise Account Executive", seniority: "senior", base: [135000, 165000] },
      { title: "Solutions Engineer", seniority: "mid", base: [128000, 158000] },
      { title: "Customer Success Manager", seniority: "mid", base: [98000, 128000] },
    ],
    skills: ["Enterprise Sales", "MEDDICC", "Solution Selling", "Salesforce", "Technical Demos", "Renewals"],
    requirements: [
      "Consistent quota attainment in a comparable segment",
      "Multi-threaded enterprise deal experience",
      "Credible in a technical conversation",
    ],
    blurb:
      "Run complex enterprise cycles end to end, multi-threading across security, procurement and the economic buyer.",
  },
  {
    key: "finance",
    department: "Finance & Operations",
    titles: [
      { title: "Financial Analyst", seniority: "mid", base: [92000, 118000] },
      { title: "Revenue Operations Manager", seniority: "senior", base: [125000, 158000] },
      { title: "Controller", seniority: "director", base: [175000, 215000] },
    ],
    skills: ["FP&A", "Modelling", "NetSuite", "GAAP", "Forecasting", "SQL", "Revenue Recognition"],
    requirements: [
      "Owned a forecast that leadership relied on",
      "Strong systems thinking across finance tooling",
      "Audit-ready documentation habits",
    ],
    blurb:
      "Own the numbers leadership plans against, and the systems and controls that make them defensible.",
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

export const TEAM_SEEDS = [
  { name: "Dana Whitfield", role: "admin", title: "VP of Talent Acquisition", department: "Talent", capacity: 0 },
  { name: "Marcus Ellery", role: "admin", title: "Director of Recruiting", department: "Talent", capacity: 4 },

  { name: "Priya Raghavan", role: "recruiter", title: "Principal Technical Recruiter", department: "Talent", capacity: 14 },
  { name: "Jordan Okafor", role: "recruiter", title: "Senior Technical Recruiter", department: "Talent", capacity: 12 },
  { name: "Sofia Moreno", role: "recruiter", title: "Senior Recruiter, GTM", department: "Talent", capacity: 12 },
  { name: "Elias Brennan", role: "recruiter", title: "Technical Recruiter", department: "Talent", capacity: 10 },
  { name: "Naomi Sorensen", role: "recruiter", title: "Technical Recruiter", department: "Talent", capacity: 10 },
  { name: "Rohan Desai", role: "recruiter", title: "Recruiter, Data & ML", department: "Talent", capacity: 11 },
  { name: "Camila Ferreira", role: "recruiter", title: "Recruiter, Corporate", department: "Talent", capacity: 10 },
  { name: "Tobias Lindqvist", role: "recruiter", title: "Sourcing Lead", department: "Talent", capacity: 9 },

  { name: "Aisha Hakimi", role: "coordinator", title: "Senior Recruiting Coordinator", department: "Talent", capacity: 0 },
  { name: "Felix Novak", role: "coordinator", title: "Recruiting Coordinator", department: "Talent", capacity: 0 },

  { name: "Victor Castellanos", role: "hiring_manager", title: "Director of Engineering", department: "Engineering", capacity: 0 },
  { name: "Lena Petrova", role: "hiring_manager", title: "Engineering Manager, Platform", department: "Engineering", capacity: 0 },
  { name: "Hassan Almeida", role: "hiring_manager", title: "Head of Data", department: "Data & Analytics", capacity: 0 },
  { name: "Clara Fitzgerald", role: "hiring_manager", title: "Director of Product", department: "Product", capacity: 0 },
  { name: "Diego Salazar", role: "hiring_manager", title: "Head of Design", department: "Design", capacity: 0 },
  { name: "Yuki Nakamura", role: "hiring_manager", title: "VP Engineering", department: "Engineering", capacity: 0 },
  { name: "Imani Mbeki", role: "hiring_manager", title: "VP Revenue", department: "Go-to-Market", capacity: 0 },
  { name: "Anders Kowalski", role: "hiring_manager", title: "CISO", department: "Security", capacity: 0 },
  { name: "Beatriz Cardoso", role: "hiring_manager", title: "Controller", department: "Finance & Operations", capacity: 0 },

  { name: "Kiran Pillai", role: "interviewer", title: "Staff Engineer", department: "Engineering", capacity: 0 },
  { name: "Margot Delacroix", role: "interviewer", title: "Principal Engineer", department: "Engineering", capacity: 0 },
  { name: "Emeka Nwosu", role: "interviewer", title: "Senior Data Engineer", department: "Data & Analytics", capacity: 0 },
  { name: "Freya Bergstrom", role: "interviewer", title: "Senior Product Designer", department: "Design", capacity: 0 },
  { name: "Silas Montoya", role: "interviewer", title: "Senior Product Manager", department: "Product", capacity: 0 },
  { name: "Nour Haddad", role: "interviewer", title: "Staff Security Engineer", department: "Security", capacity: 0 },
  { name: "Gabriel Santoro", role: "interviewer", title: "Solutions Architect", department: "Go-to-Market", capacity: 0 },
  { name: "Talia Eriksen", role: "interviewer", title: "Engineering Manager", department: "Engineering", capacity: 0 },
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
