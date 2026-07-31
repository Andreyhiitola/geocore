"""
=============================================================================
НАЗНАЧЕНИЕ: Конвертер IMS QTI 1.2 (.xml) → Moodle XML с картинками (base64)
=============================================================================

Moodle XML поддерживает встроенные изображения — картинки из QTI будут
включены в файл и появятся в вопросах после импорта.

КАК ИСПОЛЬЗОВАТЬ:
    1. Распакуй архив .7z — рядом с XML должна быть папка qti_images/
    2. Поменяй INPUT, IMAGES_DIR, OUTPUT ниже
    3. python3 qti_to_moodle_xml.py
    4. Импортируй в Moodle: Банк вопросов → Импорт → Moodle XML

РАЗРАБОТАН ДЛЯ: GeoCore-Academy, апрель 2026
=============================================================================
"""

import base64
import os
import re
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

# ── Настройки ─────────────────────────────────────────────────────────────
INPUT      = '/tmp/qti_extract/геологическое моделированиеqti.xml'
IMAGES_DIR = '/tmp/qti_extract/qti_images'
OUTPUT     = '/home/andysag/Downloads/WhatSie/test_datamine.xml'
# ─────────────────────────────────────────────────────────────────────────


def get_mattext(element):
    parts = []
    for mt in element.findall('.//mattext'):
        t = (mt.text or '').strip()
        if t:
            parts.append(t)
    return ' '.join(parts)


def find_image(element, images_dir):
    """Ищет matimage внутри элемента, возвращает (filename, base64_data) или None."""
    for mi in element.findall('.//matimage'):
        uri = mi.get('uri') or mi.get('URI') or ''
        # uri может быть ident картинки или именем файла
        # ищем файл в images_dir по частичному совпадению ident
        ident = mi.get('imagtype') or uri
        # попробуем найти файл напрямую по uri
        candidate = os.path.join(images_dir, os.path.basename(uri)) if uri else None
        if candidate and os.path.exists(candidate):
            fname = os.path.basename(candidate)
            with open(candidate, 'rb') as f:
                data = base64.b64encode(f.read()).decode('ascii')
            return fname, data
        # ищем любой файл в папке, ident которого есть в имени
        for fname in os.listdir(images_dir):
            # ident часто совпадает с именем файла (без расширения)
            if uri and (uri in fname or fname.startswith(uri.split('/')[-1])):
                fpath = os.path.join(images_dir, fname)
                with open(fpath, 'rb') as f:
                    data = base64.b64encode(f.read()).decode('ascii')
                return fname, data
    return None


def find_image_by_ident(item_ident, images_dir):
    """Ищет картинку по ident вопроса — часто имя файла содержит ident."""
    for fname in os.listdir(images_dir):
        name_noext = os.path.splitext(fname)[0]
        if item_ident in fname or fname in item_ident:
            fpath = os.path.join(images_dir, fname)
            with open(fpath, 'rb') as f:
                data = base64.b64encode(f.read()).decode('ascii')
            return fname, data
    return None


def xml_file_tag(fname, b64data):
    ext = os.path.splitext(fname)[1].lower()
    return (
        f'<file name="{escape(fname)}" path="/" encoding="base64">'
        f'{b64data}'
        f'</file>'
    )


