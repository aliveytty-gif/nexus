import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { displayName, formatDate, pageNumber } from "@/lib/format";
import { getPost } from "@/features/posts/data";
import { getComments, COMMENTS_PER_PAGE } from "@/features/comments/data";
import { PostCard } from "@/features/posts/post-card";
import { Avatar } from "@/components/ui/avatar";
import { Pagination } from "@/components/ui/pagination";
import { Notice } from "@/components/ui/notice";
import {
  CommentForm,
  DeleteCommentButton,
} from "@/features/comments/comment-form";
export const metadata = { title: "Публикация" };
export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; commented?: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/posts/${id}`);
  const query = await searchParams;
  const post = await getPost(id);
  if (!post) notFound();
  const page = pageNumber(query.page);
  const { comments, count } = await getComments(id, page);
  return (
    <div className="narrow-content">
      <Link
        href="/feed"
        className="row text-link small"
        style={{ marginBottom: 23 }}
      >
        <ArrowLeft size={16} />
        Назад в ленту
      </Link>
      <h1 className="sr-only">Публикация</h1>
      <PostCard post={post} detail />
      <section id="comments">
        <div className="page-heading comments-title">
          <h2>Комментарии · {count}</h2>
          <span className="muted small">Сначала новые</span>
        </div>
        <div className="card stack">
          {Boolean(query.commented) && (
            <Notice tone="success">Комментарий отправлен.</Notice>
          )}
          <CommentForm key={query.commented ?? "initial"} postId={id} />
          <div>
            {comments.length ? (
              comments.map((comment) => (
                <article className="comment" key={comment.id}>
                  <Avatar
                    name={
                      comment.author
                        ? displayName(comment.author)
                        : "Пользователь"
                    }
                    url={comment.author?.avatar_url}
                    size="sm"
                  />
                  <div className="comment-content">
                    {comment.author && (
                      <Link
                        href={`/profile/${comment.author.username}`}
                        className="post-author"
                      >
                        {displayName(comment.author)}
                      </Link>
                    )}
                    <div className="post-meta">
                      <time dateTime={comment.created_at}>
                        {formatDate(comment.created_at)} МСК
                      </time>
                    </div>
                    <p className="comment-body">{comment.content}</p>
                    {comment.author_id === user.id && (
                      <DeleteCommentButton postId={id} commentId={comment.id} />
                    )}
                  </div>
                </article>
              ))
            ) : (
              <p className="muted small" style={{ paddingTop: 15 }}>
                Комментариев пока нет. Начни обсуждение.
              </p>
            )}
          </div>
        </div>
        <Pagination
          page={page}
          total={count}
          perPage={COMMENTS_PER_PAGE}
          href={`/posts/${id}`}
        />
      </section>
    </div>
  );
}
