import Link from "next/link";
import { Map, MessagesSquare, Sparkles } from "lucide-react";
const modules = {
  messages: {
    title: "Сообщения",
    icon: MessagesSquare,
    description:
      "Личные разговоры, совместные идеи и общение один на один. Скоро здесь можно будет написать людям твоего колледжа.",
  },
  map: {
    title: "Карта колледжа",
    icon: Map,
    description:
      "Кабинеты, этажи и полезные места. Здесь появится карта, которая поможет найти нужный маршрут.",
  },
  ai: {
    title: "NEXUS AI",
    icon: Sparkles,
    description:
      "Ответы на вопросы о колледже в одном месте. Здесь появится помощник по кабинетам, событиям и студенческой жизни.",
  },
} as const;
export function ComingSoon({ module }: { module: keyof typeof modules }) {
  const { title, icon: Icon, description } = modules[module];
  return (
    <section className="card empty-state module-placeholder">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <p className="eyebrow">Дальше — больше</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="notice">Раздел находится в разработке</div>
      <Link href="/feed" className="button button-secondary">
        Вернуться в ленту
      </Link>
    </section>
  );
}
