/* ================================================================
   MODULE 2: Resume Templates
   Responsibility: Define every resume template — an on-screen
   HTML preview and a jsPDF renderer — so the chosen template
   drives both the preview and the downloaded PDF.

   Layout families:
   - Hand-written: Classic, Modern, Minimal (original designs)
   - Engine-driven: 10 more templates styled via a small config
     (header/section/education/skills tokens) rendered by
     enginePreview() + engineDraw().
   ================================================================ */

/* ---------- Shared helpers ---------- */

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function hexRgb(hex) {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/* Flatten all education entries (dynamic higher-ed + Class XII + Class X) */
function eduRows(state) {
    const rows = (state.qualifications || []).map(q => ({
        degree: q.degree,
        institute: q.university,
        year: q.status === 'Ongoing' ? `Exp. ${q.year}` : q.year,
        score: q.score
    }));

    const s12 = [state.edu_12th_school, state.edu_12th_board, state.edu_12th_stream]
        .filter(Boolean)
        .map((part, i) => (i === 2 ? `(${part})` : part))
        .join(', ');
    if (state.edu_12th_school) {
        let score12 = state.edu_12th_score ? String(state.edu_12th_score).trim() : '';
        if (score12 && !score12.endsWith('%') && !score12.toLowerCase().includes('cgpa')) {
            score12 += '%';
        }
        rows.push({ degree: 'Class XII / Diploma', institute: s12, year: state.edu_12th_year, score: score12 });
    }

    const s10 = [state.edu_10th_school, state.edu_10th_board].filter(Boolean).join(', ');
    if (state.edu_10th_school) {
        let score10 = state.edu_10th_score ? String(state.edu_10th_score).trim() : '';
        if (score10 && !score10.endsWith('%') && !score10.toLowerCase().includes('cgpa')) {
            score10 += '%';
        }
        rows.push({ degree: 'Class X', institute: s10, year: state.edu_10th_year, score: score10 });
    }

    return rows;
}

/* Section order used by the engine templates (summary is drawn in the header) */
function collectSections(state, style) {
    const secs = [];
    const edu = eduRows(state);
    if (edu.length) secs.push({ title: 'Academic Qualifications', kind: 'edu', rows: edu });
    if (state.workExperience && state.workExperience.trim()) secs.push({ title: 'Work Experience', kind: 'text', text: state.workExperience });
    if (state.projects && state.projects.trim()) secs.push({ title: 'Projects', kind: 'text', text: state.projects });

    if (style.combinedSkills) {
        const sk = { skills: state.skills, certs: state.certifications, langs: state.languages };
        if (sk.skills || (sk.certs && sk.certs.trim()) || sk.langs) {
            secs.push({ title: 'Technical Skills & Certifications', kind: 'skills', skills: sk });
        }
    } else {
        if (state.skills) secs.push({ title: 'Skills', kind: 'skilltext', text: state.skills });
        if (state.certifications && state.certifications.trim()) secs.push({ title: 'Certifications', kind: 'text', text: state.certifications });
        if (state.languages) secs.push({ title: 'Languages', kind: 'text', text: state.languages });
    }

    if (state.actHob) secs.push({ title: 'Extracurricular Activities', kind: 'text', text: state.actHob });
    return secs;
}

/* Common section wrapper for the Classic preview */
function section(title, inner) {
    return inner ? `<section class="tpl-section"><h3>${title}</h3>${inner}</section>` : '';
}
function escMulti(text) {
    return text ? `<div class="tpl-pre">${esc(text)}</div>` : '';
}
function skillsHtml(state) {
    let html = '';
    if (state.skills) html += `<p><strong>Technical:</strong> ${esc(state.skills)}</p>`;
    if (state.certifications) html += `<p class="tpl-pre"><strong>Certifications:</strong>\n${esc(state.certifications)}</p>`;
    if (state.languages) html += `<p><strong>Languages:</strong> ${esc(state.languages)}</p>`;
    return html;
}

/* PDF shared helpers (A4 = 210 x 297 mm) */
const PDFUtils = {
    margin: 18,
    pageW: 210,
    pageH: 297,

    ensure(doc, y, needed) {
        if (y + needed > this.pageH - this.margin) {
            doc.addPage();
            return this.margin;
        }
        return y;
    },

    contactParts(state) {
        return [state.email, state.phone, state.address].filter(Boolean);
    },

    linkParts(state) {
        const parts = [];
        if (state.linkedin) parts.push(`LinkedIn: ${state.linkedin}`);
        if (state.github) parts.push(`GitHub: ${state.github}`);
        return parts;
    },

    footer(doc) {
        const pages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text('Generated by Resume Builder', this.pageW / 2, this.pageH - 10, { align: 'center' });
        }
    }
};

/* ================================================================
   ENGINE: configurable preview + PDF rendering.
   style tokens:
     headerMode : 'band' | 'line' | 'center' | 'accent' | 'split' | 'plain'
     sectionMode: 'underline' | 'bar' | 'fill' | 'center' | 'none'
     eduMode    : 'table' | 'rows' | 'timeline'
     skillsMode : 'inline' | 'bullets'
     colors     : primary, accent, body, muted, rule, headerBg, headerFg, headerSub
     sectionFill / sectionColors, combinedSkills, font, sizes, sectionGap
   ================================================================ */

/* ---------- Engine: preview HTML ---------- */

function engContactItems(state) {
    const items = [];
    if (state.email) items.push(`<span><i class="fas fa-envelope"></i>${esc(state.email)}</span>`);
    if (state.phone) items.push(`<span><i class="fas fa-phone"></i>${esc(state.phone)}</span>`);
    if (state.linkedin) items.push(`<span><i class="fab fa-linkedin"></i>${esc(state.linkedin)}</span>`);
    if (state.github) items.push(`<span><i class="fab fa-github"></i>${esc(state.github)}</span>`);
    if (state.address) items.push(`<span><i class="fas fa-map-marker-alt"></i>${esc(state.address)}</span>`);
    return items;
}

