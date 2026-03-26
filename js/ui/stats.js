import { TEMPLATES } from '../data/templates.js';
import { getParam } from '../utils/helpers.js';

export function updateUI(holes, blocks, method, cutoff, standard) {
  console.log('[UI] Обновление статистики');
  let ti = 0, tg = 0, hi = 0;
  const cfg = Object.values(TEMPLATES).find(c => c.standard === standard) || TEMPLATES.gold;
  
  holes.forEach(h => {
    ti += h.intervals.length;
    h.intervals.forEach(([,, v]) => { tg += v; if (v > cfg.highCutoff) hi++; });
  });
  const avgRaw = ti ? tg / ti : 0;

  let catLines = '';
  if (blocks.length) {
    const vol = 125, density = 2.7;
    const cats = { Measured: { t: 0, m: 0 }, Indicated: { t: 0, m: 0 }, Inferred: { t: 0, m: 0 } };
    blocks.forEach(b => {
      if (b.grade >= cutoff && cats[b.category]) {
        const ton = vol * density / 1e6;
        cats[b.category].t += ton;
        cats[b.category].m += ton * b.grade * 1e6 / 31.1035 / 1e3;
      }
    });
    const totalT = blocks.filter(b => b.grade >= cutoff).length * vol * density / 1e6;
    const avgG = blocks.filter(b => b.grade >= cutoff).reduce((s, b) => s + b.grade, 0) / (blocks.filter(b => b.grade >= cutoff).length || 1);
    const totalM = totalT * avgG * 1e6 / 31.1035 / 1e3;
    catLines = `
── ОЦЕНКА РЕСУРСОВ (${standard}) ──
Метод: ${method.toUpperCase()} | Блок: 5м | Cutoff: ${cutoff} ${cfg.unit}
Тоннаж (≥cutoff): ${totalT.toFixed(2)} Mt
Среднее (модель): ${avgG.toFixed(2)} ${cfg.unit}
Металл / объём: ${totalM.toFixed(0)} koz
Блоков: ${blocks.length}
Measured:  ${cats.Measured.t.toFixed(2)} Mt
Indicated: ${cats.Indicated.t.toFixed(2)} Mt
Inferred:  ${cats.Inferred.t.toFixed(2)} Mt`;
  }

  const statsDiv = document.getElementById('statsOut');
  if (statsDiv) {
    statsDiv.textContent = `Скважин: ${holes.length} | Интервалов: ${ti}
Среднее (${cfg.field}): ${avgRaw.toFixed(2)} ${cfg.unit}
Высокое (>${cfg.highCutoff}): ${hi} интервалов${catLines}`;
  }

  updateScriptOnly(holes, method, cutoff, standard);
}

