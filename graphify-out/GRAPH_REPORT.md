# Graph Report - .  (2026-06-29)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 433 nodes · 743 edges · 55 communities (46 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `322950a6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_3D Visualization Engine|3D Visualization Engine]]
- [[_COMMUNITY_CSV Data Processing|CSV Data Processing]]
- [[_COMMUNITY_System Monitoring Bot|System Monitoring Bot]]
- [[_COMMUNITY_Course Site Renderer|Course Site Renderer]]
- [[_COMMUNITY_Admin API Interface|Admin API Interface]]
- [[_COMMUNITY_Admin Auth Testing|Admin Auth Testing]]
- [[_COMMUNITY_Request Management System|Request Management System]]
- [[_COMMUNITY_Geological Declustering Analysis|Geological Declustering Analysis]]
- [[_COMMUNITY_DOCX to GIFT Converter|DOCX to GIFT Converter]]
- [[_COMMUNITY_Image Conversion Tools|Image Conversion Tools]]
- [[_COMMUNITY_QTI to Moodle XML|QTI to Moodle XML]]
- [[_COMMUNITY_Backup Restoration Script|Backup Restoration Script]]
- [[_COMMUNITY_Project Documentation Wiki|Project Documentation Wiki]]
- [[_COMMUNITY_Moodle Account Management|Moodle Account Management]]
- [[_COMMUNITY_Frontend Article Pages|Frontend Article Pages]]
- [[_COMMUNITY_DOCX to Moodle XML|DOCX to Moodle XML]]
- [[_COMMUNITY_QTI to GIFT Converter|QTI to GIFT Converter]]
- [[_COMMUNITY_Contract and Invoice Generation|Contract and Invoice Generation]]
- [[_COMMUNITY_Course Request Notifications|Course Request Notifications]]
- [[_COMMUNITY_Course Publishing Pipeline|Course Publishing Pipeline]]
- [[_COMMUNITY_Site Configuration Management|Site Configuration Management]]
- [[_COMMUNITY_S3 Backup Automation|S3 Backup Automation]]
- [[_COMMUNITY_VPS Bootstrap Script|VPS Bootstrap Script]]
- [[_COMMUNITY_Chat Interface Logic|Chat Interface Logic]]
- [[_COMMUNITY_SCORM Packaging Pipeline|SCORM Packaging Pipeline]]
- [[_COMMUNITY_Billing Status Check|Billing Status Check]]
- [[_COMMUNITY_Project Architecture Docs|Project Architecture Docs]]
- [[_COMMUNITY_SCORM UI Resizing|SCORM UI Resizing]]
- [[_COMMUNITY_System Health Monitoring|System Health Monitoring]]
- [[_COMMUNITY_System Update Script|System Update Script]]
- [[_COMMUNITY_S3 Bucket Setup|S3 Bucket Setup]]
- [[_COMMUNITY_Container Entrypoint|Container Entrypoint]]
- [[_COMMUNITY_Moodle Docker Configuration|Moodle Docker Configuration]]
- [[_COMMUNITY_Container Entrypoint|Container Entrypoint]]
- [[_COMMUNITY_Moodle Core Renderer|Moodle Core Renderer]]
- [[_COMMUNITY_Package Repackaging Script|Package Repackaging Script]]
- [[_COMMUNITY_Server Startup Script|Server Startup Script]]
- [[_COMMUNITY_Test Authoring Guide|Test Authoring Guide]]

## God Nodes (most connected - your core abstractions)
1. `wireEvents()` - 20 edges
2. `get_pool()` - 18 edges
3. `process()` - 17 edges
4. `loadTemplate()` - 13 edges
5. `generate_mac_only()` - 11 edges
6. `handle()` - 11 edges
7. `Wiki Index` - 10 edges
8. `generate_wireframe_convex_hull()` - 9 edges
9. `restore.sh script` - 9 edges
10. `App` - 9 edges

## Surprising Connections (you probably didn't know these)
- `process()` --calls--> `apply_declustering()`  [INFERRED]
  backend/main.py → backend/processing/decluster.py
- `process()` --calls--> `calculate_declustered_statistics()`  [INFERRED]
  backend/main.py → backend/processing/decluster.py
- `validate()` --calls--> `validate_csv()`  [INFERRED]
  backend/main.py → backend/processing/validator.py
- `process()` --calls--> `composite_intervals()`  [INFERRED]
  backend/main.py → backend/processing/compositor.py
