/**
 * siteRenderer.js — рендеринг nav, курсов и футера из site.json
 *
 * Три уровня курсов:
 *   live    — SCORM загружен, кликабельные (из Moodle, ID в moodleCourseOrder)
 *   скоро   — в Moodle но без SCORM, некликабельные (из Moodle, ID не в order)
 *   planned — только в планах, самые блёклые (из site.json, planned: true)
 */

export async function loadSiteData() {
  const resp = await fetch('/js/data/site.json');
  return resp.json();
}

export function renderNav(data) {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  navLinks.innerHTML = data.nav.links
    .map(l => `<li><a href="${l.href}">${l.label}</a></li>`)
    .join('');

  const cta = document.querySelector('.nav-cta');
  if (cta) {
    cta.href = data.nav.cta.href;
    cta.textContent = data.nav.cta.label;
  }
}

// ── Рендер карточек ─────────────────────────────────────────────────────────

function renderLiveCard(c) {
  return `
    <a href="${c.href}" class="cc cc-live" style="text-decoration:none;color:inherit;" target="_blank" rel="noopener">
      <div class="cc-num">${c.num}</div>
      <span class="cc-icon">${c.icon}</span>
      <div class="cc-tag">${c.tag}</div>
      <h3 class="cc-t">${c.title}</h3>
      <p class="cc-d">${c.desc}</p>
      <div class="cc-meta">
        ${c.meta.map(m => `<div class="cc-m">${m.icon} <strong>${m.text}</strong></div>`).join('')}
      </div>
    </a>`;
}

function renderSoonCard(c) {
  return `
    <div class="cc cc-soon">
      <div class="cc-num">${c.num}</div>
      <span class="cc-icon">${c.icon}</span>
      <div class="cc-tag">${c.tag}</div>
      <h3 class="cc-t">${c.title}</h3>
      <p class="cc-d">${c.desc}</p>
      <div class="cc-meta">
        ${c.meta.map(m => `<div class="cc-m">${m.icon} <strong>${m.text}</strong></div>`).join('')}
      </div>
    </div>`;
}

function renderPlannedCard(c) {
  return `
    <div class="cc cc-planned">
      <span class="cc-icon">${c.icon}</span>
      <div class="cc-tag">${c.tag}</div>
      <h3 class="cc-t">${c.title}</h3>
      <p class="cc-d">${c.desc}</p>
    </div>`;
}

export function renderCourses(live, soon, planned) {
  const grid = document.querySelector('.cg');
  if (!grid) return;
  grid.innerHTML =
    live.map(renderLiveCard).join('') +
    soon.map(renderSoonCard).join('') +
    planned.map(renderPlannedCard).join('');
}

// ── API ──────────────────────────────────────────────────────────────────────

async function fetchCoursesFromAPI() {
  const resp = await fetch('https://api.geocore-academy.ru/api/courses');
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const { courses } = await resp.json();
  return courses; // [{id, title, summary, href}, ...]
}

function moodleToCourse(c, idx, total, meta = {}) {
  return {
    num:   `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    icon:  meta.icon  || '📚',
    tag:   meta.tag   || '',
    title: c.title,
    desc:  c.summary.replace(/<[^>]+>/g, '').slice(0, 120),
    meta:  meta.meta  || [],
    href:  c.href,
  };
}

// ── Footer ───────────────────────────────────────────────────────────────────

export function renderFooter(data) {
  const fi = document.querySelector('.fi');
  if (!fi) return;

  const cols = data.footer.columns.map(col => `
    <div>
      <div class="fc-t">${col.title}</div>
      <ul class="fl">
        ${col.links.map(l => `<li><a href="${l.href}">${l.label}</a></li>`).join('')}
      </ul>
    </div>
  `).join('');

  fi.innerHTML = `
    <div>
      <a href="#" class="nav-logo" style="text-decoration:none">
        <div class="logo-hex"></div>
        <span class="logo-text">Geo<span>Core</span></span>
      </a>
      <p class="fb-d">${data.footer.description}</p>
    </div>
    ${cols}
  `;

  const fc = document.querySelector('.fc');
  if (fc) fc.textContent = data.footer.copyright;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initSite() {
  try {
    const data = await loadSiteData();
    renderNav(data);
    renderFooter(data);

    const order    = data.moodleCourseOrder || [];
    const metaMap  = data.moodleMeta || {};
    const planned  = (data.courses || []).filter(c => c.planned);

    try {
      const all = await fetchCoursesFromAPI();

      // live — курсы из order, в порядке order
      const liveRaw = order.map(id => all.find(c => c.id === id)).filter(Boolean);
      const live = liveRaw.map((c, i) =>
        moodleToCourse(c, i, liveRaw.length, metaMap[c.id] || {})
      );

      // soon — все Moodle курсы не в order
      const soonRaw = all.filter(c => !order.includes(c.id));
      const soon = soonRaw.map((c, i) =>
        moodleToCourse(c, i, soonRaw.length, metaMap[c.id] || {})
      );

      renderCourses(live, soon, planned);
      console.log(`[siteRenderer] live:${live.length} soon:${soon.length} planned:${planned.length}`);
    } catch (e) {
      console.warn('[siteRenderer] Moodle API недоступен, fallback:', e.message);
      renderCourses([], [], planned);
    }
  } catch (e) {
    console.warn('[siteRenderer] Не удалось загрузить site.json:', e);
  }
}
