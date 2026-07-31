"""
=============================================================================
НАЗНАЧЕНИЕ: Конвертер тестов из Word (.docx) в формат GIFT для импорта в Moodle
=============================================================================

ЧТО ДЕЛАЕТ:
    Читает файл Word с тестовыми вопросами и преобразует его в формат GIFT
    (General Import Format Technology) — текстовый формат который Moodle
    принимает через Банк вопросов → Импорт → GIFT.

КАК ДОЛЖЕН БЫТЬ ОФОРМЛЕН ИСХОДНЫЙ DOCX:
    - Каждый вопрос — отдельный абзац
    - Варианты ответов — каждый на отдельной строке под вопросом
    - ПРАВИЛЬНЫЕ ОТВЕТЫ выделены цветом (любым) или цветным шрифтом
    - Разделы тем начинаются со слова «Тема:»
    - Вопросы-расстановки («Расставить в правильной последовательности»)
      пропускаются — Moodle GIFT не поддерживает этот тип

ПОДДЕРЖИВАЕМЫЕ ТИПЫ ВОПРОСОВ:
    - Одиночный выбор (один правильный ответ)
    - Множественный выбор (несколько правильных ответов с равными весами)
    - Вопросы с контекстом/условием перед текстом вопроса

КАК ИСПОЛЬЗОВАТЬ:
    1. Поменяй INPUT и OUTPUT в начале скрипта на свои пути
    2. pip install python-docx  (если не установлен)
    3. python3 docx_to_gift.py
    4. Получишь .gift файл → импортируй в Moodle:
       Банк вопросов → Импорт → формат GIFT → загрузить файл

ПОСЛЕ ИМПОРТА В MOODLE:
    Проверь вопросы отмеченные "// ПРОПУЩЕН" — они не конвертировались
    (нет правильного ответа). Также просмотри практические вопросы с
    длинным условием — там могут попасть лишние строки контекста как
    варианты ответов.

ЗАВИСИМОСТИ:
    pip install python-docx

РАЗРАБОТАН ДЛЯ: GeoCore-Academy, апрель 2026
=============================================================================
"""

import re
from docx import Document

# ── Настройки — менять под каждый файл ───────────────────────────────────
INPUT  = '/home/andysag/Downloads/WhatSie/Пробный итоговый тест за 1_й семестр_2402.docx'
OUTPUT = '/home/andysag/Downloads/WhatSie/test_semester1.gift'
# ─────────────────────────────────────────────────────────────────────────

# Вопросительные слова — сигнал что вопрос сформулирован, следующие строки = ответы
INTERROGATIVE = re.compile(
    r'^(Какой|Какая|Какие|Какое|Каков\b|Каковы\b|Какова\b|'
    r'К какой|К каком\b|К каким\b|К какому\b|'
    r'По каким\b|По каком\b|'
    r'В каких\b|В каком\b|В какой\b|'
    r'Дан\b|Дана\b|Даны\b|Дано\b)',
    re.IGNORECASE
)

# Глаголы начала нового блока задания — сигнал для сброса при режиме ответов
NEW_BLOCK = re.compile(
    r'^(Проделайте|Загрузите|Постройте\b|Используя\b|Объедините\b|'
    r'Ранее\b|Исходные данные\b)',
    re.IGNORECASE
)

SKIP_EXACT  = {'Варианты ответов:', 'Вопрос:'}
SKIP_STARTS = ('Примечание',)
TOPIC_START = 'Тема:'
ORDERING    = 'Расставить в правильной последовательности'


def is_highlighted(para):
    """Возвращает True если абзац содержит цветное выделение — признак правильного ответа."""
    return any(
        r.font.color.rgb is not None or r.font.highlight_color is not None
        for r in para.runs
    )


def gift_escape(text):
    """Экранируем спецсимволы формата GIFT."""
    for ch in ['\\', '{', '}', '~', '=', '#']:
        text = text.replace(ch, '\\' + ch)
    return text


def build_gift(q_lines, answers):
    """Собирает один вопрос в GIFT-формат."""
    q_text   = ' '.join(q_lines).strip()
    corrects = [a for a in answers if a[1]]
    wrongs   = [a for a in answers if not a[1]]

    if not corrects:
        return f"// ПРОПУЩЕН (нет правильных ответов): {q_text[:80]}\n\n"

    title = re.sub(r'[{}\[\]]', '', q_text[:50]).strip()
    q_esc = gift_escape(q_text)

    if len(corrects) == 1:
        # Одиночный выбор
        lines = [f"::{title}::{q_esc}{{"]
        lines.append(f"  ={gift_escape(corrects[0][0])}")
        for w in wrongs:
            lines.append(f"  ~{gift_escape(w[0])}")
    else:
        # Множественный выбор — равные веса на каждый правильный ответ
        pct = round(100 / len(corrects), 5)
        lines = [f"::{title}::{q_esc}{{"]
        for c in corrects:
            lines.append(f"  ~%{pct}%{gift_escape(c[0])}")
        for w in wrongs:
            lines.append(f"  ~%0%{gift_escape(w[0])}")

    lines.append("}\n\n")
    return '\n'.join(lines)


