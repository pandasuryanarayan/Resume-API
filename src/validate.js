'use strict';

/**
 * Payload normalisation, validation and JSON Schema.
 *
 * The API is deliberately forgiving about how a caller names things: a
 * connector on someone else's site rarely produces the exact field names the
 * Resume Builder form uses, so common aliases are mapped here. Anything that
 * cannot be mapped is reported back as a warning rather than failing the call.
 */

const { templateExists } = require('./resume-engine');
const config = require('./config');

const STRING_FIELDS = {
  fullName: { max: 120, required: true, label: 'Full name' },
  email: { max: 160, required: true, label: 'Email' },
  phone: { max: 24, label: 'Phone' },
  address: { max: 300, label: 'Address' },
  linkedin: { max: 200, label: 'LinkedIn' },
  github: { max: 200, label: 'GitHub' },
  languages: { max: 200, label: 'Languages' },
  summary: { max: 2000, label: 'Professional summary' },
  workExperience: { max: 4000, label: 'Work experience' },
  projects: { max: 4000, label: 'Projects' },
  skills: { max: 2000, label: 'Skills' },
  certifications: { max: 2000, label: 'Certifications' },
  actHob: { max: 1000, label: 'Hobbies' },
  edu_12th_school: { max: 160, label: 'Class XII school' },
  edu_12th_board: { max: 120, label: 'Class XII board' },
  edu_12th_stream: { max: 120, label: 'Class XII stream' },
  edu_12th_year: { max: 12, label: 'Class XII year' },
  edu_12th_score: { max: 20, label: 'Class XII score' },
  edu_10th_school: { max: 160, label: 'Class X school' },
  edu_10th_board: { max: 120, label: 'Class X board' },
  edu_10th_year: { max: 12, label: 'Class X year' },
  edu_10th_score: { max: 20, label: 'Class X score' },
};

const ALIASES = {
  name: 'fullName',
  full_name: 'fullName',
  fullname: 'fullName',
  candidateName: 'fullName',
  emailAddress: 'email',
  email_address: 'email',
  mail: 'email',
  mobile: 'phone',
  phoneNumber: 'phone',
  contact: 'phone',
  location: 'address',
  city: 'address',
  linkedIn: 'linkedin',
  linkedinUrl: 'linkedin',
  githubUrl: 'github',
  objective: 'summary',
  careerObjective: 'summary',
  professionalSummary: 'summary',
  about: 'summary',
  experience: 'workExperience',
  work: 'workExperience',
  work_experience: 'workExperience',
  employment: 'workExperience',
  project: 'projects',
  skill: 'skills',
  technicalSkills: 'skills',
  certificates: 'certifications',
  certification: 'certifications',
  hobbies: 'actHob',
  interests: 'actHob',
  extracurriculars: 'actHob',
  knownLanguages: 'languages',
};

const TEXT_LIST_FIELDS = ['skills', 'languages', 'certifications'];

const QUALIFICATION_MAX = 20;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s+()-]{5,23}$/;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  return '';
}

function pickQualification(entry) {
  if (!isPlainObject(entry)) return null;
  const out = {
    degree: toText(entry.degree || entry.course || entry.title || entry.qualification),
    university: toText(entry.university || entry.institute || entry.school || entry.college || entry.institution),
    year: toText(entry.year || entry.passingYear || entry.endYear || entry.duration),
    score: toText(entry.score || entry.grade || entry.percentage || entry.cgpa || entry.marks),
    status: toText(entry.status || entry.state) || 'Completed',
  };
  if (!out.degree && !out.university) return null;
  if (!/ongoing|pursuing|current/i.test(out.status)) out.status = 'Completed';
  else out.status = 'Ongoing';
  return out;
}