function engEduHtml(rows, style) {
    if (style.eduMode === 'table') {
        return `<table class="tpl-edu-table">
                    <thead><tr><th>Qualification</th><th>Institute</th><th>Year</th><th>Score</th></tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr><td>${esc(r.degree)}</td><td>${esc(r.institute)}</td><td>${esc(r.year)}</td><td>${esc(r.score)}</td></tr>`).join('')}
                    </tbody>
                </table>`;
    }
    if (style.eduMode === 'timeline') {
        return `<div class="edu-tl">${rows.map(r => `
                    <div class="edu-tl-item">
                        <strong>${esc(r.degree)}</strong> <span class="er-meta">${esc(r.year)}${r.score ? ` | ${esc(r.score)}` : ''}</span>
                        <p>${esc(r.institute)}</p>
                    </div>`).join('')}</div>`;
    }
    return `<div class="edu-rows">${rows.map(r => `
                <div class="er">
                    <div class="er-top"><strong>${esc(r.degree)}</strong><span class="er-meta">${esc(r.year)}${r.score ? ` | ${esc(r.score)}` : ''}</span></div>
                    <p>${esc(r.institute)}</p>
                </div>`).join('')}</div>`;
}

function engSkillList(text) {
    const items = (text || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
    return `<ul class="sk-bullets">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function engSkillsHtml(sk, style) {
    const parts = [];
    if (style.skillsMode === 'bullets') {
        if (sk.skills) parts.push(`<p class="sk-label"><strong>Technical Skills:</strong></p>${engSkillList(sk.skills)}`);
    } else if (sk.skills) {
        parts.push(`<p><strong>Technical:</strong> ${esc(sk.skills)}</p>`);
    }
    if (sk.certs && sk.certs.trim()) parts.push(`<p class="tpl-pre"><strong>Certifications:</strong>\n${esc(sk.certs)}</p>`);
    if (sk.langs) parts.push(`<p><strong>Languages:</strong> ${esc(sk.langs)}</p>`);
    return parts.join('');
}

function enginePreview(state, style, tplId) {
    const name = esc(state.fullName);
    const items = engContactItems(state);
    const contact = items.length ? `<div class="tpl-contact">${items.join('')}</div>` : '';
    const summary = state.summary ? `<div class="tpl-summary">${esc(state.summary)}</div>` : '';

    let header = '';
    if (style.headerMode === 'band') {
        header = `<header class="hd-band"><h1>${name}</h1>${contact}${summary}</header>`;
    } else if (style.headerMode === 'center') {
        header = `<header class="hd-center"><h1>${name}</h1>${items.length ? `<div class="tpl-contact ct-center">${items.join('')}</div>` : ''}</header><hr class="hd-rule">${summary}`;
    } else if (style.headerMode === 'split') {
        header = `<header class="hd-split"><div class="hd-split-name">${name}</div>${items.length ? `<div class="hd-split-contact">${items.join('')}</div>` : ''}</header>${summary}`;
    } else if (style.headerMode === 'accent') {
        header = `<header class="hd-accent"><h1>${name}</h1></header>${contact}${summary}`;
    } else if (style.headerMode === 'plain') {
        header = `<header class="hd-plain"><h1>${name}</h1></header>${contact}${summary}`;
    } else {
        header = `<header class="hd-line"><h1>${name}</h1></header>${contact}${summary}`;
    }

    const sections = collectSections(state, style).map((s, i) => {
        let content = '';
        if (s.kind === 'edu') content = engEduHtml(s.rows, style);
        else if (s.kind === 'skills') content = engSkillsHtml(s.skills, style);
        else if (s.kind === 'skilltext') content = style.skillsMode === 'bullets' ? engSkillList(s.text) : `<p>${esc(s.text)}</p>`;
        else content = `<div class="tpl-pre">${esc(s.text)}</div>`;
        const fillCls = (style.sectionColors && style.sectionColors.length) ? ` fill-${i % style.sectionColors.length}` : '';
        return `<section class="sec sec-${style.sectionMode}"><h2${fillCls ? ` class="${fillCls.trim()}"` : ''}>${esc(s.title)}</h2>${content}</section>`;
    }).join('');

    return `<div class="tpl tpl-${tplId}">${header}${sections}</div>`;
}

/* ---------- Engine: PDF rendering ---------- */

