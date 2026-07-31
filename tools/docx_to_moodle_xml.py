"""
=============================================================================
НАЗНАЧЕНИЕ: Конвертер тестов из Word (.docx) в Moodle XML с картинками
=============================================================================

Moodle XML поддерживает встроенные изображения — скриншоты из условий
вопросов будут включены в файл и появятся в вопросах после импорта.

КАК ИСПОЛЬЗОВАТЬ:
    1. Поменяй INPUT и OUTPUT ниже
    2. pip install python-docx lxml
    3. python3 docx_to_moodle_xml.py
    4. Импортируй в Moodle: Банк вопросов → Импорт → Moodle XML

РАЗРАБОТАН ДЛЯ: GeoCore-Academy, апрель 2026
=============================================================================
"""

import base64
import re
from xml.sax.saxutils import escape
from docx import Document

# ── Настройки ─────────────────────────────────────────────────────────────
INPUT  = '/home/andysag/Downloads/WhatSie/Пробный итоговый тест за 1_й семестр_2402.docx'
OUTPUT = '/home/andysag/Downloads/WhatSie/test_semester1.xml'
# ─────────────────────────────────────────────────────────────────────────

PIC_NS   = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
BLIP_NS  = 'http://schemas.openxmlformats.org/drawingml/2006/main'
REL_NS   = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

INTERROGATIVE = re.compile(
    r'^(Какой|Какая|Какие|Какое|Каков\b|Каковы\b|Какова\b|'
    r'К какой|К каком\b|К каким\b|К какому\b|'
    r'По каким\b|По каком\b|'
    r'В каких\b|В каком\b|В какой\b|'
    r'Дан\b|Дана\b|Даны\b|Дано\b)',
    re.IGNORECASE
)
NEW_BLOCK = re.compile(
    r'^(Проделайте|Загрузите|Постройте\b|Используя\b|Объедините\b|'
    r'Ранее\b|Исходные данные\b)',
    re.IGNORECASE
)
SKIP_EXACT  = {'Варианты ответов:', 'Вопрос:'}
SKIP_STARTS = ('Примечание',)
TOPIC_START = 'Тема:'
ORDERING    = 'Расставить в правильной последовательности'


def extract_image(para, doc):
    """Извлекает первую картинку из абзаца. Возвращает (fname, base64) или None."""
    pics = para._element.findall(f'.//{{{PIC_NS}}}pic')
    if not pics:
        return None
    for pic in pics:
        blip = pic.find(f'.//{{{BLIP_NS}}}blip')
        if blip is not None:
            rid = blip.get(f'{{{REL_NS}}}embed')
            if rid and rid in doc.part.related_parts:
                part = doc.part.related_parts[rid]
                ext  = part.content_type.split('/')[-1].replace('jpeg', 'jpg')
                data = base64.b64encode(part.blob).decode('ascii')
                return (f'img_{rid}.{ext}', data)
    return None


def is_highlighted(para):
    return any(
        r.font.color.rgb is not None or r.font.highlight_color is not None
        for r in para.runs
    )


def is_new_q_start(text, in_ans, answers):
    if not in_ans:
        return False
    if INTERROGATIVE.match(text) or NEW_BLOCK.match(text):
        return True
    if answers and max(len(a[0]) for a in answers) <= 20 and len(text) > 50:
        return True
    return False


def parse(doc):
    """
    Возвращает список вопросов:
    (q_lines, answers, images)
      q_lines — список строк текста вопроса
      answers — список (text, is_correct)
      images  — список (fname, base64) картинок из условия
    """
    paras = []
    for p in doc.paragraphs:
        t   = p.text.strip()
        img = extract_image(p, doc)
        if t or img:
            paras.append((t, is_highlighted(p), img))

    start = next((i for i, (t, _, _) in enumerate(paras) if t.startswith(TOPIC_START)), 0)

    questions = []
    q_lines   = []
    answers   = []
    images    = []
    in_ans    = False
    q_ended   = False
    skip_ord  = False

    def flush():
        nonlocal q_lines, answers, images, in_ans, q_ended
        if q_lines and answers:
            questions.append((list(q_lines), list(answers), list(images)))
        q_lines = []; answers = []; images = []; in_ans = False; q_ended = False

    for text, highlighted, img in paras[start:]:

        if text.startswith(TOPIC_START):
            flush()
            continue

        if text in SKIP_EXACT or any(text.startswith(p) for p in SKIP_STARTS):
            if text == 'Варианты ответов:':
                in_ans = True
                q_ended = False
            continue

        if ORDERING in text:
            flush()
            skip_ord = True
            continue
        if skip_ord:
            if text.endswith('.') or text.endswith('?'):
                skip_ord = False
                q_lines = [text]
            continue

        # Картинка без текста — прикрепляем к текущему вопросу
        if img and not text:
            images.append(img)
            continue

        if in_ans:
            if is_new_q_start(text, in_ans, answers):
                flush()
                q_lines = [text]
                if img:
                    images.append(img)
                if INTERROGATIVE.match(text):
                    q_ended = True
            else:
                if img:
                    images.append(img)
                answers.append((text, highlighted))
            continue

        if q_ended:
            in_ans  = True
            q_ended = False
            if img:
                images.append(img)
            answers.append((text, highlighted))
            continue

        q_lines.append(text)
        if img:
            images.append(img)

        if INTERROGATIVE.match(text) or text.endswith('?'):
            q_ended = True

    flush()
    return questions


