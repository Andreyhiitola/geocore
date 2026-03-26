# GeoCore Academy

https://andreyhiitola.github.io/geocore/

Образовательная платформа по оценке месторождений.

## Структура проекта

```
geocore-academy/
├── index.html          ← главная страница (только разметка + CSS)
├── script.js           ← весь JavaScript (ES-модуль)
├── article_sections_vs_datamine.html   ← статья блога
├── data/
│   ├── gold_demo.csv   ← демо-данные: золото (Au), 12 скважин
│   ├── copper_demo.csv ← демо-данные: медь (Cu), 10 скважин
│   ├── coal_demo.csv   ← демо-данные: уголь (Coal_m), 13 скважин
│   └── ore_body.obj    ← 3D-каркас рудного тела (Wavefront OBJ)
└── README.md
```

## Запуск

Так как файл использует ES-модули и `fetch()` для загрузки CSV/OBJ,
нужен локальный HTTP-сервер (не открывать через `file://`):

```bash
# Python 3
cd geocore-academy
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code — расширение Live Server
```

Затем открыть: http://localhost:8080

## Форматы файлов

### CSV (скважины)
```
HoleID,From,To,Au_gpt
Au-01,0,2,0.8
Au-01,2,4,1.2
...
```
Поддерживаются поля: `Au_gpt`, `Cu_pct`, `Coal_m`

### OBJ (каркас рудного тела)
Стандартный Wavefront OBJ: вершины (`v`) и грани (`f`).
Комментарии (`#`) игнорируются.

## Функции песочницы

- Загрузка CSV и OBJ вручную или через шаблоны (клик → автозагрузка)
- Три шаблона: Золото (Au), Медь (Cu), Уголь
- Блочная модель: IDW, Ordinary Kriging (упрощ.), Nearest Neighbour
- Классификация JORC: Measured / Indicated / Inferred
- Экспериментальная вариограмма (3 направления)
- Сохранение проектов в localStorage
- Экспорт: blocks.csv + report.txt

## Зависимости (CDN)

- Three.js r128
- IBM Plex fonts (Google Fonts)