function engineDraw(doc, state, style) {
    const margin = PDFUtils.margin;
    const pageW = PDFUtils.pageW;
    const pageH = PDFUtils.pageH;
    const maxW = pageW - (margin * 2);
    const F = style.font || 'helvetica';
    const P = hexRgb(style.primary || '#0f172a');
    const A = hexRgb(style.accent || '#16a34a');
    const B = hexRgb(style.body || '#374151');
    const M = hexRgb(style.muted || '#9ca3af');
    const R = hexRgb(style.rule || '#d1d5db');
    const SC = style.sectionColor ? hexRgb(style.sectionColor) : P;
    const bodySize = style.bodySize || 10;
    const gap = style.sectionGap != null ? style.sectionGap : 5;

    let y = 0;
    const set = (weight, size, color) => {
        doc.setFont(F, weight);
        doc.setFontSize(size);
        doc.setTextColor(...color);
    };

    const name = (state.fullName || '').toUpperCase();
    const contact = [...PDFUtils.contactParts(state), ...PDFUtils.linkParts(state)].join('   |   ');
    const nameSize = style.nameSize || 24;

    /* ---------- Header ---------- */
    if (style.headerMode === 'band') {
        const bh = style.bandH || 42;
        doc.setFillColor(...hexRgb(style.headerBg || '#0f172a'));
        doc.rect(0, 0, pageW, bh, 'F');
        doc.setFillColor(...A);
        doc.rect(0, bh, pageW, 1.4, 'F');
        set('bold', nameSize, hexRgb(style.headerFg || '#ffffff'));
        const nl = doc.splitTextToSize(name, maxW);
        doc.text(nl, margin, 15);
        y = 15 + (nl.length * 6);
        if (contact) {
            set('normal', 8.5, hexRgb(style.headerSub || '#cbd5e1'));
            const cl = doc.splitTextToSize(contact, maxW);
            doc.text(cl, margin, y + 2);
            y += (cl.length * 3.6) + 2;
        }
        if (state.summary) {
            set('italic', 8.5, hexRgb(style.headerSub || '#cbd5e1'));
            const sl = doc.splitTextToSize(state.summary, maxW);
            doc.text(sl, margin, y + 2);
        }
        y = bh + 10;
    } else if (style.headerMode === 'center') {
        set('bold', nameSize, P);
        doc.text(name, pageW / 2, 24, { align: 'center' });
        y = 30;
        if (contact) {
            set('normal', 9, B);
            const cl = doc.splitTextToSize(contact, maxW);
            doc.text(cl, pageW / 2, y, { align: 'center' });
            y += (cl.length * 4) + 3;
        }
        doc.setDrawColor(...R);
        doc.setLineWidth(0.4);
        doc.line(margin, y, pageW - margin, y);
        y += 8;
        if (state.summary) {
            set('italic', 9.5, B);
            const sl = doc.splitTextToSize(state.summary, maxW);
            doc.text(sl, pageW / 2, y, { align: 'center' });
            y += (sl.length * 4) + 5;
        }
    } else if (style.headerMode === 'split') {
        set('bold', nameSize, P);
        const nl = doc.splitTextToSize(name, maxW - 70);
        doc.text(nl, margin, 22);
        let cl = [];
        if (contact) {
            set('normal', 8, M);
            cl = doc.splitTextToSize(contact, 70);
            doc.text(cl, pageW - margin, 22, { align: 'right' });
        }
        y = 22 + (Math.max(nl.length, cl.length, 2) * 6) + 2;
        doc.setDrawColor(...A);
        doc.setLineWidth(1.2);
        doc.line(margin, y, pageW - margin, y);
        y += 8;
        if (state.summary) {
            set('italic', 9.5, B);
            const sl = doc.splitTextToSize(state.summary, maxW);
            doc.text(sl, margin, y);
            y += (sl.length * 4) + 5;
        }
    } else {
        /* line | accent | plain */
        const nameX = style.headerMode === 'accent' ? margin + 7 : margin;
        set('bold', nameSize, P);
        const nl = doc.splitTextToSize(name, maxW - (style.headerMode === 'accent' ? 7 : 0));
        doc.text(nl, nameX, 24);
        y = 24 + (nl.length * 8);
        if (style.headerMode === 'accent') {
            doc.setFillColor(...A);
            doc.rect(margin, 18, 3, 7 + ((nl.length - 1) * 8), 'F');
        }
        if (contact) {
            set('normal', 9, B);
            const cl = doc.splitTextToSize(contact, maxW);
            doc.text(cl, margin, y + 2);
            y += (cl.length * 4) + 4;
        }
        if (style.headerMode === 'line') {
            doc.setDrawColor(...A);
            doc.setLineWidth(1);
            doc.line(margin, y, margin + 40, y);
            y += 6;
        }
        y += 3;
        if (state.summary) {
            set('italic', 9.5, B);
            const sl = doc.splitTextToSize(state.summary, maxW);
            y = PDFUtils.ensure(doc, y, (sl.length * 4) + 2);
            doc.text(sl, margin, y);
            y += (sl.length * 4) + 4;
        }
    }

    /* ---------- Section titles ---------- */
    const secTitle = (title, idx) => {
        y += gap;
        y = PDFUtils.ensure(doc, y, 12);
        const mode = style.sectionMode || 'underline';
        if (mode === 'bar') {
            doc.setFillColor(...A);
            doc.rect(margin, y - 3.5, 2.4, 6, 'F');
            set('bold', style.sectionSize || 11, SC);
            doc.text(title.toUpperCase(), margin + 6, y);
            y += 6;
        } else if (mode === 'fill') {
            const fill = style.sectionColors
                ? hexRgb(style.sectionColors[idx % style.sectionColors.length])
                : hexRgb(style.sectionFill || '#f1f5f9');
            doc.setFillColor(...fill);
            doc.rect(margin, y - 4.5, pageW - (margin * 2), 6.5, 'F');
            set('bold', style.sectionSize || 10, hexRgb(style.sectionColors ? '#ffffff' : '#111827'));
            doc.text(title.toUpperCase(), margin + 3, y);
            y += 7.5;
        } else if (mode === 'center') {
            set('bold', style.sectionSize || 10, SC);
            const tw = doc.getTextWidth(title.toUpperCase());
            const cx = pageW / 2;
            doc.setDrawColor(...R);
            doc.setLineWidth(0.4);
            doc.line(margin, y, cx - (tw / 2) - 4, y);
            doc.line(cx + (tw / 2) + 4, y, pageW - margin, y);
            doc.text(title.toUpperCase(), cx, y, { align: 'center' });
            y += 6;
        } else if (mode === 'none') {
            set('bold', style.sectionSize || 10, SC);
            doc.text(title.toUpperCase(), margin, y);
            y += 5.5;
        } else { /* underline */
            set('bold', style.sectionSize || 11, SC);
            doc.text(title.toUpperCase(), margin, y);
            doc.setDrawColor(...R);
            doc.setLineWidth(0.4);
            doc.line(margin, y + 1.5, pageW - margin, y + 1.5);
            y += 6;
        }
    };

    const bodyTxt = (text) => {
        set('normal', bodySize, B);
        const lines = doc.splitTextToSize(text || '', maxW);
        y = PDFUtils.ensure(doc, y, (lines.length * 4.5) + 2);
        doc.text(lines, margin, y);
        y += (lines.length * 4.5) + 2;
    };

    const labelTxt = (label, text) => {
        y = PDFUtils.ensure(doc, y, 8);
        set('bold', bodySize, P);
        doc.text(label, margin, y);
        set('normal', bodySize, B);
        const lines = doc.splitTextToSize(text || '', maxW - 35);
        y = PDFUtils.ensure(doc, y, (lines.length * 4.5) + 2);
        doc.text(lines, margin + 35, y);
        y += (lines.length * 4.5) + 2;
    };

    const skillItems = (text) => {
        const items = (text || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        items.forEach(it => {
            y = PDFUtils.ensure(doc, y, 5);
            doc.setFillColor(...A);
            doc.circle(margin + 1, y - 1.3, 0.6, 'F');
            set('normal', bodySize, B);
            doc.text(it, margin + 5, y);
            y += 5;
        });
    };

    const writeEdu = (rows) => {
        if (style.eduMode === 'table') {
            const c1 = margin;
            const c2 = margin + 55;
            const c3 = margin + 125;
            const c4 = pageW - margin;
            set('bold', 9, P);
            doc.text('Qualification', c1, y);
            doc.text('Institute', c2, y);
            doc.text('Year', c3, y);
            doc.text('Score', c4, y, { align: 'right' });
            y += 5;
            rows.forEach(r => {
                set('normal', 9, B);
                const ql = doc.splitTextToSize(r.degree, 53);
                const il = doc.splitTextToSize(r.institute, 68);
                const h = Math.max(ql.length, il.length) * 4;
                y = PDFUtils.ensure(doc, y, h);
                doc.text(ql, c1, y);
                doc.text(il, c2, y);
                doc.text(r.year || '', c3, y);
                doc.text(r.score || '', c4, y, { align: 'right' });
                y += h + 2;
            });
        } else if (style.eduMode === 'timeline') {
            const lx = margin + 1.5;
            rows.forEach((r, i) => {
                y = PDFUtils.ensure(doc, y, 13);
                doc.setFillColor(...A);
                doc.circle(lx, y - 1.2, 1, 'F');
                if (i < rows.length - 1) {
                    doc.setDrawColor(...A);
                    doc.setLineWidth(0.4);
                    doc.line(lx, y, lx, y + 10);
                }
                set('bold', 9.5, P);
                doc.text(r.degree, margin + 6, y);
                set('normal', 9, B);
                doc.text(r.institute, margin + 6, y + 4);
                set('normal', 8, M);
                doc.text([r.year, r.score].filter(Boolean).join('  ·  '), pageW - margin, y + 4, { align: 'right' });
                y += 12;
            });
        } else { /* rows */
            rows.forEach(r => {
                y = PDFUtils.ensure(doc, y, 13);
                set('bold', 9.5, P);
                doc.text(r.degree, margin, y);
                set('normal', 9, B);
                doc.text(r.institute, margin, y + 4);
                set('normal', 8, M);
                doc.text([r.year, r.score].filter(Boolean).join('  ·  '), pageW - margin, y + 4, { align: 'right' });
                y += 12;
            });
        }
    };

    /* ---------- Sections ---------- */
    collectSections(state, style).forEach((s, i) => {
        if (s.kind === 'edu') {
            secTitle(s.title, i);
            writeEdu(s.rows);
        } else if (s.kind === 'skills') {
            secTitle(s.title, i);
            if (style.skillsMode === 'bullets') {
                if (s.skills.skills) {
                    set('bold', bodySize, P);
                    doc.text('Technical Skills:', margin, y);
                    y += 5;
                    skillItems(s.skills.skills);
                }
            } else if (s.skills.skills) {
                labelTxt('Technical Skills:', s.skills.skills);
            }
            if (s.skills.certs && s.skills.certs.trim()) labelTxt('Certifications:', s.skills.certs);
            if (s.skills.langs) labelTxt('Languages:', s.skills.langs);
        } else if (s.kind === 'skilltext') {
            secTitle(s.title, i);
            if (style.skillsMode === 'bullets') skillItems(s.text);
            else bodyTxt(s.text);
        } else {
            secTitle(s.title, i);
            bodyTxt(s.text);
        }
    });
}

/* ================================================================
   TEMPLATE 1: Classic — Professional
   ================================================================ */

const classic = {
    id: 'classic',
    name: 'Classic',
    category: 'Professional',
    desc: 'Traditional single-column layout with an education table',

    preview(state) {
        const contact = [];
        if (state.email) contact.push(`<span><i class="fas fa-envelope"></i>${esc(state.email)}</span>`);
        if (state.phone) contact.push(`<span><i class="fas fa-phone"></i>${esc(state.phone)}</span>`);
        if (state.linkedin) contact.push(`<span><i class="fab fa-linkedin"></i>${esc(state.linkedin)}</span>`);
        if (state.github) contact.push(`<span><i class="fab fa-github"></i>${esc(state.github)}</span>`);
        if (state.address) contact.push(`<span><i class="fas fa-map-marker-alt"></i>${esc(state.address)}</span>`);

        const rows = eduRows(state);
        const eduTable = rows.length
            ? `<section class="tpl-section">
                    <h3>Academic Qualifications</h3>
                    <table class="tpl-edu-table">
                        <thead><tr><th>Qualification</th><th>Institute</th><th>Year</th><th>Score</th></tr></thead>
                        <tbody>
                            ${rows.map(r => `<tr><td>${esc(r.degree)}</td><td>${esc(r.institute)}</td><td>${esc(r.year)}</td><td>${esc(r.score)}</td></tr>`).join('')}
                        </tbody>
                    </table>
               </section>`
            : '';

        return `
            <div class="tpl tpl-classic">
                <header class="tpl-classic-header">
                    <h1 class="tpl-classic-name">${esc(state.fullName)}</h1>
                    <div class="tpl-classic-contact">${contact.join('')}</div>
                    ${state.summary ? `<div class="tpl-classic-summary">${esc(state.summary)}</div>` : ''}
                </header>
                ${eduTable}
                ${section('Work Experience', escMulti(state.workExperience))}
                ${section('Projects', escMulti(state.projects))}
                ${section('Technical Skills & Certifications', skillsHtml(state))}
                ${section('Extracurricular Activities', escMulti(state.actHob))}
            </div>`;
    },

    draw(doc, state) {
        const margin = PDFUtils.margin;
        const pageH = PDFUtils.pageH;
        const maxW = PDFUtils.pageW - (margin * 2);
        let y = 22;

        const writeText = (text, size, weight = 'normal', color = [0, 0, 0], indent = 0) => {
            doc.setFontSize(size);
            doc.setFont('helvetica', weight);
            doc.setTextColor(...color);
            const lines = doc.splitTextToSize(text || '', maxW - indent);
            y = PDFUtils.ensure(doc, y, (lines.length * size * 0.3527 * 1.2) + 2);
            doc.text(lines, margin + indent, y);
            y += (lines.length * size * 0.3527 * 1.2) + 2;
        };

        const writeHeader = (title) => {
            y += 4;
            doc.setDrawColor(200);
            doc.line(margin, y, PDFUtils.pageW - margin, y);
            y += 6;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(60, 60, 60);
            doc.text(title.toUpperCase(), margin, y);
            y += 6;
        };

        const writeEduRow = (qual, college, year, score) => {
            if (!college || !qual) return;

            const col1Width = 55;
            const col2Width = 70;
            const col3Width = 35;
            const col4X = PDFUtils.pageW - margin;

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(55, 65, 81);

            const qualLines = doc.splitTextToSize(qual, col1Width - 2);
            const collegeLines = doc.splitTextToSize(college, col2Width - 2);

            const maxLines = Math.max(qualLines.length, collegeLines.length);
            const rowHeight = maxLines * 4;

            y = PDFUtils.ensure(doc, y, rowHeight);

            doc.text(qualLines, margin, y);
            doc.text(collegeLines, margin + col1Width, y);
            doc.text(year.toString(), margin + col1Width + col2Width, y);
            doc.text(score.toString(), col4X, y, { align: 'right' });

            y += rowHeight + 2;
        };

        /* Header Info */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.setTextColor(44, 62, 80);
        doc.text(state.fullName.toUpperCase(), margin, y);
        y += 8;

        /* Accent Line */
        doc.setDrawColor(16, 185, 129);
        doc.setLineWidth(1);
        doc.line(margin, y, margin + 40, y);
        y += 6;

        /* Contact Info */
        const contactStr = PDFUtils.contactParts(state).join('  •  ');
        if (contactStr) {
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(55, 65, 81);
            const lines = doc.splitTextToSize(contactStr, maxW);
            doc.text(lines, margin, y);
            y += (lines.length * 4) + 2;
        }

        /* Links */
        const linkStr = PDFUtils.linkParts(state).join('  •  ');
        if (linkStr) {
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(107, 114, 128);
            const linkLines = doc.splitTextToSize(linkStr, maxW);
            doc.text(linkLines, margin, y);
            y += (linkLines.length * 4) + 2;
        }

        y += 4;

        /* Summary */
        if (state.summary) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9.5);
            doc.setTextColor(55, 65, 81);
            const sumLines = doc.splitTextToSize(state.summary, maxW);
            y = PDFUtils.ensure(doc, y, (sumLines.length * 4) + 4);
            doc.text(sumLines, margin, y);
            y += (sumLines.length * 4) + 4;
        }

        /* Education */
        writeHeader('Academic Qualifications');

        const col1X = margin;
        const col2X = margin + 55;
        const col3X = margin + 55 + 70;
        const col4X = PDFUtils.pageW - margin;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(44, 62, 80);
        doc.text('Qualification', col1X, y);
        doc.text('Institute', col2X, y);
        doc.text('Year', col3X, y);
        doc.text('Score', col4X, y, { align: 'right' });
        y += 5;

        const rows = eduRows(state);
        rows.forEach(r => writeEduRow(r.degree, r.institute, r.year, r.score));

        y += 2;

        /* Work Experience */
        if (state.workExperience && state.workExperience.trim()) {
            writeHeader('Work Experience');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(55, 65, 81);
            const splitWork = doc.splitTextToSize(state.workExperience, maxW);
            y = PDFUtils.ensure(doc, y, (splitWork.length * 5) + 2);
            doc.text(splitWork, margin, y);
            y += (splitWork.length * 5) + 2;
        }

        /* Projects */
        if (state.projects && state.projects.trim()) {
            writeHeader('Projects');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(55, 65, 81);
            const splitProj = doc.splitTextToSize(state.projects, maxW);
            y = PDFUtils.ensure(doc, y, (splitProj.length * 5) + 2);
            doc.text(splitProj, margin, y);
            y += (splitProj.length * 5) + 2;
        }

        /* Skills & Certifications */
        writeHeader('Technical Skills & Certifications');
        if (state.skills) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text('Technical Skills:', margin, y);
            doc.setFont('helvetica', 'normal');
            const skillLines = doc.splitTextToSize(state.skills, maxW - 35);
            y = PDFUtils.ensure(doc, y, (skillLines.length * 5) + 2);
            doc.text(skillLines, margin + 35, y);
            y += (skillLines.length * 5) + 2;
        }

        if (state.certifications) {
            doc.setFont('helvetica', 'bold');
            doc.text('Certifications:', margin, y);
            doc.setFont('helvetica', 'normal');
            const certLines = doc.splitTextToSize(state.certifications, maxW - 35);
            y = PDFUtils.ensure(doc, y, (certLines.length * 5) + 2);
            doc.text(certLines, margin + 35, y);
            y += (certLines.length * 5) + 2;
        }

        if (state.languages) {
            doc.setFont('helvetica', 'bold');
            doc.text('Languages:', margin, y);
            doc.setFont('helvetica', 'normal');
            doc.text(state.languages, margin + 35, y);
            y += 7;
        }

        /* Hobbies */
        if (state.actHob) {
            writeHeader('Extracurricular Activities');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(55, 65, 81);
            const splitHob = doc.splitTextToSize(state.actHob, maxW);
            y = PDFUtils.ensure(doc, y, splitHob.length * 5);
            doc.text(splitHob, margin, y);
        }
    }
};

