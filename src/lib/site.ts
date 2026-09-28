import { getEntry, getCollection } from 'astro:content';

/** Prefix an internal path with the configured base (needed for GitHub project pages). */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.replace(/^\//, '');
  return `${base}/${clean}`;
}

export async function getProfile() {
  const entry = await getEntry('profile', 'main');
  if (!entry) throw new Error('src/content/profile.yaml must have a top-level "main" entry');
  return entry.data;
}

export async function getResearch() {
  const all = await getCollection('research');
  return all.sort((a, b) => b.data.start.valueOf() - a.data.start.valueOf());
}

export async function getPublications() {
  const all = await getCollection('publications');
  return all.sort((a, b) => b.data.year - a.data.year || a.data.title.localeCompare(b.data.title));
}

export async function getCvSections() {
  const all = await getCollection('cv');
  return all.sort((a, b) => a.data.order - b.data.order);
}

type NavItem = { href: string; label: string; external?: boolean; className?: string };
export const nav: NavItem[] = [
  { href: 'research/', label: 'Research' },
  { href: 'publications/', label: 'Publications' },
  { href: 'teaching/', label: 'Teaching' },
  { href: '#about', label: 'About' },
  { href: 'cv/', label: 'CV' },
  { href: 'https://github.com/abinashphys', label: 'Code', external: true },
  { href: 'https://cosmicconundrum.org/', label: 'Writing', external: true },
  { href: 'mailto:adas406@gatech.edu', label: 'Contact', external: true, className: 'contact-link' },
];
