"""
=============================================================================
НАЗНАЧЕНИЕ: Конвертер тестов из IMS QTI 1.2 (.xml) в формат GIFT для Moodle
=============================================================================

ЧТО ДЕЛАЕТ:
    Читает XML-файл теста в формате IMS QTI 1.2 (rcardinality=Single/Multiple)
    и конвертирует в формат GIFT для импорта через Moodle Банк вопросов.

ОГРАНИЧЕНИЯ:
    - Вопросы с картинками: текст сохраняется, картинка теряется.
      После импорта в Moodle добавьте картинку вручную в редакторе вопроса.
    - Поддерживаются только вопросы с вариантами ответов (response_lid).
      Текстовые вопросы (fill-in) пропускаются.

КАК ИСПОЛЬЗОВАТЬ:
    1. Поменяй INPUT, OUTPUT, IMAGES_DIR в начале скрипта
    2. pip install (ничего не нужно — только стандартная библиотека)
    3. python3 qti_to_gift.py
    4. Импортируй .gift в Moodle: Банк вопросов → Импорт → GIFT

РАЗРАБОТАН ДЛЯ: GeoCore-Academy, апрель 2026
=============================================================================
"""

import re
import xml.etree.ElementTree as ET

# ── Настройки ─────────────────────────────────────────────────────────────
INPUT      = '/tmp/qti_extract/геологическое моделированиеqti.xml'
OUTPUT     = '/home/andysag/Downloads/WhatSie/test_datamine.gift'
IMAGES_DIR = '/tmp/qti_extract/qti_images'   # папка с картинками из архива
# ─────────────────────────────────────────────────────────────────────────


def gift_escape(text):
    """Экранируем спецсимволы формата GIFT."""
    for ch in ['\\', '{', '}', '~', '=', '#']:
        text = text.replace(ch, '\\' + ch)
    return text


def get_text(element):
    """Собирает текст из mattext, убирает лишние пробелы."""
    parts = []
    for mattext in element.findall('.//mattext'):
        t = (mattext.text or '').strip()
        if t:
            parts.append(t)
    return ' '.join(parts)


def build_gift(title, q_text, answers, has_img):
    """Собирает один вопрос в GIFT-формат."""
    corrects = [(t, True)  for t, ok in answers if ok]
    wrongs   = [(t, False) for t, ok in answers if not ok]

    if not corrects:
        return f"// ПРОПУЩЕН (нет правильного ответа): {q_text[:80]}\n\n"

    note = ' [⚠ вопрос содержит картинку — добавить вручную в Moodle]' if has_img else ''
    title_safe = re.sub(r'[{}\[\]]', '', title[:50]).strip() or q_text[:50]
    q_esc = gift_escape(q_text + note)

    if len(corrects) == 1:
        lines = [f"::{title_safe}::{q_esc}{{"]
        lines.append(f"  ={gift_escape(corrects[0][0])}")
        for w, _ in wrongs:
            lines.append(f"  ~{gift_escape(w)}")
    else:
        pct = round(100 / len(corrects), 5)
        lines = [f"::{title_safe}::{q_esc}{{"]
        for c, _ in corrects:
            lines.append(f"  ~%{pct}%{gift_escape(c)}")
        for w, _ in wrongs:
            lines.append(f"  ~%0%{gift_escape(w)}")

    lines.append("}\n")
    return '\n'.join(lines)


def parse_qti(xml_path):
    tree = ET.parse(xml_path)
    root = tree.getroot()

    assessment = root.find('.//assessment')
    title = assessment.get('title', '') if assessment is not None else ''

    questions = []
    for item in root.findall('.//item'):
        item_title = item.get('title', '')

        # Текст вопроса
        presentation = item.find('presentation')
        if presentation is None:
            continue
        q_text = get_text(presentation)

        # Проверка на картинку
        has_img = len(item.findall('.//matimage')) > 0

        # Ответы
        resp_lid = item.find('.//response_lid')
        if resp_lid is None:
            continue  # нет вариантов — пропускаем

        cardinality = resp_lid.get('rcardinality', 'Single')

        # Правильные ответы из resprocessing
        correct_idents = set()
        for cond in item.findall('.//respcondition'):
            cond_title = cond.get('title', '')
            setvar = cond.find('setvar')
            if setvar is not None and setvar.text and int(setvar.text) > 0:
                for ve in cond.findall('.//varequal'):
                    correct_idents.add(ve.text)

        # Альтернатива: ws_right="1" прямо на response_label
        if not correct_idents:
            for label in resp_lid.findall('.//response_label'):
                if label.get('ws_right') == '1':
                    correct_idents.add(label.get('ident'))

        # Собираем варианты ответов
        answers = []
        for label in resp_lid.findall('.//response_label'):
            ident = label.get('ident')
            text  = get_text(label).strip()
            if text:
                answers.append((text, ident in correct_idents))

        questions.append((item_title, q_text, answers, has_img))

    return title, questions


def main():
    assessment_title, questions = parse_qti(INPUT)

    out = [
        f"// GeoCore-Academy\n"
        f"// Тест: {assessment_title}\n"
        f"// Конвертировано из QTI 1.2 скриптом tools/qti_to_gift.py\n"
        f"// Вопросы с ⚠ содержат картинки — добавить вручную после импорта\n\n"
    ]

    ok = skipped = img_count = 0
    for title, q_text, answers, has_img in questions:
        block = build_gift(title, q_text, answers, has_img)
        out.append(block)
        if block.startswith('// ПРОПУЩЕН'):
            skipped += 1
        else:
            ok += 1
        if has_img:
            img_count += 1

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(''.join(out))

    print(f"\nРезультат: {ok} конвертировано, {skipped} пропущено")
    print(f"Картинки (добавить вручную): {img_count}")
    print(f"Файл: {OUTPUT}\n")
    print(f"{'№':>3}  {'Отв':>4}  {'Прав':>4}  {'Img':>4}  Вопрос")
    print('-' * 85)
    for i, (title, q, a, img) in enumerate(questions):
        c = sum(1 for _, ok_ in a if ok_)
        print(f"{i+1:>3}  {len(a):>4}  {c:>4}  {'🖼' if img else ' ':>4}  {q[:65]}")


if __name__ == '__main__':
    main()
