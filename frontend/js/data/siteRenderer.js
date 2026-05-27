/**
 * siteRenderer.js — рендеринг nav, курсов и футера из site.json
 *
 * Три уровня курсов:
 *   live    — SCORM загружен, клик → модалка с кнопкой «Записаться»
 *   soon    — в Moodle без SCORM, клик → модалка-анонс без кнопки
 *   planned — только в планах, некликабельные, самые блёклые
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(href) {
  const value = String(href ?? '').trim();
  if (!value) return '#';
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(value)) return value;
  return '#';
}

export async function loadSiteData() {
  const resp = await fetch('./js/data/site.json');
  return resp.json();
}

export function renderNav(data) {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  navLinks.innerHTML = data.nav.links
    .map(l => `<li><a href="${esc(safeHref(l.href))}">${esc(l.label)}</a></li>`)
    .join('');
  const cta = document.querySelector('.nav-cta');
  if (cta) { cta.href = safeHref(data.nav.cta.href); cta.textContent = data.nav.cta.label; }
}

// ── Карточки ────────────────────────────────────────────────────────────────

function cardInner(c) {
  return `
    <div class="cc-num">${esc(c.num)}</div>
    <span class="cc-icon">${esc(c.icon)}</span>
    <div class="cc-tag">${esc(c.tag)}</div>
    <h3 class="cc-t">${esc(c.title)}</h3>
    <p class="cc-d">${esc(c.desc)}</p>
    <div class="cc-meta">
      ${(c.meta || []).map(m => `<div class="cc-m">${esc(m.icon)} <strong>${esc(m.text)}</strong></div>`).join('')}
    </div>`;
}

function renderLiveCard(c, idx) {
  return `<div class="cc cc-live" data-modal="live" data-idx="${idx}" role="button" tabindex="0">${cardInner(c)}</div>`;
}

function renderSoonCard(c, idx) {
  return `<div class="cc cc-soon" data-modal="soon" data-idx="${idx}" role="button" tabindex="0">${cardInner(c)}</div>`;
}

function renderPlannedCard(c, idx, total) {
  const card = Object.assign({}, c, {
    num: `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    meta: c.meta || [],
  });
  return `<div class="cc cc-planned" data-modal="planned" data-idx="${idx}" role="button" tabindex="0" style="cursor:pointer">${cardInner(card)}</div>`;
}

export function renderCourses(live, soon, planned) {
  const grid = document.querySelector('.cg');
  if (!grid) return;
  grid.innerHTML =
    live.map(renderLiveCard).join('') +
    soon.map(renderSoonCard).join('') +
    planned.map((c, i) => renderPlannedCard(c, i, planned.length)).join('');

  ensureModal();

  grid.querySelectorAll('[data-modal]').forEach(el => {
    const handler = () => {
      const type = el.dataset.modal;
      const idx  = parseInt(el.dataset.idx);
      if (type === 'live')    openLiveModal(live[idx]);
      if (type === 'soon')    openSoonModal(soon[idx]);
      if (type === 'planned') openPlannedModal(planned[idx]);
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
  });
}

// ── Модальное окно ───────────────────────────────────────────────────────────

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

  const close = () => { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); };
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function showModal(html) {
  const overlay = document.getElementById('gc-modal');
  overlay.querySelector('.modal-content').innerHTML = html;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.querySelector('.modal-panel').scrollTop = 0;
}

function openLiveModal(c) {
  const m = c.modal || {};
  const highlights = (m.highlights || [])
    .map(h => `<li class="modal-hi">${esc(h)}</li>`).join('');

  showModal(`
    <div class="modal-tag">${esc(c.tag)}</div>
    <h2 class="modal-title">${esc(c.title)}</h2>
    ${m.tagline ? `<p class="modal-tagline">${esc(m.tagline)}</p>` : ''}
    ${m.description ? `<p class="modal-desc">${esc(m.description)}</p>` : `<p class="modal-desc">${esc(c.desc)}</p>`}
    ${highlights ? `
      <div class="modal-section">
        <div class="modal-section-label">ЧТО ИЗУЧИТЕ</div>
        <ul class="modal-highlights">${highlights}</ul>
      </div>` : ''}
    ${(m.audience || m.duration || m.format) ? `
      <div class="modal-meta-row">
        ${m.audience ? `<div class="modal-meta-item"><div class="modal-meta-label">АУДИТОРИЯ</div><div class="modal-meta-val">${esc(m.audience)}</div></div>` : ''}
        ${m.duration ? `<div class="modal-meta-item"><div class="modal-meta-label">ДЛИТЕЛЬНОСТЬ</div><div class="modal-meta-val">${esc(m.duration)}</div></div>` : ''}
        ${m.format   ? `<div class="modal-meta-item"><div class="modal-meta-label">ФОРМАТ</div><div class="modal-meta-val">${esc(m.format)}</div></div>` : ''}
      </div>` : ''}
    <button class="modal-cta" id="gc-enroll-btn" style="border:none;cursor:pointer">Записаться на курс →</button>
  `);

  document.getElementById('gc-enroll-btn')
    .addEventListener('click', () => openRequestForm(c.title));
}

function openRequestForm(courseTitle) {
  showModal(`
    <div class="modal-tag">КОРПОРАТИВНОЕ ОБУЧЕНИЕ</div>
    <h2 class="modal-title">Заявка на курс</h2>
    <p class="modal-desc" style="margin-bottom:8px">${esc(courseTitle)}</p>
    <form class="req-form" id="gc-req-form" novalidate>
      <input type="hidden" name="course_name" value="${esc(courseTitle)}">
      <label>Название компании *</label>
      <input type="text" name="company_name" required placeholder="ООО Геология Северо-Запада">
      <label>ИНН компании *</label>
      <input type="text" name="inn" pattern="[0-9]{10,12}" required placeholder="7700000000">
      <label>Email для договора *</label>
      <input type="email" name="contact_email" required placeholder="buh@company.ru">
      <label>Количество сотрудников *</label>
      <input type="number" name="headcount" min="1" max="1000" required placeholder="1" style="max-width:120px">
      <label>ФИО сотрудника (ученика) *</label>
      <input type="text" name="employee_name" required placeholder="Иванов Иван Иванович">
      <label>Email сотрудника *</label>
      <input type="email" name="employee_email" required placeholder="ivanov@company.ru">
      <label>Комментарий</label>
      <textarea name="comment" rows="3" placeholder="Пожелания, вопросы..."></textarea>
      <div class="req-form-btns">
        <button type="button" class="req-form-cancel" id="gc-req-cancel">Отмена</button>
        <button type="submit" class="modal-cta" style="margin-top:0;border:none;cursor:pointer">Отправить заявку</button>
      </div>
    </form>
    <div class="req-status" id="gc-req-status"></div>
  `);

  document.getElementById('gc-req-cancel').addEventListener('click', () => {
    const overlay = document.getElementById('gc-modal');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  });

  document.getElementById('gc-req-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const statusEl = document.getElementById('gc-req-status');
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = 'Отправка...';

    const payload = {
      course_name:    form.course_name.value,
      company_name:   form.company_name.value,
      inn:            form.inn.value,
      contact_email:  form.contact_email.value,
      headcount:      parseInt(form.headcount.value) || 1,
      employee_name:  form.employee_name.value,
      employee_email: form.employee_email.value,
      comment:        form.comment.value,
    };

    try {
      const resp = await fetch('https://api.geocore-academy.ru/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (resp.ok && result.success) {
        statusEl.style.color = 'var(--gold)';
        statusEl.textContent = 'Заявка принята! Мы свяжемся с вами в ближайшее время.';
        setTimeout(() => {
          const overlay = document.getElementById('gc-modal');
          overlay.classList.remove('open');
          overlay.setAttribute('aria-hidden', 'true');
        }, 3000);
      } else {
        throw new Error(result.message || 'Ошибка сервера');
      }
    } catch (err) {
      statusEl.style.color = '#e57373';
      statusEl.textContent = 'Ошибка отправки. Напишите нам на почту.';
      console.error('[request form]', err);
    }
  });
}

function openSoonModal(c) {
  showModal(`
    <div class="modal-tag">${esc(c.tag)}</div>
    <h2 class="modal-title">${esc(c.title)}</h2>
    <p class="modal-desc">${esc(c.desc || 'Подробная программа курса готовится.')}</p>
    <div class="modal-soon-note">
      <div class="modal-soon-icon">⏳</div>
      <div>
        <div class="modal-soon-label">ЗАПИСЬ ОТКРОЕТСЯ ПОЗЖЕ</div>
        <div class="modal-soon-text">Курс находится в подготовке. Следите за обновлениями на платформе.</div>
      </div>
    </div>
  `);
}

function openPlannedModal(c) {
  showModal(`
    <div class="modal-tag">${esc(c.tag)}</div>
    <h2 class="modal-title">${esc(c.title)}</h2>
    <p class="modal-desc">${esc(c.desc || 'Подробная программа курса готовится.')}</p>
    <div class="modal-soon-note">
      <div class="modal-soon-icon">📋</div>
      <div>
        <div class="modal-soon-label">В РАЗРАБОТКЕ</div>
        <div class="modal-soon-text">Курс запланирован. Чтобы узнать о запуске первыми — напишите нам на <a href="mailto:info@geocore-academy.ru" style="color:var(--gold)">info@geocore-academy.ru</a></div>
      </div>
    </div>
  `);
}

// ── API ──────────────────────────────────────────────────────────────────────

async function fetchCoursesFromAPI() {
  const resp = await fetch('https://api.geocore-academy.ru/api/courses');
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const { courses } = await resp.json();
  return courses;
}

function moodleToCourse(c, idx, total, meta = {}) {
  return {
    num:   `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    icon:  meta.icon  || '📚',
    tag:   meta.tag   || '',
    title: c.title,
    desc:  String(c.summary || '').replace(/<[^>]+>/g, '').slice(0, 120),
    meta:  meta.meta  || [],
    href:  c.href,
    modal: meta.modal || null,
  };
}

// ── Footer ───────────────────────────────────────────────────────────────────

export function renderFooter(data) {
  const fi = document.querySelector('.fi');
  if (!fi) return;
  const cols = data.footer.columns.map(col => `
    <div>
      <div class="fc-t">${esc(col.title)}</div>
      <ul class="fl">
        ${col.links.map(l => `<li><a href="${esc(safeHref(l.href))}">${esc(l.label)}</a></li>`).join('')}
      </ul>
    </div>`).join('');
  fi.innerHTML = `
    <div>
      <a href="#" class="nav-logo" style="text-decoration:none">
        <div class="logo-hex"></div>
        <span class="logo-text">Geo<span>Core</span></span>
      </a>
      <p class="fb-d">${esc(data.footer.description)}</p>
    </div>
    ${cols}`;
  const fc = document.querySelector('.fc');
  if (fc) fc.textContent = data.footer.copyright;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initSite({ showPlanned = true, showSoon = true } = {}) {
  try {
    const data = await loadSiteData();
    renderNav(data);
    renderFooter(data);

    const order   = data.moodleCourseOrder || [];
    const metaMap = data.moodleMeta || {};
    const planned = showPlanned ? (data.courses || []).filter(c => c.planned) : [];

    try {
      const all = await fetchCoursesFromAPI();

      const liveRaw = order.map(id => all.find(c => c.id === id)).filter(Boolean);
      const live = liveRaw.map((c, i) =>
        moodleToCourse(c, i, liveRaw.length, metaMap[c.id] || {}));

      const soonRaw = showSoon ? all.filter(c => !order.includes(c.id)) : [];
      const soon = soonRaw.map((c, i) =>
        moodleToCourse(c, i, soonRaw.length, metaMap[c.id] || {}));

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
