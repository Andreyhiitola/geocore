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

function renderActiveCard(c, i) {
  return `
    <a href="${c.href}" class="cc${c.featured ? ' feat' : ''}" style="text-decoration:none;color:inherit;" target="_blank" rel="noopener">
      <div class="cc-num">${c.num || `0${i+1} / ??`}</div>
      <span class="cc-icon">${c.icon || '📚'}</span>
      <div class="cc-tag">${c.tag || ''}</div>
      <h3 class="cc-t">${c.title}</h3>
      <p class="cc-d">${c.desc || c.summary || ''}</p>
      <div class="cc-meta">
        ${(c.meta || []).map(m => `<div class="cc-m">${m.icon} <strong>${m.text}</strong></div>`).join('')}
      </div>
    </a>`;
}

function renderUpcomingCard(c, idx) {
  return `
    <div class="cc cc-soon" data-modal-idx="${idx}" role="button" tabindex="0" aria-label="Подробнее: ${c.title}">
      <div class="cc-num">${c.num || ''}</div>
      <span class="cc-icon">${c.icon || '📚'}</span>
      <div class="cc-tag">${c.tag || ''}</div>
      <h3 class="cc-t">${c.title}</h3>
      <p class="cc-d">${c.desc || ''}</p>
      <div class="cc-meta">
        ${(c.meta || []).map(m => `<div class="cc-m">${m.icon} <strong>${m.text}</strong></div>`).join('')}
      </div>
    </div>`;
}

export function renderCourses(data, upcomingCourses = []) {
  const grid = document.querySelector('.cg');
  if (!grid) return;

  const activeHtml = data.courses.map((c, i) => renderActiveCard(c, i)).join('');
  const upcomingHtml = upcomingCourses.map((c, i) => renderUpcomingCard(c, i)).join('');
  grid.innerHTML = upcomingHtml + activeHtml;

  if (upcomingCourses.length) {
    ensureModal();
    grid.querySelectorAll('.cc-soon').forEach(el => {
      const handler = () => openModal(parseInt(el.dataset.modalIdx), upcomingCourses);
      el.addEventListener('click', handler);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
    });
  }
}

// ── Modal ──────────────────────────────────────────────────────────────────

function ensureModal() {
  if (document.getElementById('gc-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'gc-modal';
  overlay.className = 'modal-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="Закрыть">✕</button>
      <div class="modal-content"></div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  };
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function openModal(idx, courses) {
  const course = courses[idx];
  if (!course || !course.modal) return;
  const m = course.modal;

  const highlights = m.highlights
    .map(h => `<li class="modal-hi">${h}</li>`)
    .join('');

  document.querySelector('#gc-modal .modal-content').innerHTML = `
    <div class="modal-tag">${course.tag || ''}</div>
    <h2 class="modal-title">${course.title}</h2>
    <p class="modal-tagline">${m.tagline}</p>
    <p class="modal-desc">${m.description}</p>
    <div class="modal-section">
      <div class="modal-section-label">ЧТО ИЗУЧИТЕ</div>
      <ul class="modal-highlights">${highlights}</ul>
    </div>
    <div class="modal-meta-row">
      <div class="modal-meta-item">
        <div class="modal-meta-label">АУДИТОРИЯ</div>
        <div class="modal-meta-val">${m.audience}</div>
      </div>
      <div class="modal-meta-item">
        <div class="modal-meta-label">ДЛИТЕЛЬНОСТЬ</div>
        <div class="modal-meta-val">${m.duration}</div>
      </div>
      <div class="modal-meta-item">
        <div class="modal-meta-label">ФОРМАТ</div>
        <div class="modal-meta-val">${m.format}</div>
      </div>
    </div>
    <div class="modal-footer-note">Курс скоро появится на платформе. Следите за обновлениями.</div>`;

  const overlay = document.getElementById('gc-modal');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.querySelector('.modal-panel').scrollTop = 0;
}

// ── API & Footer ───────────────────────────────────────────────────────────

async function fetchCoursesFromAPI(order = []) {
  const resp = await fetch('https://api.geocore-academy.ru/api/courses');
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const { courses } = await resp.json();

  // Если задан порядок — фильтруем только нужные курсы и сортируем по списку
  const filtered = order.length
    ? order.map(id => courses.find(c => c.id === id)).filter(Boolean)
    : courses;

  const total = filtered.length;
  return filtered.map((c, i) => ({
    num:      `${String(i+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`,
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

    const upcomingCourses = data.courses.filter(c => c.upcoming);

    try {
      const moodleCourses = await fetchCoursesFromAPI(data.moodleCourseOrder || []);
      renderCourses({ courses: moodleCourses }, upcomingCourses);
      console.log('[siteRenderer] Курсы загружены из Moodle API');
    } catch (e) {
      console.warn('[siteRenderer] Moodle API недоступен, fallback на site.json:', e.message);
      const activeCourses = data.courses.filter(c => !c.upcoming);
      renderCourses({ courses: activeCourses }, upcomingCourses);
    }
  } catch (e) {
    console.warn('[siteRenderer] Не удалось загрузить site.json:', e);
  }
}
