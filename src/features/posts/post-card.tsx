import Link from "next/link";
import Image from "next/image";
import { MessageCircle, ArrowUpRight, Repeat2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { displayName, formatDate } from "@/lib/format";
import { isStorageImage } from "@/lib/storage";
import type { FeedPost } from "./data";
import { LikeButton } from "./like-button";
import { RepostButton } from "./repost-button";
import { MessageAttachment } from "@/features/messages/attachment";

function PostContent({ post }: { post: Pick<FeedPost, "content" | "image_url" | "mediaAttachments"> }) {
  return <>
    {post.content && <p className="post-body">{post.content}</p>}
    {post.image_url && <Image src={post.image_url} alt="Фотография к публикации"
      width={1200} height={800}
      sizes="(max-width: 600px) calc(100vw - 70px), (max-width: 800px) calc(100vw - 270px), (max-width: 1150px) calc(100vw - 340px), 710px"
      unoptimized={!isStorageImage(post.image_url)}
      style={{ width: "100%", height: "auto", maxHeight: 360, objectFit: "contain", borderRadius: 12 }} />}
    {post.mediaAttachments.length > 0 && <div className="post-attachments">
      {post.mediaAttachments.map((attachment) => <MessageAttachment key={attachment.path} {...attachment} />)}
    </div>}
  </>;
}

export function PostCard({
  post,
  detail = false,
}: {
  post: FeedPost;
  detail?: boolean;
}) {
  const author = post.author;
  const name = author ? displayName(author) : "Пользователь";
  const original = post.original;
  const originalName = original?.author ? displayName(original.author) : "Пользователь";
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
            {post.is_repost && <span className="repost-label"><Repeat2 size={14} aria-hidden="true" />Репост</span>}
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
      <PostContent post={post} />
      {post.is_repost && <section className="repost-original" aria-label="Исходная публикация">
        {original ? <>
          <header className="post-header">
            <Avatar name={originalName} url={original.author?.avatar_url} size="sm" />
            <div>
              {original.author ? <Link href={`/profile/${original.author.username}`} className="post-author">{originalName}</Link>
                : <span className="post-author">{originalName}</span>}
              <div className="post-meta">
                {original.community && <Link href={`/communities/${original.community.id}`}>{original.community.name}</Link>}
                <time dateTime={original.created_at}>{formatDate(original.created_at)} МСК</time>
              </div>
            </div>
          </header>
          <PostContent post={original} />
          <Link href={`/posts/${original.id}`} className="repost-source-link">Открыть оригинал <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </> : <p className="muted">Публикация недоступна</p>}
      </section>}
      <footer className="post-footer">
        <LikeButton postId={post.id} liked={post.my_like.length > 0} count={post.likes[0]?.count ?? 0} />
        <RepostButton postId={post.id} count={post.repostCount} existingId={post.myRepostId}
          disabled={post.is_repost && !original} />
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