def is_new_q_start(text, in_ans, answers):
    """Определяет: эта строка начинает новый блок вопроса (только при режиме ответов)."""
    if not in_ans:
        return False
    if INTERROGATIVE.match(text) or NEW_BLOCK.match(text):
        return True
    # Эвристика: предыдущие ответы были очень короткими (коды, числа),
    # а новая строка длинная — значит это начало нового условия задачи
    if answers and max(len(a[0]) for a in answers) <= 20 and len(text) > 50:
        return True
    return False


def parse(doc):
    """
    Разбирает документ на вопросы по стейт-машине:
      HEADER → пропуск до первой темы
      QUESTION → накопление текста вопроса
      ANSWERS → накопление вариантов ответов

    Переход QUESTION→ANSWERS:
      - «Варианты ответов:» — явный маркер
      - q_ended=True — вопрос закончился на «?» или вопросительном слове
    """
    paras = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if t:
            paras.append((t, is_highlighted(p)))

    # Пропускаем шапку (ФИО, ВУЗ, инструкции) до первой темы
    start = next((i for i, (t, _) in enumerate(paras) if t.startswith(TOPIC_START)), 0)

    questions = []
    q_lines   = []      # текст вопроса (может быть несколько строк контекста)
    answers   = []      # список (text, is_correct)
    in_ans    = False   # режим сбора ответов
    q_ended   = False   # флаг: вопрос сформулирован, следующая строка — ответ
    skip_ord  = False   # флаг: пропускаем ordering-вопрос

    def flush():
        nonlocal q_lines, answers, in_ans, q_ended
        if q_lines and answers:
            questions.append((list(q_lines), list(answers)))
        q_lines = []; answers = []; in_ans = False; q_ended = False

    for text, highlighted in paras[start:]:

        # Тема — разделитель между тематическими блоками
        if text.startswith(TOPIC_START):
            flush()
            continue

        # Служебные строки: пропускаем, но «Варианты ответов:» включает режим ответов
        if text in SKIP_EXACT or any(text.startswith(p) for p in SKIP_STARTS):
            if text == 'Варианты ответов:':
                in_ans = True
                q_ended = False
            continue

        # Ordering-вопрос: пропускаем все элементы до строки с точкой (начало следующего вопроса)
        if ORDERING in text:
            flush()
            skip_ord = True
            continue
        if skip_ord:
            if text.endswith('.') or text.endswith('?'):
                skip_ord = False
                q_lines = [text]
            continue

        # ── Режим ответов ──
        if in_ans:
            if is_new_q_start(text, in_ans, answers):
                flush()
                q_lines = [text]
                if INTERROGATIVE.match(text):
                    q_ended = True
            else:
                answers.append((text, highlighted))
            continue

        # ── Режим вопроса ──
        if q_ended:
            # Вопрос уже сформулирован — эта и все следующие строки идут в ответы
            in_ans = True
            q_ended = False
            answers.append((text, highlighted))
            continue

        q_lines.append(text)

        # Проверяем: эта строка завершает формулировку вопроса?
        if INTERROGATIVE.match(text) or text.endswith('?'):
            q_ended = True

    flush()
    return questions


def main():
    doc = Document(INPUT)
    questions = parse(doc)

    out = [
        "// GeoCore-Academy\n"
        "// Конвертировано из DOCX автоматически скриптом tools/docx_to_gift.py\n"
        "// Строки с // ПРОПУЩЕН — проверить вручную в Moodle после импорта\n\n"
    ]

    ok = skipped = 0
    for q_lines, answers in questions:
        block = build_gift(q_lines, answers)
        out.append(block)
        if block.startswith('// ПРОПУЩЕН'):
            skipped += 1
        else:
            ok += 1

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(''.join(out))

    print(f"\nРезультат: {ok} конвертировано, {skipped} пропущено")
    print(f"Файл: {OUTPUT}\n")
    print(f"{'№':>3}  {'Отв':>4}  {'Прав':>4}  Вопрос")
    print('-' * 80)
    for i, (q, a) in enumerate(questions):
        c = sum(1 for _, ok_ in a if ok_)
        print(f"{i+1:>3}  {len(a):>4}  {c:>4}  {' / '.join(q)[:70]}")


if __name__ == '__main__':
    main()