- `process()` --calls--> `generate_mac()`  [INFERRED]
  backend/main.py → backend/processing/mac_generator.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Wiki Documentation Set** — wiki_backup, wiki_index, wiki_migration, wiki_backend, wiki_decisions, wiki_email, wiki_frontend, wiki_infrastructure, wiki_lab, wiki_moodle, wiki_problems [INFERRED 1.00]
- **GeoCore Academy Web Platform** — frontend_courses, frontend_index, frontend_lab, frontend_sandbox [INFERRED 0.90]
- **GeoCore Academy Knowledge Base** — frontend_articles_jorc_vs_gkz, frontend_articles_variogramma, frontend_articles_sections_vs_datamine, frontend_articles_bortsov_epithermal, frontend_articles_datamine_jorc [INFERRED 0.80]
- **Project Documentation Set** — architecture, billing_guide, moodle_guide, project, readme, recovery, roadmap, status, workflow, worklog [INFERRED 0.90]

## Communities (55 total, 9 thin omitted)

### Community 0 - "3D Visualization Engine"
Cohesion: 0.11
Nodes (40): getModelRange(), interpolateBlocks(), runModel(), init3D(), clearOreGrp(), drawCoalSeams(), drawEllipsoidOreBody(), getColorByGrade() (+32 more)

### Community 1 - "CSV Data Processing"
Cohesion: 0.09
Nodes (42): Any, generate_mac_only(), generate_wireframe_only(), process(), DataFrame, Read a public CSV upload with bounded memory and row count., Только валидация CSV файла, Полная обработка данных (+34 more)

### Community 2 - "System Monitoring Bot"
Cohesion: 0.21
Nodes (22): alert(), backup_history_text(), check(), _check_token_reminder(), clear(), edit(), get_containers(), get_cpu() (+14 more)

### Community 3 - "Course Site Renderer"
Cohesion: 0.21
Nodes (18): cardInner(), ensureModal(), esc(), fetchCoursesFromAPI(), initSite(), loadSiteData(), openLiveModal(), openPlannedModal() (+10 more)

### Community 4 - "Admin API Interface"
Cohesion: 0.13
Nodes (14): admin_get_site_json(), admin_login(), admin_logout(), AdminLoginRequest, chat_endpoint(), ChatRequest, _clean_thinking(), get_courses() (+6 more)

### Community 5 - "Admin Auth Testing"
Cohesion: 0.12
Nodes (3): _mock_pool(), test_admin_requests_bearer_auth(), test_admin_requests_cookie_auth()

### Community 6 - "Request Management System"
Cohesion: 0.12
Nodes (16): admin_archive_request(), admin_delete_request(), admin_get_archive(), admin_get_request(), admin_get_requests(), admin_unarchive_request(), admin_update_headcount(), admin_update_total_price() (+8 more)

### Community 7 - "Geological Declustering Analysis"
Cohesion: 0.23
Nodes (13): apply_declustering(), calculate_declustered_statistics(), cell_declustering(), distance_weighted_declustering(), polygon_area(), polygon_declustering(), DataFrame, Декластеризация взвешиванием по расстоянию до соседних скважин          Каждая п (+5 more)

### Community 8 - "DOCX to GIFT Converter"
Cohesion: 0.22
Nodes (12): build_gift(), gift_escape(), is_highlighted(), is_new_q_start(), main(), parse(), ============================================================================= НА, Определяет: эта строка начинает новый блок вопроса (только при режиме ответов). (+4 more)

### Community 9 - "Image Conversion Tools"
Cohesion: 0.27
Nodes (3): App, load_module(), Tools README

### Community 10 - "QTI to Moodle XML"
Cohesion: 0.26
Nodes (11): build_question(), find_image(), find_image_by_ident(), get_mattext(), main(), parse_and_convert(), ============================================================================= НА, Ищет matimage внутри элемента, возвращает (filename, base64_data) или None. (+3 more)

### Community 11 - "Backup Restoration Script"
Cohesion: 0.40
Nodes (9): dc(), fail(), log(), notify(), resolve_keys(), s3(), select_backup(), restore.sh script (+1 more)

### Community 12 - "Project Documentation Wiki"
Cohesion: 0.18
Nodes (11): Backend Wiki, Backup Wiki, Decisions Wiki, Email Wiki, Frontend Wiki, Wiki Index, Infrastructure Wiki, Lab Wiki (+3 more)

### Community 13 - "Moodle Account Management"
Cohesion: 0.22
Nodes (10): admin_extend_access(), admin_mark_paid(), admin_send_accounts(), _create_moodle_accounts(), _generate_secure_password(), _get_moodle_course_id(), Подтвердить оплату — обновить статус, создать аккаунты Moodle, отправить email, Продлить доступ к курсу: обновить дату в БД и timeend в Moodle для всех аккаунто (+2 more)

