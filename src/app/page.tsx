import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  MessagesSquare,
  Users,
  Sparkles,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
        <nav className="landing-nav" aria-label="Аккаунт">
          {user ? (
            <Link className="button button-primary" href="/feed">
              Открыть ленту <ArrowUpRight size={16} />
            </Link>
          ) : (
            <>
              <Link className="button button-quiet" href="/login">
                Войти
              </Link>
              <Link className="button button-primary" href="/register">
                Регистрация
              </Link>
            </>
          )}
        </nav>
      </header>
      <main id="main" className="landing-main">
        <section className="hero">
          <div>
            <span className="hero-eyebrow">ТВОЁ СООБЩЕСТВО КОЛЛЕДЖА</span>
            <h1>
              Большой колледж.
              <br />
              <span>Близкие люди.</span>
            </h1>
            <p className="hero-copy">
              За пределами твоей группы — люди с теми же интересами. Знакомься,
              делись идеями и будь частью жизни колледжа.
            </p>
            <div className="hero-actions">
              <Link
                href={user ? "/feed" : "/register"}
                className="button button-primary"
              >
                {user ? "Перейти в ленту" : "Присоединиться"}
                <ArrowUpRight size={18} />
              </Link>
              {!user && (
                <Link href="/login" className="button button-secondary">
                  У меня есть аккаунт
                </Link>
              )}
            </div>
            <p className="hero-footnote">
              Для студентов и преподавателей. В одном месте.
            </p>
          </div>
          <div className="community-preview">
            <div className="preview-top">
              <span className="eyebrow">Внутри NEXUS</span>
              <span>Место для своих</span>
            </div>
            <div className="preview-note">
              <div className="preview-icon">
                <Users size={24} />
              </div>
              <h2>
                Общее начинается
                <br />с интереса.
              </h2>
              <p>
                Музыка, код или кино — расскажи, что тебе близко, в своём
                профиле.
              </p>
              <div className="tags">
                {["музыка", "программирование", "дизайн", "спорт", "кино"].map(
                  (tag) => (
                    <span key={tag} className="tag">
                      #{tag}
                    </span>
                  ),
                )}
              </div>
            </div>
            <div className="preview-note">
              <div className="row">
                <MessagesSquare size={20} color="#2456e8" />
                <h3>Разговор начинается с тебя</h3>
              </div>
              <p style={{ marginTop: 10 }}>
                Поделись идеей в ленте. Поддержи обсуждение в комментариях.
              </p>
            </div>
            <div className="preview-footer">
              <BookOpen size={16} />
              <span>Разные группы. Один колледж.</span>
            </div>
          </div>
        </section>
        <section className="feature-strip" aria-label="Возможности платформы">
          <div className="feature-item">
            <MessagesSquare size={24} />
            <div>
              <h3>Общая лента</h3>
              <p>Идеи, вопросы и новости от людей рядом.</p>
            </div>
          </div>
          <div className="feature-item">
            <Users size={24} />
            <div>
              <h3>Твой профиль</h3>
              <p>Чуть больше о тебе, чем номер группы.</p>
            </div>
          </div>
          <div className="feature-item">
            <Sparkles size={24} />
            <div>
              <h3>Точки пересечения</h3>
              <p>Узнавай об интересах друг друга.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <span>NEXUS · Сообщество колледжа</span>
        <span>Сделано для общения, открыто для идей.</span>
      </footer>
    </div>
  );
}