def build_question(item_title, q_text, answers, img):
    """
    answers: list of (text, is_correct)
    img: (filename, base64_data) or None
    """
    corrects = [(t, ok) for t, ok in answers if ok]
    wrongs   = [(t, ok) for t, ok in answers if not ok]

    q_type = 'multichoice'

    # Дробь за правильный ответ
    if len(corrects) == 1:
        correct_fraction = '100'
        wrong_fraction   = '0'
        single = True
    else:
        pct = round(100 / len(corrects), 5)
        correct_fraction = str(pct)
        wrong_fraction   = '0'
        single = False

    # Текст вопроса — если есть картинка, добавляем img-тег
    if img:
        fname, b64 = img
        q_html = escape(q_text) + f' <img src="@@PLUGINFILE@@/{escape(fname)}" />'
        file_tag = xml_file_tag(fname, b64)
    else:
        q_html = escape(q_text)
        file_tag = ''

    title_safe = escape(re.sub(r'[<>&"\']', '', item_title or q_text)[:100])

    lines = [
        '<question type="multichoice">',
        f'  <name><text>{title_safe}</text></name>',
        f'  <questiontext format="html">',
        f'    <text><![CDATA[{q_html}]]></text>',
    ]
    if file_tag:
        lines.append(f'    {file_tag}')
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
        fraction = correct_fraction if is_correct else wrong_fraction
        lines += [
            f'  <answer fraction="{fraction}" format="html">',
            f'    <text><![CDATA[{escape(text)}]]></text>',
            f'    <feedback format="html"><text></text></feedback>',
            f'  </answer>',
        ]

    lines.append('</question>')
    return '\n'.join(lines)


def parse_and_convert(xml_path, images_dir):
    tree = ET.parse(xml_path)
    root = tree.getroot()

    assessment = root.find('.//assessment')
    title = assessment.get('title', '') if assessment is not None else ''

    questions_xml = []
    ok = skipped = img_count = 0

    for item in root.findall('.//item'):
        item_title = item.get('title', '')
        item_ident = item.get('ident', '')

        presentation = item.find('presentation')
        if presentation is None:
            continue

        q_text = get_mattext(presentation)

        # Картинка: сначала ищем в presentation по matimage
        img = find_image(presentation, images_dir)
        # Если не нашли — пробуем по ident вопроса
        if img is None and item_ident:
            img = find_image_by_ident(item_ident, images_dir)

        resp_lid = item.find('.//response_lid')
        if resp_lid is None:
            skipped += 1
            continue

        # Правильные ответы
        correct_idents = set()
        for cond in item.findall('.//respcondition'):
            setvar = cond.find('setvar')
            if setvar is not None and setvar.text and int(setvar.text) > 0:
                for ve in cond.findall('.//varequal'):
                    correct_idents.add(ve.text)
        if not correct_idents:
            for label in resp_lid.findall('.//response_label'):
                if label.get('ws_right') == '1':
                    correct_idents.add(label.get('ident'))

        answers = []
        for label in resp_lid.findall('.//response_label'):
            ident = label.get('ident')
            text  = get_mattext(label).strip()
            if text:
                answers.append((text, ident in correct_idents))

        if not any(ok for _, ok in answers):
            skipped += 1
            questions_xml.append(f'<!-- ПРОПУЩЕН (нет правильного ответа): {escape(q_text[:80])} -->')
            continue

        q_xml = build_question(item_title, q_text, answers, img)
        questions_xml.append(q_xml)
        ok += 1
        if img:
            img_count += 1
            print(f"  ✓ Картинка встроена: вопрос «{q_text[:60]}»")

    return title, questions_xml, ok, skipped, img_count


def main():
    print(f"Читаем: {INPUT}")
    print(f"Картинки: {IMAGES_DIR}\n")

    title, questions_xml, ok, skipped, img_count = parse_and_convert(INPUT, IMAGES_DIR)

    xml_out = ['<?xml version="1.0" encoding="UTF-8"?>']
    xml_out.append('<quiz>')
    xml_out.append(f'<!-- Тест: {escape(title)} -->')
    xml_out.append(f'<!-- Конвертировано из QTI 1.2 скриптом tools/qti_to_moodle_xml.py -->')
    xml_out.append('')
    for q in questions_xml:
        xml_out.append(q)
        xml_out.append('')
    xml_out.append('</quiz>')

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(xml_out))

    print(f"\nРезультат: {ok} конвертировано, {skipped} пропущено")
    print(f"Картинки встроены: {img_count}")
    print(f"Файл: {OUTPUT}")


if __name__ == '__main__':
    main()