/* ================================================================
   TEMPLATE 2: Modern — Modern
   ================================================================ */

const modern = {
    id: 'modern',
    name: 'Modern',
    category: 'Modern',
    desc: 'Two-column layout with a dark sidebar & accent colours',

    preview(state) {
        const sideItem = (label, value, icon) => value
            ? `<div class="tpl-modern-item"><span class="tpl-modern-label">${label}</span><p>${icon ? `<i class="${icon}"></i>` : ''}${esc(value)}</p></div>`
            : '';
        const sideBlock = (title, value) => value
            ? `<div class="tpl-modern-block"><h2>${title}</h2><div class="tpl-pre">${esc(value)}</div></div>`
            : '';

        const rows = eduRows(state);
        const eduMain = rows.length
            ? `<section><h2>Education</h2>${rows.map(r => `
                    <div class="tpl-modern-edu">
                        <div><strong>${esc(r.degree)}</strong><span class="tpl-modern-edu-meta">${esc(r.year)}${r.score ? ` | ${esc(r.score)}` : ''}</span></div>
                        <p>${esc(r.institute)}</p>
                    </div>`).join('')}</section>`
            : '';
        const mainSection = (title, value) => value
            ? `<section><h2>${title}</h2><div class="tpl-pre">${esc(value)}</div></section>`
            : '';

        return `
            <div class="tpl tpl-modern">
                <aside class="tpl-modern-side">
                    <h1 class="tpl-modern-name">${esc(state.fullName)}</h1>
                    <p class="tpl-modern-role">Resume</p>
                    ${sideItem('Email', state.email, 'fas fa-envelope')}
                    ${sideItem('Phone', state.phone, 'fas fa-phone')}
                    ${sideItem('Address', state.address, 'fas fa-map-marker-alt')}
                    ${sideItem('LinkedIn', state.linkedin, 'fab fa-linkedin')}
                    ${sideItem('GitHub', state.github, 'fab fa-github')}
                    ${sideBlock('Skills', state.skills)}
                    ${sideBlock('Languages', state.languages)}
                    ${sideBlock('Hobbies', state.actHob)}
                </aside>
                <main class="tpl-modern-main">
                    ${state.summary ? `<section><h2>Summary</h2><p>${esc(state.summary)}</p></section>` : ''}
                    ${eduMain}
                    ${mainSection('Work Experience', state.workExperience)}
                    ${mainSection('Projects', state.projects)}
                    ${mainSection('Certifications', state.certifications)}
                </main>
            </div>`;
    },

    draw(doc, state) {
        const SW = 60;                       /* sidebar width (mm) */
        const mainX = SW + 10;
        const mainMaxW = PDFUtils.pageW - mainX - 15;
        const pageH = PDFUtils.pageH;
        let y = 22;

        const redrawSidebar = () => {
            doc.setFillColor(30, 41, 59);
            doc.rect(0, 0, SW, pageH, 'F');
            doc.setFillColor(22, 163, 74);
            doc.rect(0, 0, SW, 2.5, 'F');
        };
        redrawSidebar();

        const sidebarText = (text, size = 8.5) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(size);
            doc.setTextColor(226, 232, 240);
            const lines = doc.splitTextToSize(text || '', SW - 20);
            if (y + (lines.length * 3.5) > pageH - 15) { doc.addPage(); redrawSidebar(); y = 22; }
            doc.text(lines, 10, y);
            y += (lines.length * 3.5) + 1.5;
        };

        const sidebarSub = (label, value) => {
            if (!value) return;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(148, 163, 184);
            doc.text(label.toUpperCase(), 10, y);
            y += 3.4;
            sidebarText(value);
        };

        const sidebarLabel = (title) => {
            y += 6;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(52, 211, 153);
            doc.text(title.toUpperCase(), 10, y);
            doc.setDrawColor(100, 116, 139);
            doc.setLineWidth(0.3);
            doc.line(10, y + 1.2, SW - 10, y + 1.2);
            y += 5.5;
        };

        /* Sidebar: name */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(17);
        doc.setTextColor(255, 255, 255);
        const nameLines = doc.splitTextToSize(state.fullName.toUpperCase(), SW - 20);
        doc.text(nameLines, 10, y);
        y += (nameLines.length * 5) + 1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text('RESUME', 10, y);
        y += 5;

        sidebarSub('Email', state.email);
        sidebarSub('Phone', state.phone);
        sidebarSub('Address', state.address);
        sidebarSub('LinkedIn', state.linkedin);
        sidebarSub('GitHub', state.github);

        if (state.skills) { sidebarLabel('Skills'); sidebarText(state.skills); }
        if (state.languages) { sidebarLabel('Languages'); sidebarText(state.languages); }
        if (state.actHob) { sidebarLabel('Hobbies'); sidebarText(state.actHob); }

        /* Main column */
        const sectionTitle = (title) => {
            y += 5;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(22, 163, 74);
            doc.text(title.toUpperCase(), mainX, y);
            doc.setDrawColor(22, 163, 74);
            doc.setLineWidth(0.5);
            doc.line(mainX, y + 1.5, PDFUtils.pageW - 15, y + 1.5);
            y += 6;
        };

        const body = (text, size = 9) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(size);
            doc.setTextColor(51, 65, 85);
            const lines = doc.splitTextToSize(text || '', mainMaxW);
            if (y + (lines.length * 4.5) > pageH - 15) { doc.addPage(); redrawSidebar(); y = 22; }
            doc.text(lines, mainX, y);
            y += (lines.length * 4.5) + 1.5;
        };

        if (state.summary) { sectionTitle('Summary'); body(state.summary); }

        const rows = eduRows(state);
        if (rows.length) {
            sectionTitle('Education');
            rows.forEach(r => {
                if (y + 14 > pageH - 15) { doc.addPage(); redrawSidebar(); y = 22; }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9.5);
                doc.setTextColor(30, 41, 59);
                doc.text(r.degree, mainX, y);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(51, 65, 85);
                const instLines = doc.splitTextToSize(r.institute, mainMaxW - 45);
                doc.text(instLines, mainX, y + 4);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(100, 116, 139);
                doc.text([r.year, r.score].filter(Boolean).join('  |  '), PDFUtils.pageW - 15, y + 4, { align: 'right' });
                y += (instLines.length * 4) + 10;
            });
        }

        if (state.workExperience && state.workExperience.trim()) { sectionTitle('Work Experience'); body(state.workExperience); }
        if (state.projects && state.projects.trim()) { sectionTitle('Projects'); body(state.projects); }
        if (state.certifications && state.certifications.trim()) { sectionTitle('Certifications'); body(state.certifications); }
    }
};

