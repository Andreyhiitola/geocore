#!/usr/bin/env python3
"""
GeoCore Academy — Конвертер тестов для Moodle
Запуск: python3 tools/convert.py
"""

import os
import sys
import importlib.util

CONVERTERS = [
    {
        "label": "DOCX → GIFT         (Word без картинок → Moodle GIFT)",
        "module": "docx_to_gift",
        "needs_images": False,
        "out_ext": ".gift",
    },
    {
        "label": "DOCX → Moodle XML   (Word с картинками → Moodle XML)",
        "module": "docx_to_moodle_xml",
        "needs_images": False,
        "out_ext": ".xml",
    },
    {
        "label": "QTI → GIFT          (IMS QTI 1.2 без картинок → GIFT)",
        "module": "qti_to_gift",
        "needs_images": False,
        "out_ext": ".gift",
    },
    {
        "label": "QTI → Moodle XML    (IMS QTI 1.2 с картинками → Moodle XML)",
        "module": "qti_to_moodle_xml",
        "needs_images": True,
        "out_ext": ".xml",
    },
]

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))


def ask(prompt, default=None):
    """Спросить у пользователя путь с подстановкой ~."""
    hint = f" [{default}]" if default else ""
    value = input(f"{prompt}{hint}: ").strip()
    if not value and default:
        return default
    return os.path.expanduser(value)


def load_module(name):
    path = os.path.join(TOOLS_DIR, f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    print("\n=== GeoCore Academy — Конвертер тестов для Moodle ===\n")

    # Выбор конвертера
    for i, c in enumerate(CONVERTERS, 1):
        print(f"  {i}. {c['label']}")
    print()

    while True:
        choice = input("Выбери конвертер (1–4): ").strip()
        if choice in ("1", "2", "3", "4"):
            break
        print("  Введи цифру от 1 до 4")

    conv = CONVERTERS[int(choice) - 1]

    # Входной файл
    print()
    input_path = ask("Путь к исходному файлу")
    if not os.path.isfile(input_path):
        print(f"\nОшибка: файл не найден — {input_path}")
        sys.exit(1)

    # Папка с картинками (только для QTI → Moodle XML)
    images_dir = None
    if conv["needs_images"]:
        print()
        default_images = os.path.join(os.path.dirname(input_path), "qti_images")
        images_dir = ask("Папка с картинками (qti_images/)", default=default_images)
        if not os.path.isdir(images_dir):
            print(f"  Предупреждение: папка не найдена — {images_dir}")
            print("  Продолжаем без картинок.")
            images_dir = None

    # Папка для результата
    print()
    default_out = os.path.dirname(input_path)
    out_folder = ask("Папка для сохранения результата", default=default_out)
    if not os.path.isdir(out_folder):
        os.makedirs(out_folder)

    # Имя выходного файла
    base_name   = os.path.splitext(os.path.basename(input_path))[0]
    default_out_file = os.path.join(out_folder, base_name + "_moodle" + conv["out_ext"])
    print()
    out_path = ask("Имя выходного файла", default=default_out_file)

    # Запуск конвертера
    print(f"\nКонвертируем...\n")
    mod = load_module(conv["module"])
    mod.INPUT  = input_path
    mod.OUTPUT = out_path
    if images_dir and hasattr(mod, "IMAGES_DIR"):
        mod.IMAGES_DIR = images_dir

    mod.main()

    print(f"\nГотово → {out_path}")
    print("Импортируй в Moodle: Банк вопросов → Импорт → выбери формат → загрузи файл\n")


if __name__ == "__main__":
    main()