function normalise(input, templateOverride) {
  const errors = [];
  const warnings = [];
  const resume = { qualifications: [], selectedTemplate: config.defaultTemplate };

  if (!isPlainObject(input)) {
    return {
      resume,
      template: config.defaultTemplate,
      errors: [{ field: 'body', message: 'Request body must be a JSON object.' }],
      warnings,
    };
  }

  const seen = new Set();
  const flat = { ...input };

  // Alias mapping, keeping the canonical key when both are supplied.
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (alias in flat) {
      if (!(canonical in flat)) flat[canonical] = flat[alias];
      seen.add(alias);
    }
  }

  // Education array.
  const eduSource = flat.qualifications || flat.education || flat.qualification || flat.academics;
  if (Array.isArray(eduSource)) {
    if (eduSource.length > QUALIFICATION_MAX) {
      errors.push({ field: 'qualifications', message: `At most ${QUALIFICATION_MAX} education entries are allowed.` });
    }
    for (const entry of eduSource.slice(0, QUALIFICATION_MAX)) {
      const q = pickQualification(entry);
      if (q) resume.qualifications.push(q);
      else warnings.push('Skipped an education entry with no degree or institute.');
    }
  } else if (eduSource != null) {
    errors.push({ field: 'qualifications', message: 'qualifications must be an array of objects.' });
  }

  // Strings.
  for (const [field, rule] of Object.entries(STRING_FIELDS)) {
    const rawValue = flat[field];
    let value = toText(rawValue);

    if (TEXT_LIST_FIELDS.includes(field) && Array.isArray(rawValue)) {
      value = rawValue.map(toText).filter(Boolean).join(', ');
    }

    if (value.length > rule.max) {
      errors.push({ field, message: `${rule.label} must be ${rule.max} characters or fewer.` });
      value = value.slice(0, rule.max);
    }

    resume[field] = value;

    if (rule.required && !value) {
      errors.push({ field, message: `${rule.label} is required.` });
    }
  }

  if (resume.email && !EMAIL_RE.test(resume.email)) {
    errors.push({ field: 'email', message: 'Email does not look like a valid address.' });
  }
  if (resume.phone && !PHONE_RE.test(resume.phone)) {
    errors.push({ field: 'phone', message: 'Phone must contain only digits, spaces and + ( ) - characters.' });
  }

  // Template resolution: explicit override > payload field > default.
  const candidate = toText(templateOverride || flat.template || flat.selectedTemplate || config.defaultTemplate);
  if (templateExists(candidate)) {
    resume.selectedTemplate = candidate;
  } else {
    errors.push({
      field: 'template',
      message: `Unknown template "${candidate}". Call GET /v1/templates for the list.`,
    });
  }

  const known = new Set([
    ...Object.keys(STRING_FIELDS),
    ...Object.keys(ALIASES),
    'qualifications',
    'education',
    'qualification',
    'academics',
    'template',
    'selectedTemplate',
    'resume',
    'data',
  ]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) warnings.push(`Unknown field "${key}" was ignored.`);
  }

  return { resume, template: resume.selectedTemplate, errors, warnings };
}

/** Pull the resume object and template out of any of the accepted envelopes. */
function extractPayload(body, query, headers) {
  const source = isPlainObject(body) ? body : {};
  const inner = isPlainObject(source.resume)
    ? source.resume
    : isPlainObject(source.data)
      ? source.data
      : source;
  const template =
    (query && query.template) ||
    (headers && headers['x-template']) ||
    source.template ||
    inner.template ||
    inner.selectedTemplate ||
    config.defaultTemplate;
  return { raw: inner, template };
}

function schema() {
  const properties = {
    template: {
      type: 'string',
      description: 'Template id. See GET /v1/templates.',
      default: config.defaultTemplate,
    },
    qualifications: {
      type: 'array',
      description: 'Higher education entries. Class X and XII have their own fields.',
      maxItems: QUALIFICATION_MAX,
      items: {
        type: 'object',
        properties: {
          degree: { type: 'string', example: 'B.Tech Computer Science' },
          university: { type: 'string', example: 'IIT Bhubaneswar' },
          year: { type: 'string', example: '2019' },
          score: { type: 'string', example: '8.4 CGPA' },
          status: { type: 'string', enum: ['Completed', 'Ongoing'], default: 'Completed' },
        },
      },
    },
  };

  for (const [field, rule] of Object.entries(STRING_FIELDS)) {
    properties[field] = {
      type: 'string',
      maxLength: rule.max,
      description: rule.label,
    };
  }
  properties.skills.description = 'Comma separated list, or an array of strings.';
  properties.languages.description = 'Comma separated list, or an array of strings.';
  properties.certifications.description = 'Free text bullets, or an array of strings.';

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://resume-builder.example/v1/schema',
    title: 'Resume Builder resume payload',
    type: 'object',
    required: ['fullName', 'email'],
    properties,
    additionalProperties: true,
  };
}

module.exports = { normalise, extractPayload, schema, STRING_FIELDS, ALIASES };