### Community 14 - "Frontend Article Pages"
Cohesion: 0.27
Nodes (10): frontend/articles/bortsov_epithermal_gold.html, frontend/articles/datamine_jorc_classification.html, frontend/articles/JORC_vs_GKZ_articel.html, frontend/articles/article_sections_vs_datamine.html, frontend/articles/Variogramma_article.html, frontend/courses.html, frontend/index.html, frontend/lab.html (+2 more)

### Community 15 - "DOCX to Moodle XML"
Cohesion: 0.31
Nodes (9): build_xml_question(), extract_image(), is_highlighted(), is_new_q_start(), main(), parse(), ============================================================================= НА, Извлекает первую картинку из абзаца. Возвращает (fname, base64) или None. (+1 more)

### Community 16 - "QTI to GIFT Converter"
Cohesion: 0.29
Nodes (9): build_gift(), get_text(), gift_escape(), main(), parse_qti(), ============================================================================= НА, Экранируем спецсимволы формата GIFT., Собирает текст из mattext, убирает лишние пробелы. (+1 more)

### Community 17 - "Contract and Invoice Generation"
Cohesion: 0.22
Nodes (9): admin_generate_contract(), admin_generate_invoice(), _make_contract_pdf(), _make_invoice_pdf(), _make_qr(), _pdf_font(), Сформировать договор оказания образовательных услуг (PDF), Договор оказания образовательных услуг (PDF, 2 страницы). (+1 more)

### Community 18 - "Course Request Notifications"
Cohesion: 0.28
Nodes (9): CourseRequest, create_request(), Отправить письмо через SMTP. Бросает исключение при ошибке., Отправляет два письма: уведомление администратору + авто-ответ клиенту., Приём заявки на корпоративное обучение, _send_accounts_email(), _send_request_emails(), _smtp_send() (+1 more)

### Community 19 - "Course Publishing Pipeline"
Cohesion: 0.31
Nodes (4): info(), log(), publish-courses.sh script, state_set()

### Community 20 - "Site Configuration Management"
Cohesion: 0.25
Nodes (8): admin_put_site_json(), admin_update_request(), ChatMessage, Сохранить site.json через GitHub API (запускает CI/CD деплой), Изменить статус заявки, SiteJsonUpdate, StatusUpdate, BaseModel

### Community 21 - "S3 Backup Automation"
Cohesion: 0.61
Nodes (7): fail(), log(), notify(), rotate(), s3(), s3_put_locked(), backup.sh script

### Community 22 - "VPS Bootstrap Script"
Cohesion: 0.39
Nodes (7): COMPOSE_DIR, fail(), log(), MOODLE_URL, bootstrap-vps.sh script, step(), warn()

### Community 23 - "Chat Interface Logic"
Cohesion: 0.47
Nodes (5): _contactButtons(), fetchBotReply(), _history, _KW, _localFallback()

### Community 24 - "SCORM Packaging Pipeline"
Cohesion: 0.47
Nodes (4): info(), log(), make-scorm.sh script, SCORM Pipeline

### Community 25 - "Billing Status Check"
Cohesion: 0.70
Nodes (4): fail(), hdr(), ok(), check_billing.sh script

### Community 27 - "SCORM UI Resizing"
Cohesion: 0.83
Nodes (3): fitScoContent(), onResize(), watchScormObject()

### Community 28 - "System Health Monitoring"
Cohesion: 0.83
Nodes (3): log(), send_telegram(), healthcheck.sh script

### Community 29 - "System Update Script"
Cohesion: 0.83
Nodes (3): hdr(), ok(), update.sh script

## Knowledge Gaps
- **30 isolated node(s):** `entrypoint.sh script`, `oreShellMeshes`, `currentHoles`, `currentBlocks`, `_history` (+25 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `process()` connect `CSV Data Processing` to `Admin API Interface`, `Geological Declustering Analysis`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `generate_mac_only()` connect `CSV Data Processing` to `Admin API Interface`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `generate_wireframe_only()` connect `CSV Data Processing` to `Admin API Interface`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `process()` (e.g. with `composite_intervals()` and `apply_declustering()`) actually correct?**
  _`process()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `generate_mac_only()` (e.g. with `generate_mac()` and `generate_mac_for_coal()`) actually correct?**
  _`generate_mac_only()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Список курсов из Moodle`, `Отправить письмо через SMTP. Бросает исключение при ошибке.`, `Отправляет два письма: уведомление администратору + авто-ответ клиенту.` to the rest of the system?**
  _91 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `3D Visualization Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.10651629072681704 - nodes in this community are weakly interconnected._