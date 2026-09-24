import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  BookOpen,
  MessagesSquare,
  Users,
  Sparkles,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth/session";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <div className={styles.landing}>
      <header className={styles.header}>
        <Brand />
        <nav className={styles.navigation} aria-label="Аккаунт">
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
      <main id="main">
        <section>
          <div className={styles.artwork}>
            <Image
              src="/nexus-artwork.png"
              alt="NEXUS — твой колледж в одном пространстве"
              fill
              priority
              sizes="(max-width: 1200px) 100vw, 1200px"
              className={styles.artworkImage}
            />
          </div>
          <div className={styles.introduction}>
            <div>
              <span className={styles.eyebrow}>
                <span /> ТВОЁ СООБЩЕСТВО КОЛЛЕДЖА
              </span>
              <h1>
                Большой колледж.
                <br />
                <span>Близкие люди.</span>
              </h1>
            </div>
            <div>
              <p className={styles.heroCopy}>
                За пределами твоей группы — люди с теми же интересами. Знакомься,
                делись идеями и будь частью жизни колледжа.
              </p>
              <div className={styles.actions}>
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
              <p className={styles.footnote}>
                Для студентов и преподавателей. В одном месте.
              </p>
            </div>
          </div>
        </section>
        <section className={styles.community} aria-labelledby="community-title">
          <div className={styles.sectionLabel}>
            <span>01 / ВНУТРИ NEXUS</span>
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div className={styles.communityContent}>
            <div>
              <h2 id="community-title">
                Общее начинается
                <br />с интереса.
              </h2>
              <p>
                Музыка, код или кино — расскажи, что тебе близко, в своём
                профиле.
              </p>
              <div className={styles.tags}>
                {["музыка", "программирование", "дизайн", "спорт", "кино"].map(
                  (tag) => (
                    <span key={tag}>
                      #{tag}
                    </span>
                  ),
                )}
              </div>
            </div>
            <div className={styles.conversation}>
              <MessagesSquare size={28} aria-hidden="true" />
              <h3>Разговор начинается с тебя</h3>
              <p>
                Поделись идеей в ленте. Поддержи обсуждение в комментариях.
              </p>
              <div className={styles.previewFooter}>
                <BookOpen size={16} />
                <span>Разные группы. Один колледж.</span>
              </div>
            </div>
          </div>
        </section>
        <section className={styles.features} aria-label="Возможности платформы">
          <div className={styles.feature}>
            <MessagesSquare size={24} />
            <div>
              <h3>Общая лента</h3>
              <p>Идеи, вопросы и новости от людей рядом.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <Users size={24} />
            <div>
              <h3>Твой профиль</h3>
              <p>Чуть больше о тебе, чем номер группы.</p>
            </div>
          </div>
          <div className={styles.feature}>
            <Sparkles size={24} />
            <div>
              <h3>Точки пересечения</h3>
              <p>Узнавай об интересах друг друга.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>NEXUS · Сообщество колледжа</span>
        <span>Сделано для общения, открыто для идей.</span>
      </footer>
    </div>
  );
}