export function updateScriptOnly(holes, method, cutoff, standard) {
  const cfg = Object.values(TEMPLATES).find(c => c.standard === standard) || TEMPLATES.gold;
  const blockSize = getParam('blockSize') || 5;
  
  // Преобразуем метод интерполяции в формат Datamine
  let datamineMethod = 'IDW';
  let powerParam = '';
  let krigingParams = '';
  
  if (method === 'idw') {
    datamineMethod = 'IDW';
    powerParam = '/POWER=2';
  } else if (method === 'kriging') {
    datamineMethod = 'OK';
    krigingParams = '/NUGGET=0.2 /SILL=2.0 /RANGE=25 /MODEL=SPHERICAL';
  } else if (method === 'nn') {
    datamineMethod = 'NN';
  }
  
  const fieldName = cfg.field.toUpperCase();
  const unitLabel = standard === 'Coal' ? 'мощность (м)' : (standard === 'JORC' ? 'содержание (г/т)' : 'содержание (%)');
  
  // Рекомендации по плотности в зависимости от типа месторождения
  let densityRecommendation = '';
  if (standard === 'Coal') {
    densityRecommendation = '!*    Для угля плотность обычно 1.2–1.5 т/м³ (измените /DENSITY при необходимости)';
  } else if (cfg.field === 'Au_gpt') {
    densityRecommendation = '!*    Для золота плотность 2.7 т/м³ (стандартное значение, можно изменить)';
  } else if (cfg.field === 'Cu_pct') {
    densityRecommendation = '!*    Для меди плотность 2.8–3.2 т/м³ (измените /DENSITY под ваше месторождение)';
  } else {
    densityRecommendation = '!*    Плотность руды: 2.7 т/м³ (при необходимости измените параметр /DENSITY)';
  }
  
  const macro = `!**********************************************************************
!*  GeoCore Academy — Макрос для Datamine Studio RM
!*  ==================================================
!*  Дата генерации: ${new Date().toLocaleString('ru')}
!*  Скважин: ${holes.length}
!*  Стандарт: ${standard}
!*  Метод: ${method.toUpperCase()}
!*  Размер блока: ${blockSize} м
!*  Cutoff: ${cutoff} ${cfg.unit}
!*  Компонент: ${cfg.field} (${unitLabel})
!**********************************************************************

!**********************************************************************
!*  ШАГ 1: ЗАГРУЗКА ДАННЫХ ОПРОБОВАНИЯ
!**********************************************************************
!*  Формат CSV: HoleID, From, To, ${cfg.field}
!*  
!*  ВАЖНО: Замените "assay.csv" на путь к вашему файлу!
!*  Примеры:
!*    !READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:${fieldName}
!*    !READ C:\\Projects\\assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:${fieldName}
!*  
!*  ВНИМАНИЕ: В имени файла НЕ должно быть пробелов, иначе используйте короткое имя (8.3)
!*  Разделитель полей — пробел, поэтому в имени файла пробелы недопустимы
!**********************************************************************

!READ assay.csv /CREATE=assay /FIELD=1:HOLEID,2:FROM,3:TO,4:${fieldName}
!LIST assay /FIELDS=1-4 /MAX=20

!**********************************************************************
!*  ШАГ 2: КОМПОЗИТИРОВАНИЕ (единая длина пробы 2 м)
!**********************************************************************
!*  Приводит все пробы к одинаковой длине для корректной статистики
!**********************************************************************

!COMP assay /LENGTH=2 /FIELD=${fieldName} /CREATE=comp_assay
!LIST comp_assay /FIELDS=HOLEID,FROM,TO,${fieldName} /MAX=20

!**********************************************************************
!*  ШАГ 3: СОЗДАНИЕ БЛОЧНОЙ МОДЕЛИ
!**********************************************************************
!*  Область модели: X от -50 до 50 (100 м)
!*                 Y от -25 до 25 (50 м)
!*                 Z от -25 до 25 (50 м)
!*  Размер блока: ${blockSize}×${blockSize}×${blockSize} м
!*  Количество блоков: ${Math.ceil(100/blockSize)}×${Math.ceil(50/blockSize)}×${Math.ceil(50/blockSize)}
!**********************************************************************

!BLKMOD /CREATE=block_model /ORIGIN=(-50,-25,-25) /SIZE=(${blockSize},${blockSize},${blockSize}) /BLOCKS=(${Math.ceil(100/blockSize)},${Math.ceil(50/blockSize)},${Math.ceil(50/blockSize)})
!LIST block_model /FIELDS=X,Y,Z /MAX=20

!**********************************************************************
!*  ШАГ 4: ИНТЕРПОЛЯЦИЯ (${method.toUpperCase()})
!**********************************************************************
!*  Параметры поиска:
!*    - Максимум проб: 12
!*    - Минимум проб: 3
!*    - Радиус поиска: 40 м
${method === 'kriging' ? `!*    - Вариограмма: сферическая (Nugget=0.2, Sill=2.0, Range=25)
!*    - Параметры можно изменить под ваше месторождение` : ''}
!**********************************************************************

!ESTIMA /DATA=comp_assay /FIELD=${fieldName} /METHOD=${datamineMethod} ${powerParam} /MAX=12 /MIN=3 /SEARCH=40 /MODEL=block_model /CREATE=model_est ${krigingParams}
!LIST model_est /FIELDS=X,Y,Z,${fieldName} /MAX=20

!**********************************************************************
!*  ШАГ 5: ПОДСЧЁТ РЕСУРСОВ (CUTOFF = ${cutoff} ${cfg.unit})
!**********************************************************************
!*  Плотность руды: 2.7 т/м³ (можно изменить под ваше месторождение)
${densityRecommendation}
!**********************************************************************

!FILTER model_est /CONDITION="${fieldName} >= ${cutoff}" /CREATE=model_cutoff
!REPORT model_cutoff /FIELDS=${fieldName},TONNES /DENSITY=2.7 /OUT=report_${method}_${blockSize}m.txt

!**********************************************************************
!*  ШАГ 6: ЭКСПОРТ РЕЗУЛЬТАТОВ
!**********************************************************************

!WRITE model_est /FILE=model_${method}_${blockSize}m.blockmodel /FORMAT=BINARY
!WRITE model_cutoff /FILE=cutoff_${cutoff}.csv /FORMAT=CSV /FIELDS=X,Y,Z,${fieldName},TONNES

!**********************************************************************
!*  СТАТИСТИКА ОЦЕНКИ (ВЫВОД В КОНСОЛЬ)
!**********************************************************************

!PRINT "======================================================================"
!PRINT "GeoCore Academy — Результаты оценки ресурсов"
!PRINT "======================================================================"
!PRINT "Стандарт: ${standard}"
!PRINT "Метод: ${method.toUpperCase()}"
!PRINT "Размер блока: ${blockSize} м"
!PRINT "Cutoff: ${cutoff} ${cfg.unit}"
!PRINT "======================================================================"
!TABGEN /DATA=model_cutoff /FIELDS=${fieldName},TONNES /DENSITY=2.7 /STATS=SUM,MEAN
!PRINT "======================================================================"
!PRINT "✅ Макрос выполнен успешно!"
!PRINT "Результаты сохранены в:"
!PRINT "  - model_${method}_${blockSize}m.blockmodel (блочная модель)"
!PRINT "  - cutoff_${cutoff}.csv (блоки выше cutoff)"
!PRINT "  - report_${method}_${blockSize}m.txt (текстовый отчёт)"
!PRINT "======================================================================"

!**********************************************************************
!*  КОНЕЦ МАКРОСА
!**********************************************************************
!*  
!*  ИНСТРУКЦИЯ ПО ЗАПУСКУ:
!*  1. Сохраните этот текст в файл с расширением .mac (например, estimation.mac)
!*  2. В Datamine Studio RM выполните команду: !RUN estimation.mac
!*  3. Или через меню: Macro → Run и выберите файл
!*  
!*  ПРИМЕЧАНИЯ:
!*  - Убедитесь, что файл assay.csv находится в той же папке, что и макрос
!*  - Или укажите полный путь в команде !READ
!*  - В имени файла НЕ должно быть пробелов
!*  - Для кригинга нужна предварительно построенная вариограмма
!*  - Плотность руды можно изменить параметром /DENSITY в !REPORT и !TABGEN
!**********************************************************************`;

  const scriptDiv = document.getElementById('scriptOut');
  if (scriptDiv) scriptDiv.textContent = macro;
  console.log('[UI] Реальный макрос Datamine обновлён');
}
