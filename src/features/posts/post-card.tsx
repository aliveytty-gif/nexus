import Link from "next/link";
import Image from "next/image";
import { MessageCircle, ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { displayName, formatDate } from "@/lib/format";
import type { FeedPost } from "./data";
export function PostCard({
  post,
  detail = false,
}: {
  post: FeedPost;
  detail?: boolean;
}) {
  const author = post.author;
  const name = author ? displayName(author) : "Пользователь";
  return (
    <article className="card post-card">
      <header className="post-header">
        <Avatar name={name} url={author?.avatar_url} />
        <div>
          {author ? (
            <Link href={`/profile/${author.username}`} className="post-author">
              {name}
            </Link>
          ) : (
            <span className="post-author">{name}</span>
          )}
          <div className="post-meta">
            {author?.group_name && (
              <>
                <span>{author.group_name}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <time dateTime={post.created_at}>
              {formatDate(post.created_at)} МСК
            </time>
          </div>
        </div>
      </header>
      <p className="post-body">{post.content}</p>
      {post.image_url && <Image src={post.image_url} alt="Фотография к публикации"
        width={1200} height={800} unoptimized
        style={{ width: "100%", height: "auto", maxHeight: 520, objectFit: "contain", borderRadius: 12 }} />}
      <footer className="post-footer">
        <Link href={`/posts/${post.id}#comments`}>
          <MessageCircle size={18} />
          Комментарии · {post.comments[0]?.count ?? 0}
        </Link>
        {!detail && (
          <Link href={`/posts/${post.id}`} aria-label="Открыть публикацию">
            <ArrowUpRight size={18} />
          </Link>
        )}
      </footer>
    </article>
  );
}
