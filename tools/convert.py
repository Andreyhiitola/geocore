#!/usr/bin/env python3
"""
GeoCore Academy — Конвертер тестов для Moodle
Запуск: python3 tools/convert.py
"""

import os
import sys
import importlib.util
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

CONVERTERS = [
    {
        "label": "DOCX → GIFT        (Word без картинок)",
        "module": "docx_to_gift",
        "in_ext": [("Word файлы", "*.docx")],
        "needs_images": False,
        "out_ext": ".gift",
        "import_format": "GIFT",
    },
    {
        "label": "DOCX → Moodle XML  (Word с картинками)",
        "module": "docx_to_moodle_xml",
        "in_ext": [("Word файлы", "*.docx")],
        "needs_images": False,
        "out_ext": ".xml",
        "import_format": "Moodle XML",
    },
    {
        "label": "QTI → GIFT         (IMS QTI без картинок)",
        "module": "qti_to_gift",
        "in_ext": [("XML файлы", "*.xml")],
        "needs_images": False,
        "out_ext": ".gift",
        "import_format": "GIFT",
    },
    {
        "label": "QTI → Moodle XML   (IMS QTI с картинками)",
        "module": "qti_to_moodle_xml",
        "in_ext": [("XML файлы", "*.xml")],
        "needs_images": True,
        "out_ext": ".xml",
        "import_format": "Moodle XML",
    },
]

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    path = os.path.join(TOOLS_DIR, f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("GeoCore — Конвертер тестов для Moodle")
        self.resizable(False, False)
        self._build()

    def _build(self):
        pad = {"padx": 12, "pady": 6}

        # Выбор конвертера
        tk.Label(self, text="Конвертер:").grid(row=0, column=0, sticky="w", **pad)
        self.conv_var = tk.StringVar(value=CONVERTERS[0]["label"])
        conv_menu = ttk.Combobox(
            self, textvariable=self.conv_var, width=44, state="readonly",
            values=[c["label"] for c in CONVERTERS],
        )
        conv_menu.grid(row=0, column=1, columnspan=2, sticky="w", **pad)
        conv_menu.bind("<<ComboboxSelected>>", self._on_conv_change)

        # Входной файл
        tk.Label(self, text="Исходный файл:").grid(row=1, column=0, sticky="w", **pad)
        self.input_var = tk.StringVar()
        tk.Entry(self, textvariable=self.input_var, width=38).grid(row=1, column=1, **pad)
        tk.Button(self, text="Обзор…", command=self._pick_input).grid(row=1, column=2, **pad)

        # Папка с картинками (QTI → XML)
        self.images_label = tk.Label(self, text="Папка картинок:")
        self.images_label.grid(row=2, column=0, sticky="w", **pad)
        self.images_var = tk.StringVar()
        self.images_entry = tk.Entry(self, textvariable=self.images_var, width=38)
        self.images_entry.grid(row=2, column=1, **pad)
        self.images_btn = tk.Button(self, text="Обзор…", command=self._pick_images)
        self.images_btn.grid(row=2, column=2, **pad)

        # Выходной файл
        tk.Label(self, text="Сохранить как:").grid(row=3, column=0, sticky="w", **pad)
        self.output_var = tk.StringVar()
        tk.Entry(self, textvariable=self.output_var, width=38).grid(row=3, column=1, **pad)
        tk.Button(self, text="Обзор…", command=self._pick_output).grid(row=3, column=2, **pad)

        # Кнопка запуска
        tk.Button(
            self, text="Конвертировать", command=self._run,
            bg="#2d6a4f", fg="white", font=("", 11, "bold"),
            padx=10, pady=6,
        ).grid(row=4, column=0, columnspan=3, pady=14)

        self._on_conv_change()

    def _current_conv(self):
        label = self.conv_var.get()
        return next(c for c in CONVERTERS if c["label"] == label)

    def _on_conv_change(self, *_):
        conv = self._current_conv()
        state = "normal" if conv["needs_images"] else "disabled"
        self.images_entry.config(state=state)
        self.images_btn.config(state=state)
        self.images_label.config(fg="black" if conv["needs_images"] else "gray")
        # Обновить расширение выходного файла если уже выбран
        out = self.output_var.get()
        if out:
            base = os.path.splitext(out)[0]
            self.output_var.set(base + conv["out_ext"])

    def _pick_input(self):
        conv = self._current_conv()
        path = filedialog.askopenfilename(filetypes=conv["in_ext"] + [("Все файлы", "*.*")])
        if not path:
            return
        self.input_var.set(path)
        # Подставить папку с картинками рядом с файлом
        if conv["needs_images"] and not self.images_var.get():
            self.images_var.set(os.path.join(os.path.dirname(path), "qti_images"))
        # Подставить выходной файл если не задан
        if not self.output_var.get():
            base = os.path.splitext(path)[0]
            self.output_var.set(base + "_moodle" + conv["out_ext"])

    def _pick_images(self):
        folder = filedialog.askdirectory()
        if folder:
            self.images_var.set(folder)

    def _pick_output(self):
        conv = self._current_conv()
        ext  = conv["out_ext"]
        path = filedialog.asksaveasfilename(
            defaultextension=ext,
            filetypes=[(f"*{ext}", f"*{ext}"), ("Все файлы", "*.*")],
            initialfile=os.path.basename(self.output_var.get() or ""),
        )
        if path:
            self.output_var.set(path)

    def _run(self):
        conv       = self._current_conv()
        input_path = self.input_var.get().strip()
        output_path = self.output_var.get().strip()

        if not input_path:
            messagebox.showerror("Ошибка", "Укажи исходный файл")
            return
        if not os.path.isfile(input_path):
            messagebox.showerror("Ошибка", f"Файл не найден:\n{input_path}")
            return
        if not output_path:
            messagebox.showerror("Ошибка", "Укажи путь для сохранения")
            return

        images_dir = None
        if conv["needs_images"]:
            images_dir = self.images_var.get().strip() or None

        try:
            mod = load_module(conv["module"])
            mod.INPUT  = input_path
            mod.OUTPUT = output_path
            if images_dir and hasattr(mod, "IMAGES_DIR"):
                mod.IMAGES_DIR = images_dir
            mod.main()
        except Exception as e:
            messagebox.showerror("Ошибка конвертации", str(e))
            return

        messagebox.showinfo(
            "Готово",
            f"Файл сохранён:\n{output_path}\n\n"
            f"Импортируй в Moodle:\nБанк вопросов → Импорт → {conv['import_format']}",
        )


if __name__ == "__main__":
    App().mainloop()
