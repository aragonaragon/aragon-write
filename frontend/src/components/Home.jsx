import { useState } from "react";
import { BookOpen, BookPlus, FileText, Trash2, Sun, Moon, Palette, Settings as SettingsIcon, Clock } from "lucide-react";

const GRADIENTS = [
  "linear-gradient(135deg,#667eea,#764ba2)",
  "linear-gradient(135deg,#f093fb,#f5576c)",
  "linear-gradient(135deg,#4facfe,#00f2fe)",
  "linear-gradient(135deg,#43e97b,#38f9d7)",
  "linear-gradient(135deg,#fa709a,#fee140)",
  "linear-gradient(135deg,#a18cd1,#fbc2eb)",
  "linear-gradient(135deg,#fccb90,#d57eeb)",
  "linear-gradient(135deg,#84fab0,#8fd3f4)",
];

function pickGradient(id) {
  let hash = 0;
  for (const c of id || "") hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
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
}) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreateProject(newTitle.trim());
    setNewTitle("");
    setCreatingNew(false);
  };

  // Most recent project (by updatedAt)
  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
  const lastProject = sortedProjects[0];
  const otherProjects = sortedProjects.slice(1);

  const themeIcon = theme === "dark" ? <Sun size={16} /> : theme === "sepia" ? <Palette size={16} /> : <Moon size={16} />;

  return (
    <div className="home">
      {/* Top mini-bar */}
      <header className="home__topbar">
        <div className="home__brand">
          <div className="home__brand-mark">أ</div>
          <div>
            <div className="home__brand-name">أرغون رايت</div>
            <div className="home__brand-tag">
              <span className={`home__dot home__dot--${ollamaStatus === "online" ? "on" : ollamaStatus === "checking" ? "check" : "off"}`} />
              {ollamaStatus === "online" ? "المساعد الذكي جاهز" : ollamaStatus === "checking" ? "جارٍ التحقق..." : "بدون مساعد ذكي"}
            </div>
          </div>
        </div>

        <div className="home__top-actions">
          <button className="btn-icon" onClick={onCycleTheme} title="تبديل السمة">{themeIcon}</button>
          <button className="btn-icon" onClick={onOpenSettings} title="الإعدادات"><SettingsIcon size={16} /></button>
        </div>
      </header>

      <main className="home__main">
        <div className="home__intro">
          <h1 className="home__title">مرحباً، وش بنكتب اليوم؟</h1>
          <p className="home__subtitle">اختر مشروعاً تكمل عليه، أو ابدأ واحداً جديداً.</p>
        </div>

        {/* Continue last project */}
        {lastProject && !creatingNew && (
          <section className="home__section">
            <div className="home__section-head">
              <Clock size={14} />
              <span>متابعة</span>
            </div>
            <button
              className="home__continue-card"
              onClick={() => onOpenProject(lastProject.id)}
            >
              <div
                className="home__continue-cover"
                style={{ background: lastProject.gradient || pickGradient(lastProject.id) }}
              >
                <span>{lastProject.title?.charAt(0) || "؟"}</span>
              </div>
              <div className="home__continue-info">
                <div className="home__continue-title">{lastProject.title || "بدون عنوان"}</div>
                <div className="home__continue-meta">
                  {(lastProject.docCount ?? 0)} فصل · آخر تعديل {formatRelative(lastProject.updatedAt)}
                </div>
              </div>
              <div className="home__continue-action">
                <BookOpen size={16} />
                <span>افتح</span>
              </div>
            </button>
          </section>
        )}

        {/* All projects */}
        <section className="home__section">
          <div className="home__section-head">
            <BookOpen size={14} />
            <span>{lastProject ? "بقية مشاريعك" : "مشاريعك"}</span>
            {projects.length > 0 && <span className="home__count">({projects.length})</span>}
          </div>

          <div className="home__grid">
            {/* New project card */}
            {creatingNew ? (
              <div className="home__new-form">
                <input
                  className="home__new-input"
                  placeholder="اسم المشروع..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreatingNew(false); setNewTitle(""); }
                  }}
                  autoFocus
                />
                <div className="home__new-actions">
                  <button className="btn btn-secondary" onClick={() => { setCreatingNew(false); setNewTitle(""); }}>إلغاء</button>
                  <button className="btn btn-primary" onClick={handleCreate} disabled={!newTitle.trim()}>
                    <BookPlus size={14} /> إنشاء
                  </button>
                </div>
              </div>
            ) : (
              <button className="home__new-card" onClick={() => setCreatingNew(true)}>
                <BookPlus size={28} />
                <span>مشروع جديد</span>
              </button>
            )}

            {/* Project cards (excluding the "continue" one which is already shown above) */}
            {otherProjects.map((project) => (
              <div
                key={project.id}
                className="home__project-card"
                onClick={() => onOpenProject(project.id)}
              >
                <div
                  className="home__project-cover"
                  style={{ background: project.gradient || pickGradient(project.id) }}
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
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {projects.length === 0 && !creatingNew && (
            <div className="home__empty">
              <div className="home__empty-icon">📚</div>
              <div>ليس لديك أي مشروع بعد.</div>
              <div className="home__empty-hint">اضغط «مشروع جديد» أعلاه لتبدأ، أو جرّب «كتابة سريعة» بدون مشروع.</div>
            </div>
          )}
        </section>

        {/* Quick write (no project) */}
        <section className="home__section home__quick">
          <button className="home__quick-btn" onClick={onQuickWrite}>
            <FileText size={16} />
            <div>
              <div className="home__quick-title">كتابة سريعة بدون مشروع</div>
              <div className="home__quick-desc">للملاحظات والمسودات — تُحفظ محلياً على جهازك</div>
            </div>
          </button>
        </section>
      </main>

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal--sm">
            <div className="modal__header">
              <h2 className="modal__title">حذف المشروع</h2>
            </div>
            <div className="modal__body">
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.9 }}>
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