/* ================================================================
   TEMPLATE 3: Minimal — Minimal
   ================================================================ */

const minimal = {
    id: 'minimal',
    name: 'Minimal',
    category: 'Minimal',
    desc: 'Clean, airy single-column design with generous spacing',

    preview(state) {
        const contact = [state.email, state.phone, state.address, state.linkedin, state.github]
            .filter(Boolean)
            .join('  |  ');

        const rows = eduRows(state);
        const eduSection = rows.length
            ? `<section><h2>Education</h2>${rows.map(r => `
                    <div class="tpl-minimal-edu">
                        <div><strong>${esc(r.degree)}</strong> — ${esc(r.institute)}</div>
                        <span>${esc(r.year)}${r.score ? ` | ${esc(r.score)}` : ''}</span>
                    </div>`).join('')}</section>`
            : '';
        const sec = (title, inner) => inner
            ? `<section><h2>${title}</h2>${inner}</section>`
            : '';

        return `
            <div class="tpl tpl-minimal">
                <h1 class="tpl-minimal-name">${esc(state.fullName)}</h1>
                <p class="tpl-minimal-contact">${esc(contact)}</p>
                <hr class="tpl-minimal-rule">
                ${sec('Summary', `<p>${esc(state.summary)}</p>`)}
                ${eduSection}
                ${sec('Work Experience', escMulti(state.workExperience))}
                ${sec('Projects', escMulti(state.projects))}
                ${sec('Skills', `<p>${esc(state.skills)}</p>`)}
                ${sec('Certifications', escMulti(state.certifications))}
                ${sec('Languages', `<p>${esc(state.languages)}</p>`)}
                ${sec('Hobbies', `<p>${esc(state.actHob)}</p>`)}
            </div>`;
    },

    draw(doc, state) {
        const margin = 30;
        const maxW = PDFUtils.pageW - (margin * 2);
        const pageH = PDFUtils.pageH;
        let y = 30;

        /* Name — centred */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(15, 23, 42);
        doc.text(state.fullName.toUpperCase(), PDFUtils.pageW / 2, y, { align: 'center' });
        y += 7;

        /* Contact — centred */
        const contact = [...PDFUtils.contactParts(state), ...PDFUtils.linkParts(state)].join('   |   ');
        if (contact) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            const contactLines = doc.splitTextToSize(contact, maxW);
            doc.text(contactLines, PDFUtils.pageW / 2, y, { align: 'center' });
            y += (contactLines.length * 4) + 5;
        }

        /* Divider */
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.4);
        doc.line(margin, y, PDFUtils.pageW - margin, y);
        y += 8;

        const section = (title) => {
            y += 2;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(15, 23, 42);
            doc.text(title.toUpperCase(), margin, y);
            doc.setDrawColor(203, 213, 225);
            doc.line(margin, y + 1.5, PDFUtils.pageW - margin, y + 1.5);
            y += 6;
        };

        const body = (text, size = 9.5) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(size);
            doc.setTextColor(71, 85, 105);
            const lines = doc.splitTextToSize(text || '', maxW);
            y = PDFUtils.ensure(doc, y, (lines.length * 4.5) + 2);
            doc.text(lines, margin, y);
            y += (lines.length * 4.5) + 2;
        };

        if (state.summary) { section('Summary'); body(state.summary); }

        const rows = eduRows(state);
        if (rows.length) {
            section('Education');
            rows.forEach(r => {
                y = PDFUtils.ensure(doc, y, 12);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9.5);
                doc.setTextColor(30, 41, 59);
                doc.text(r.degree, margin, y);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(71, 85, 105);
                doc.text(r.institute, margin, y + 4);
                doc.setFontSize(8.5);
                doc.setTextColor(148, 163, 184);
                doc.text([r.year, r.score].filter(Boolean).join('   '), PDFUtils.pageW - margin, y + 4, { align: 'right' });
                y += 10;
            });
            y += 2;
        }

        if (state.workExperience && state.workExperience.trim()) { section('Work Experience'); body(state.workExperience); }
        if (state.projects && state.projects.trim()) { section('Projects'); body(state.projects); }
        if (state.skills) { section('Skills'); body(state.skills); }
        if (state.certifications && state.certifications.trim()) { section('Certifications'); body(state.certifications); }
        if (state.languages) { section('Languages'); body(state.languages); }
        if (state.actHob) { section('Hobbies'); body(state.actHob); }
    }
};

