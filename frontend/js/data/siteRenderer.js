/**
 * siteRenderer.js — рендеринг nav, курсов и футера из site.json
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

export function renderCourses(data) {
  const grid = document.querySelector('.cg');
  if (!grid) return;
  grid.innerHTML = data.courses.map((c, i) => `
    <a href="${c.href}" class="cc${c.featured ? ' feat' : ''}" style="text-decoration:none;color:inherit;" target="_blank" rel="noopener">
      <div class="cc-num">${c.num || `0${i+1} / ??`}</div>
      <span class="cc-icon">${c.icon || '📚'}</span>
      <div class="cc-tag">${c.tag || ''}</div>
      <h3 class="cc-t">${c.title}</h3>
      <p class="cc-d">${c.desc || c.summary || ''}</p>
      <div class="cc-meta">
        ${(c.meta || []).map(m => `<div class="cc-m">${m.icon} <strong>${m.text}</strong></div>`).join('')}
      </div>
    </a>
  `).join('');
}

async function fetchCoursesFromAPI() {
  const resp = await fetch('https://api.geocore-academy.ru/api/courses');
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const { courses } = await resp.json();
  // Маппим Moodle формат в наш формат
  return courses.map((c, i) => ({
    num:      `${String(i+1).padStart(2,'0')} / ??`,
    icon:     '📚',
    tag:      '',
    title:    c.title,
    desc:     c.summary.replace(/<[^>]+>/g, '').slice(0, 120),
    meta:     [],
    href:     c.href,
    featured: i === 0,
  }));
}

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

export async function initSite() {
  try {
    const data = await loadSiteData();
    renderNav(data);
    renderFooter(data);

    // Пробуем загрузить курсы из Moodle через API, fallback — site.json
    try {
      const moodleCourses = await fetchCoursesFromAPI();
      renderCourses({ courses: moodleCourses });
      console.log('[siteRenderer] Курсы загружены из Moodle API');
    } catch (e) {
      console.warn('[siteRenderer] Moodle API недоступен, fallback на site.json:', e.message);
      renderCourses(data);
    }
  } catch (e) {
    console.warn('[siteRenderer] Не удалось загрузить site.json:', e);
  }
}
