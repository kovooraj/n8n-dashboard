/**
 * Team roster for AI Tools (Claude usage) attribution.
 *
 * Keyed by email (lowercased) — matches `actor_email_address` returned by
 * Anthropic's Admin Usage Report API.
 *
 * `companies` lists which org(s) this person's usage counts toward. When the
 * page is filtered to a single company, only members whose list contains that
 * company are included. When filter = 'all', each person is counted once.
 */

export type Company = 'sinalite' | 'willowpack';

export interface TeamMember {
  email: string;
  name: string;
  department: string;
  companies: Company[];
}

export const TEAM: TeamMember[] = [
  { email: 'alex.kovoor@sinalite.com',       name: 'Alex Kovoor',      department: 'AI Team',        companies: ['sinalite', 'willowpack'] },
  { email: 'brian@sinalite.com',             name: 'Brian Meshkati',   department: 'Marketing',      companies: ['willowpack'] },
  { email: 'clarisse.guimaraes@sinalite.com',name: 'Clarisse Guimaraes',department: 'Marketing',     companies: ['sinalite'] },
  { email: 'connor.wilson@sinalite.com',     name: 'Connor Wilson',    department: 'Dev Team',       companies: ['sinalite', 'willowpack'] },
  { email: 'frank.fernandes@sinalite.com',   name: 'Frank Fernandes',  department: 'Operations',     companies: ['sinalite', 'willowpack'] },
  { email: 'haidan.dong@sinalite.com',       name: 'Haidan Dong',      department: 'Marketing',      companies: ['sinalite', 'willowpack'] },
  { email: 'hari.velayudhan@sinalite.com',   name: 'Hari Velayudhan',  department: 'Finance',        companies: ['sinalite', 'willowpack'] },
  { email: 'lalit.sharma@sinalite.com',      name: 'Lalit Sharma',     department: 'Sales',          companies: ['willowpack'] },
  { email: 'lana.morley@sinalite.com',       name: 'Lana Morley',      department: 'Marketing',      companies: ['sinalite'] },
  { email: 'mike@sinalite.com',              name: 'Mike',             department: 'Management',     companies: ['sinalite'] },
  { email: 'noah.morris@sinalite.com',       name: 'Noah Morris',      department: 'Marketing',      companies: ['sinalite', 'willowpack'] },
  { email: 'norma.shakra@sinalite.com',      name: 'Norma Shakra',     department: 'CX',             companies: ['sinalite', 'willowpack'] },
  { email: 'peng.wan@sinalite.com',          name: 'Peng Wan',         department: 'Data Analytics', companies: ['sinalite', 'willowpack'] },
  { email: 'piklin.hoe@sinalite.com',        name: 'Pik Lin Hoe',      department: 'Marketing',      companies: ['sinalite', 'willowpack'] },
  { email: 'robert.yang@sinalite.com',       name: 'Robert Yang',      department: 'I.T Team',       companies: ['sinalite', 'willowpack'] },
  { email: 'sairam.raman@sinalite.com',      name: 'Sai Ram Raman',    department: 'Marketing',      companies: ['willowpack'] },
  { email: 'ai@sinalite.com',                name: 'AI',               department: 'AI Team',        companies: ['sinalite', 'willowpack'] },
  { email: 'support@sinalite.com',           name: 'CX Team',          department: 'CX',             companies: ['sinalite', 'willowpack'] },
];

export const TEAM_BY_EMAIL: Record<string, TeamMember> = Object.fromEntries(
  TEAM.map((m) => [m.email.toLowerCase(), m]),
);

export function lookupMember(email: string | undefined | null): TeamMember | null {
  if (!email) return null;
  return TEAM_BY_EMAIL[email.toLowerCase()] ?? null;
}