/* ================================================================
   ENGINE-DRIVEN TEMPLATES (10)
   Each is a small style config rendered by enginePreview/engineDraw.
   ================================================================ */

const executive = {
    id: 'executive',
    name: 'Executive',
    category: 'Professional',
    desc: 'Premium dark header with gold accents for senior roles',
    style: {
        headerMode: 'band', bandH: 44, headerBg: '#0f172a',
        sectionMode: 'bar', eduMode: 'rows', skillsMode: 'inline',
        combinedSkills: true, font: 'times',
        primary: '#0f172a', accent: '#b45309', body: '#44403c', muted: '#a8a29e', rule: '#e7e5e4',
        nameSize: 21, sectionSize: 11
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const corporate = {
    id: 'corporate',
    name: 'Corporate',
    category: 'Professional',
    desc: 'Centered blue profile for managers & business roles',
    style: {
        headerMode: 'center', sectionMode: 'fill', sectionFill: '#dbeafe',
        eduMode: 'table', skillsMode: 'inline', combinedSkills: true,
        primary: '#1e3a8a', accent: '#2563eb', body: '#334155', muted: '#94a3b8', rule: '#bfdbfe',
        nameSize: 22, sectionSize: 10
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const compact = {
    id: 'compact',
    name: 'Compact',
    category: 'Professional',
    desc: 'Dense one-page layout for experienced professionals',
    style: {
        headerMode: 'plain', sectionMode: 'underline', eduMode: 'rows', skillsMode: 'inline',
        combinedSkills: true,
        primary: '#134e4a', accent: '#0d9488', body: '#374151', muted: '#94a3b8', rule: '#d1d5db',
        nameSize: 20, sectionSize: 9.5, bodySize: 9, sectionGap: 2
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const tech = {
    id: 'tech',
    name: 'Tech',
    category: 'Modern',
    desc: 'Monospace vibes with a cyan timeline for developers',
    style: {
        headerMode: 'line', sectionMode: 'bar', eduMode: 'timeline', skillsMode: 'bullets',
        font: 'courier',
        primary: '#0f172a', accent: '#06b6d4', body: '#334155', muted: '#64748b', rule: '#cbd5e1',
        nameSize: 22, sectionSize: 11
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const snapshot = {
    id: 'snapshot',
    name: 'Snapshot',
    category: 'Modern',
    desc: 'Split header with contact on the right, bold indigo rules',
    style: {
        headerMode: 'split', sectionMode: 'underline', eduMode: 'rows', skillsMode: 'inline',
        primary: '#312e81', accent: '#6366f1', body: '#334155', muted: '#94a3b8', rule: '#c7d2fe',
        nameSize: 20, sectionSize: 11
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const simple = {
    id: 'simple',
    name: 'Simple',
    category: 'Minimal',
    desc: 'Plain black & white layout — no frills, maximum clarity',
    style: {
        headerMode: 'plain', sectionMode: 'none', eduMode: 'rows', skillsMode: 'inline',
        primary: '#111827', accent: '#475569', body: '#374151', muted: '#9ca3af', rule: '#e5e7eb',
        nameSize: 22, sectionSize: 10
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const elegant = {
    id: 'elegant',
    name: 'Elegant',
    category: 'Minimal',
    desc: 'Centered serif typography with fine gold hairline rules',
    style: {
        headerMode: 'center', sectionMode: 'center', eduMode: 'timeline', skillsMode: 'inline',
        font: 'times',
        primary: '#1c1917', accent: '#a16207', body: '#44403c', muted: '#a8a29e', rule: '#e7e5e4',
        nameSize: 22, sectionSize: 10
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const bold = {
    id: 'bold',
    name: 'Bold',
    category: 'Creative',
    desc: 'Oversized name with a strong rose accent for impact',
    style: {
        headerMode: 'accent', sectionMode: 'bar', eduMode: 'table', skillsMode: 'bullets',
        primary: '#111827', accent: '#e11d48', body: '#374151', muted: '#9ca3af', rule: '#fecdd3',
        nameSize: 28, sectionSize: 11
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const creative = {
    id: 'creative',
    name: 'Creative',
    category: 'Creative',
    desc: 'Vibrant purple band with an orange timeline for designers',
    style: {
        headerMode: 'band', bandH: 44, headerBg: '#4c1d95',
        sectionMode: 'bar', eduMode: 'timeline', skillsMode: 'bullets',
        primary: '#4c1d95', accent: '#f59e0b', body: '#44403c', muted: '#9ca3af', rule: '#ddd6fe',
        nameSize: 22, sectionSize: 11
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

const colorful = {
    id: 'colorful',
    name: 'Colorful',
    category: 'Creative',
    desc: 'Rainbow section fills — playful and easy to scan',
    style: {
        headerMode: 'line', sectionMode: 'fill',
        sectionColors: ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed'],
        eduMode: 'rows', skillsMode: 'bullets',
        primary: '#0f172a', accent: '#ec4899', body: '#374151', muted: '#94a3b8', rule: '#fbcfe8',
        nameSize: 24, sectionSize: 10
    },
    preview(state) { return enginePreview(state, this.style, this.id); },
    draw(doc, state) { engineDraw(doc, state, this.style); }
};

/* ---------- Registry ---------- */

const CATEGORIES = ['Professional', 'Modern', 'Minimal', 'Creative'];

const Templates = [classic, modern, minimal, executive, corporate, compact, tech, snapshot, simple, elegant, bold, creative, colorful];

function getTemplate(id) {
    return Templates.find(t => t.id === id) || classic;
}