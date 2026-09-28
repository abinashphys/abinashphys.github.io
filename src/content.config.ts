// Content collections. The files these read live in src/content/ —
// see EDITING.md for what each field means.
import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

/** One Markdown file per research project: src/content/research/*.md */
const research = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/research' }),
  schema: z.object({
    title: z.string(),
    role: z.string(),
    institution: z.string(),
    unit: z.string().optional(),
    period: z.string(), // shown as written, e.g. "Summer 2026–Present"
    start: z.coerce.date(), // used only for ordering (newest first)
    status: z.enum(['current', 'past']),
    advisors: z.string().optional(),
    funding: z.string().optional(),
    summary: z.string(),
    /** Optional short list shown on the home page for the current project. */
    steps: z.array(z.object({ label: z.string(), text: z.string() })).optional(),
    /** Optional: slug of a related publication in src/content/publications. */
    publication: z.string().optional(),
  }),
});

/** One Markdown file per paper: src/content/publications/*.md */
const publications = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/publications' }),
  schema: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    year: z.number(),
    venue: z.string(),
    volume: z.string().optional(),
    issue: z.string().optional(),
    pages: z.string().optional(), // page range or article number
    doi: z.string().optional(),
    url: z.string().optional(),
    type: z.enum(['peer-reviewed', 'submitted', 'in-prep', 'proceedings', 'other']).default('peer-reviewed'),
    /** What you personally did — keeps your role distinct from co-authors'. */
    contribution: z.array(z.string()).optional(),
    featured: z.boolean().default(false),
  }),
});

/** Name, affiliation, contact links, short bio: src/content/profile.yaml */
const profile = defineCollection({
  loader: file('./src/content/profile.yaml'),
  schema: z.object({
    name: z.string(),
    nameShort: z.string(),
    position: z.string(),
    department: z.string(),
    institution: z.string(),
    center: z.string(),
    city: z.string(),
    email: z.string(),
    github: z.string(),
    cvPdf: z.string(),
    writing: z.object({ name: z.string(), url: z.string(), blurb: z.string() }),
    tagline: z.string(),
    bio: z.string(),
    background: z.string(),
    identity: z.string(),
    hero: z.object({ eyebrow: z.string(), lead: z.string(), photoAlt: z.string() }),
    feature: z.object({ eyebrow: z.string(), title: z.string(), intro: z.string() }),
    about: z.array(z.string()),
    teachingNote: z.object({ eyebrow: z.string(), title: z.string(), text: z.string() }),
    writingNote: z.object({ eyebrow: z.string(), title: z.string(), text: z.string() }),
  }),
});

/** Everything else on the CV, grouped in sections: src/content/cv.yaml */
const cvItem = z.object({
  title: z.string(),
  org: z.string().optional(),
  place: z.string().optional(),
  date: z.string().optional(),
  detail: z.string().optional(),
  link: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  featured: z.boolean().optional(), // show on the home page under "Selected work"
});
const cv = defineCollection({
  loader: file('./src/content/cv.yaml'),
  schema: z.object({
    heading: z.string(),
    order: z.number(),
    items: z.array(cvItem),
  }),
});

/** Selected essays from the external blog: src/content/writing.yaml */
const writing = defineCollection({
  loader: file('./src/content/writing.yaml'),
  schema: z.object({
    title: z.string(),
    url: z.string(),
    date: z.coerce.date(),
  }),
});

/** The three research highlights on the home page: src/content/highlights.yaml */
const highlights = defineCollection({
  loader: file('./src/content/highlights.yaml'),
  schema: z.object({
    order: z.number(),
    eyebrow: z.string(),
    question: z.string(),
    text: z.string(),
    link: z.string(), // path within the site, e.g. "research/#dagn-radio"
    linkText: z.string(),
    art: z.enum(['accretion', 'jets', 'radio']),
    artCaption: z.string(),
  }),
});

/** Featured graduate course projects (Research page): src/content/course-projects/*.md */
const courseProjects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/course-projects' }),
  schema: z.object({
    title: z.string(),
    course: z.string(),
    institution: z.string(),
    instructor: z.string().optional(),
    period: z.string(),
    order: z.number().default(1),
    parts: z.array(z.object({ label: z.string(), text: z.string(), shows: z.string().optional() })),
    /** image paths in /public WITHOUT extension; a .webp and a .png must both exist */
    figures: z.array(z.object({ src: z.string(), alt: z.string(), caption: z.string() })).default([]),
  }),
});

export const collections = { research, publications, profile, cv, writing, highlights, courseProjects };
