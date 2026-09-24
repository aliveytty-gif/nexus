import Link from "next/link";
import Image from "next/image";
import { MessageCircle, ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { displayName, formatDate } from "@/lib/format";
import { isStorageImage } from "@/lib/storage";
import type { FeedPost } from "./data";
import { LikeButton } from "./like-button";
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
            {post.community && <Link href={`/communities/${post.community.id}`}>{post.community.name}</Link>}
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
        width={1200} height={800}
        sizes="(max-width: 600px) calc(100vw - 70px), (max-width: 800px) calc(100vw - 270px), (max-width: 1150px) calc(100vw - 340px), 710px"
        unoptimized={!isStorageImage(post.image_url)}
        style={{ width: "100%", height: "auto", maxHeight: 520, objectFit: "contain", borderRadius: 12 }} />}
      <footer className="post-footer">
        <LikeButton postId={post.id} liked={post.my_like.length > 0} count={post.likes[0]?.count ?? 0} />
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
