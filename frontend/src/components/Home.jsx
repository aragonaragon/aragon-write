import { useState } from "react";
import {
  BookOpen, BookPlus, FileText, Trash2, Sun, Moon, Palette,
  Settings as SettingsIcon, Clock, Cloud, ArrowLeft, Plus,
} from "lucide-react";
import { getProviderName, isExternal } from "../lib/provider";

const COVER_TONES = [
  "#203142",
  "#5e4b43",
  "#36574f",
  "#6a5331",
  "#4d5367",
  "#70464c",
  "#40556b",
  "#59603f",
];

function pickCoverTone(id) {
  let hash = 0;
  for (const c of id || "") hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return COVER_TONES[Math.abs(hash) % COVER_TONES.length];
}

function formatRelative(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

export default function Home({
  projects,
  onOpenProject,
  onCreateProject,
  onQuickWrite,
  onDeleteProject,
  onOpenSettings,
  theme,
  onCycleTheme,
  ollamaStatus,
  settings,
}) {
  const providerName = getProviderName(settings);
  const external = isExternal(settings);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreateProject(newTitle.trim());
    setNewTitle("");
    setCreatingNew(false);
  };

  const cancelCreate = () => {
    setCreatingNew(false);
    setNewTitle("");
  };

  // Most recent project (by updatedAt)
  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
  const lastProject = sortedProjects[0];
  const otherProjects = sortedProjects.slice(1);
  const showContinue = !!lastProject && !creatingNew;

  const themeIcon = theme === "dark" ? <Sun size={16} /> : theme === "sepia" ? <Palette size={16} /> : <Moon size={16} />;
  const statusKind = ollamaStatus === "online" ? "on" : ollamaStatus === "checking" ? "check" : "off";
  const statusText = ollamaStatus === "online"
    ? `${providerName} — المساعد الذكي جاهز`
    : ollamaStatus === "checking"
    ? "جارٍ التحقق..."
    : `${providerName} — غير متصل`;

  return (
    <div className="home">
      <header className="home__topbar">
        <div className="home__brand">
          <div className="home__brand-mark">أ</div>
          <div className="home__brand-text">
            <div className="home__brand-name">أرغون رايت</div>
            <div className="home__brand-tag">
              <span className={`home__dot home__dot--${statusKind}`} />
              {external && <Cloud size={11} className="home__brand-cloud" />}
              <span>{statusText}</span>
            </div>
          </div>
        </div>

        <div className="home__top-actions">
          <button className="btn-icon" onClick={onCycleTheme} title="تبديل السمة" aria-label="تبديل السمة">{themeIcon}</button>
          <button className="btn-icon" onClick={onOpenSettings} title="الإعدادات" aria-label="الإعدادات"><SettingsIcon size={16} /></button>
        </div>
      </header>

      <main className="home__main">
        <section className="home__hero">
          <span className="home__eyebrow">مكتبتك الخاصة</span>
          <h1 className="home__title">مرحباً، وش بنكتب اليوم؟</h1>
          <p className="home__subtitle">
            اختر مشروعاً تكمل عليه، أو ابدأ واحداً جديداً. كل شيء يُحفظ على جهازك فقط.
          </p>
        </section>

        <section className={`home__bento${showContinue ? "" : " home__bento--compact"}`}>
          {showContinue && (
            <button
              className="home__continue-card"
              onClick={() => onOpenProject(lastProject.id)}
            >
              <div
                className="home__continue-cover"
                style={{ "--cover-tone": pickCoverTone(lastProject.id) }}
              >
                <span>{lastProject.title?.charAt(0) || "؟"}</span>
              </div>
              <div className="home__continue-info">
                <div className="home__continue-label">
                  <Clock size={12} />
                  <span>متابعة آخر عمل</span>
                </div>
                <div className="home__continue-title">{lastProject.title || "بدون عنوان"}</div>
                <div className="home__continue-meta">
                  {(lastProject.docCount ?? 0)} فصل · آخر تعديل {formatRelative(lastProject.updatedAt)}
                </div>
              </div>
              <div className="home__continue-action">
                <span>افتح</span>
                <span className="home__continue-arrow"><ArrowLeft size={15} /></span>
              </div>
            </button>
          )}

          {creatingNew ? (
            <div className="home__new-form">
              <div className="home__new-form-label">
                <BookPlus size={14} />
                <span>مشروع جديد</span>
              </div>
              <input
                className="home__new-input"
                placeholder="اسم المشروع..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") cancelCreate();
                }}
                autoFocus
              />
              <div className="home__new-actions">
                <button className="btn btn-secondary" onClick={cancelCreate}>إلغاء</button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={!newTitle.trim()}>
                  <BookPlus size={14} />
                  إنشاء
                </button>
              </div>
            </div>
          ) : (
            <button className="home__new-card" onClick={() => setCreatingNew(true)}>
              <span className="home__new-icon"><Plus size={18} /></span>
              <span className="home__new-text">
                <span className="home__new-title">مشروع جديد</span>
                <span className="home__new-desc">رواية، كتاب، أو مجموعة فصول</span>
              </span>
            </button>
          )}

          <button className="home__quick-btn" onClick={onQuickWrite}>
            <span className="home__quick-icon"><FileText size={16} /></span>
            <span className="home__quick-text">
              <span className="home__quick-title">كتابة سريعة</span>
              <span className="home__quick-desc">بدون مشروع — للملاحظات والمسودات</span>
            </span>
          </button>
        </section>

        {(otherProjects.length > 0 || projects.length === 0) && (
          <section className="home__section">
            <div className="home__section-head">
              <BookOpen size={14} />
              <span>{lastProject ? "بقية مشاريعك" : "مشاريعك"}</span>
              {projects.length > 0 && <span className="home__count">{projects.length}</span>}
            </div>

            {otherProjects.length > 0 && (
              <div className="home__grid">
                {otherProjects.map((project) => (
                  <div
                    key={project.id}
                    className="home__project-card"
                    onClick={() => onOpenProject(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenProject(project.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div
                      className="home__project-cover"
                      style={{ "--cover-tone": pickCoverTone(project.id) }}
                    >
                      <span>{project.title?.charAt(0) || "؟"}</span>
                    </div>
                    <div className="home__project-info">
                      <div className="home__project-title">{project.title || "بدون عنوان"}</div>
                      <div className="home__project-meta">
                        {(project.docCount ?? 0)} فصل · {formatRelative(project.updatedAt)}
                      </div>
                    </div>
                    <button
                      className="home__project-delete"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(project.id); }}
                      title="حذف"
                      aria-label={`حذف مشروع ${project.title || "بدون عنوان"}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {projects.length === 0 && !creatingNew && (
              <div className="home__empty">
                <div className="home__empty-icon"><BookOpen size={26} /></div>
                <div className="home__empty-title">ما عندك أي مشروع بعد</div>
                <div className="home__empty-hint">اضغط «مشروع جديد» لتبدأ، أو جرّب «كتابة سريعة» بدون مشروع.</div>
              </div>
            )}
          </section>
        )}
      </main>

      {confirmDelete && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal--sm" role="dialog" aria-modal="true" aria-label="تأكيد حذف المشروع">
            <div className="modal__header">
              <h2 className="modal__title">حذف المشروع</h2>
            </div>
            <div className="modal__body">
              <p className="modal__text">
                سيُحذف المشروع وجميع فصوله من القرص الصلب نهائياً.<br />
                لا يمكن التراجع عن هذا الإجراء.
              </p>
            </div>
            <div className="modal__footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>إلغاء</button>
              <button className="btn btn-danger" onClick={() => { onDeleteProject(confirmDelete); setConfirmDelete(null); }}>
                <Trash2 size={14} /> حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
