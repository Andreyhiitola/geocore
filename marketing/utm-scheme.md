# UTM-схема GeoCore-Academy (KZ)

Метки дописываются к ссылке и ничего не меняют на сайте. Посещения с метками видны в отчёте GoAccess
(`geocore-academy.kz/site-stats/`, разделы «Requested Files» и «Referrers»).

## Правила
- Только латиница, нижний регистр, слова через `_`. Без пробелов и кириллицы.
- Метки ставим на **каждую** ссылку на сайт, которую отправляем наружу: письма, КП, посты, сообщения.
- Метки идут **до** якоря: `https://geocore-academy.kz/?utm_source=email#consult`, не наоборот.
- Не кладём в метки персональные данные (имена, e-mail). Для B2B допустим внутренний id компании из трекера (`l07`).

## Параметры
| Параметр | Что значит | Значения |
|---|---|---|
| `utm_source` | канал | `email`, `linkedin`, `whatsapp`, `telegram`, `yandex`, `vk`, `partner`, `conf` |
| `utm_medium` | тип | `cold_email`, `followup`, `post`, `message`, `ad`, `referral`, `kp` |
| `utm_campaign` | **сегмент** | `seg1_geolog`, `seg2_otchetnost`, `seg3_b2b`, `seg4_invest`, `seg5_student` |
| `utm_content` | вариант (необязательно) | `v1`/`v2` (A/B текста), `step1`/`step2` (номер письма), `l07` (id компании из трекера) |

`utm_term` не используем.

## Сегменты → куда вести
| Сегмент | `utm_campaign` | Страница |
|---|---|---|
| Геологи и геомоделлеры | `seg1_geolog` | `/tag/datamine.html`, `/tag/leapfrog-geo.html`, `/courses.html` |
| Специалисты по отчётности | `seg2_otchetnost` | `/tag/jorc.html`, `/articles/JORC_vs_GKZ_articel.html` |
| B2B (корпоративное обучение) | `seg3_b2b` | `/#consult` |
| Инвесторы, junior, топ-менеджмент | `seg4_invest` | `/#consult` |
| Студенты | `seg5_student` | `/courses.html` |

## Готовые ссылки
```
# seg3: холодное письмо компании l07, первое письмо
https://geocore-academy.kz/?utm_source=email&utm_medium=cold_email&utm_campaign=seg3_b2b&utm_content=l07_step1#consult

# seg3: повторное письмо (через 7–10 дней)
https://geocore-academy.kz/?utm_source=email&utm_medium=followup&utm_campaign=seg3_b2b&utm_content=l07_step2#consult

# seg2: пост в LinkedIn со статьёй «JORC vs ГКЗ»
https://geocore-academy.kz/articles/JORC_vs_GKZ_articel.html?utm_source=linkedin&utm_medium=post&utm_campaign=seg2_otchetnost

# seg2: хаб JORC в личном сообщении
https://geocore-academy.kz/tag/jorc.html?utm_source=linkedin&utm_medium=message&utm_campaign=seg2_otchetnost

# seg1: хаб Datamine в Telegram-чате геологов
https://geocore-academy.kz/tag/datamine.html?utm_source=telegram&utm_medium=post&utm_campaign=seg1_geolog

# seg1: каталог курсов в WhatsApp
https://geocore-academy.kz/courses.html?utm_source=whatsapp&utm_medium=message&utm_campaign=seg1_geolog

# seg3/seg4: ссылка в КП
https://geocore-academy.kz/?utm_source=email&utm_medium=kp&utm_campaign=seg3_b2b&utm_content=l07#consult
```

## Как читать
В GoAccess ищем в «Requested Files» адреса с `utm_campaign=...` и сравниваем число визитов по сегментам и каналам.
Метки не показывают, кто конкретно открыл письмо, а только что на сайт зашли по ссылке.