def build_xml_question(q_lines, answers, images):
    corrects = [(t, ok) for t, ok in answers if ok]
    wrongs   = [(t, ok) for t, ok in answers if not ok]

    if not corrects:
        q_short = ' '.join(q_lines)[:80]
        return f'<!-- ПРОПУЩЕН (нет правильного ответа): {escape(q_short)} -->\n'

    title = escape(re.sub(r'[<>&"\']', '', ' '.join(q_lines))[:100])
    q_html = escape(' '.join(q_lines))

    # Добавляем картинки в текст вопроса
    img_tags = ''
    for fname, _ in images:
        img_tags += f' <img src="@@PLUGINFILE@@/{escape(fname)}" alt="" />'

    single = len(corrects) == 1
    if single:
        correct_frac = '100'
    else:
        correct_frac = str(round(100 / len(corrects), 5))

    lines = [
        '<question type="multichoice">',
        f'  <name><text>{title}</text></name>',
        f'  <questiontext format="html">',
        f'    <text><![CDATA[{q_html}{img_tags}]]></text>',
    ]
    for fname, b64 in images:
        lines.append(
            f'    <file name="{escape(fname)}" path="/" encoding="base64">{b64}</file>'
        )
    lines += [
        f'  </questiontext>',
        f'  <generalfeedback format="html"><text></text></generalfeedback>',
        f'  <defaultgrade>1</defaultgrade>',
        f'  <penalty>0.3333333</penalty>',
        f'  <hidden>0</hidden>',
        f'  <single>{"true" if single else "false"}</single>',
        f'  <shuffleanswers>true</shuffleanswers>',
        f'  <answernumbering>abc</answernumbering>',
    ]
    for text, is_correct in answers:
        frac = correct_frac if is_correct else '0'
        lines += [
            f'  <answer fraction="{frac}" format="html">',
            f'    <text><![CDATA[{escape(text)}]]></text>',
            f'    <feedback format="html"><text></text></feedback>',
            f'  </answer>',
        ]
    lines.append('</question>')
    return '\n'.join(lines)


def main():
    doc = Document(INPUT)
    questions = parse(doc)

    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<quiz>',
        '<!-- GeoCore-Academy -->',
        '<!-- Конвертировано из DOCX скриптом tools/docx_to_moodle_xml.py -->',
        '',
    ]

    ok = skipped = img_count = 0
    print(f"{'№':>3}  {'Отв':>4}  {'Прав':>4}  {'Img':>4}  Вопрос")
    print('-' * 85)
    for i, (q_lines, answers, images) in enumerate(questions):
        block = build_xml_question(q_lines, answers, images)
        out.append(block)
        out.append('')
        if block.startswith('<!-- ПРОПУЩЕН'):
            skipped += 1
        else:
            ok += 1
        if images:
            img_count += len(images)
        c = sum(1 for _, ok_ in answers if ok_)
        img_mark = f'{len(images)}🖼' if images else ' '
        print(f"{i+1:>3}  {len(answers):>4}  {c:>4}  {img_mark:>4}  {' / '.join(q_lines)[:65]}")

    out.append('</quiz>')

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))

    print(f"\nРезультат: {ok} конвертировано, {skipped} пропущено")
    print(f"Картинки встроены: {img_count}")
    print(f"Файл: {OUTPUT}")


if __name__ == '__main__':
    main()
