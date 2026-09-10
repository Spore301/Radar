import { MessageTemplate, Job, MergedConstraints } from './types';
import { buildQueryBundle, deriveQueryTerms } from './search/xrayTemplates';

export const INITIAL_MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'tmpl-1',
    name: 'Product Design Lead - Warm Outreach',
    channel: 'LinkedIn DM',
    role_type: 'Design',
    tone: 'Warm',
    body: `Hi {{candidate_name}},

I came across your profile and was really impressed by your experience leading design systems and product design initiatives. We are building the next generation of SaaS tools at {{company_name}} and are searching for a {{role_title}} to lead our core product experience.

Given your background with {{top_skills}}, I think your approach would be a fantastic fit for what we are creating.

Would you be open to a casual 15-minute chat next week to share more details?`,
    created_at: new Date().toISOString(),
  },
  {
    id: 'tmpl-2',
    name: 'Senior Engineer - Direct Technical Outreach',
    channel: 'Email',
    role_type: 'Engineering',
    tone: 'Direct',
    body: `Hi {{candidate_name}},

Your technical background in {{top_skills}} caught my attention while sourcing candidates for our {{role_title}} role at {{company_name}}.

We are scaling high-throughput distributed systems and UI platforms, and we need someone with strong expertise in {{top_skills}} to own architectural decisions.

If you are open to exploring new technical challenges, let's connect for a brief 10-minute discovery call.`,
    created_at: new Date().toISOString(),
  },
  {
    id: 'tmpl-3',
    name: 'Quick Follow-up - Casual',
    channel: 'LinkedIn DM',
    role_type: 'General',
    tone: 'Short & Punchy',
    body: `Hey {{candidate_name}}, following up on my previous note regarding the {{role_title}} position at {{company_name}}!

Would love to give you a quick glimpse of our roadmap. Let me know if you have 10 minutes open this Thursday or Friday.`,
    created_at: new Date().toISOString(),
  },
  {
    id: 'tmpl-4',
    name: 'LinkedIn connection note - First touch',
    channel: 'LinkedIn Note',
    role_type: 'General',
    tone: 'Short & Punchy',
    // Connection notes are capped at 300 characters by LinkedIn; this renders
    // to ~210 with typical values, leaving room for a long name or company.
    body: `Hi {{candidate_name}} — your work with {{top_skills}} caught my eye. I'm hiring a {{role_title}} at {{company_name}} and would value a quick chat. Open to connecting?`,
    created_at: new Date().toISOString(),
  },
];

// Demo JD used by the "Load Demo Role" shortcut. Deliberately contains no
// candidates — search results are only ever real, scraped profiles (see
// src/lib/search/x-raySearchService.ts). `candidate_count` starts at 0 for the
// same reason: nothing has been searched for yet.
const DEMO_CONSTRAINTS: MergedConstraints = {
  job_title: 'Senior Product Designer',
  role_type: 'Design',
  seniority: 'Senior',
  years_of_experience: { min: 5, max: 8 },
  location: 'Bangalore, India',
  remote_eligible: true,
  must_have_skills: ['Figma', 'Design Systems', 'User Research', 'Prototyping'],
  nice_to_have_skills: ['Framer', 'Lottie', 'React'],
  domain: ['SaaS / B2B'],
  education: 'Bachelor in Design or Equivalent',
  selected_platforms: ['LinkedIn', 'Behance', 'Dribbble', 'Wellfound', 'Resumes'],
  additional_details: 'Must have shipped a "design system" for a B2B SaaS product. No agencies, no freelancers, no students.',
  results_cap: 50,
};

export const INITIAL_DEMO_JOB: Job = {
  id: 'job-demo-1',
  title: 'Senior Product Designer',
  raw_jd_text: `We are looking for a Senior Product Designer to join our fast-growing B2B SaaS platform team in Bangalore, India.
You will be responsible for leading design systems, crafting complex desktop and web dashboard workflows in Figma, conducting user research, and partnering closely with frontend engineers working in React and Tailwind CSS.
Requirements:
- 5+ years of experience in product design for web or SaaS applications.
- Deep expertise in Figma, Design Systems, Component Libraries, and Design Tokens.
- Hands-on experience with prototyping tools like Framer, Lottie, or Protopie.
- Strong understanding of user research methodologies and accessibility standards (WCAG).
- Based in Bangalore or open to remote work.
Nice to have: Basic familiarity with React / HTML / CSS.`,
  structured_jd: {
    job_title: 'Senior Product Designer',
    role_type: 'Design',
    seniority: 'Senior',
    years_of_experience: { min: 5, max: 8 },
    location: { primary: 'Bangalore, India', remote_eligible: true },
    skills: {
      must_have: ['Figma', 'Design Systems', 'User Research', 'Prototyping'],
      nice_to_have: ['Framer', 'Lottie', 'React', 'Tailwind CSS'],
    },
    domain: ['SaaS / B2B', 'Enterprise Dashboards'],
    education: 'Bachelor in Design / CS or equivalent experience',
    responsibilities_summary: 'Lead end-to-end UX/UI design for complex B2B SaaS dashboard features, establish design system tokens in Figma, collaborate with React frontend engineers, and conduct user research testing.',
    confidence_scores: { seniority: 0.95, skills_must_have: 0.98 },
    extraction_warnings: [],
  },
  merged_constraints: DEMO_CONSTRAINTS,
  // Built from the approved templates so the demo can never show a query
  // shape the real generator wouldn't produce.
  query_bundle: buildQueryBundle(deriveQueryTerms(DEMO_CONSTRAINTS), DEMO_CONSTRAINTS.selected_platforms),
  keyword_map: {
    primary_title_variants: ['Senior Product Designer', 'UX Lead', 'UI/UX Designer', 'Staff Designer'],
    skill_synonyms: { Figma: ['Sketch', 'Adobe XD'], React: ['ReactJS', 'React.js'] },
    domain_keywords: ['SaaS', 'B2B', 'Enterprise', 'FinTech'],
    seniority_signals: ['senior', 'lead', '5+ years', 'staff'],
    negative_keywords: ['intern', 'fresher', 'junior', 'trainee'],
  },
  status: 'draft',
  candidate_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
