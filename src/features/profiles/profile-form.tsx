"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateProfileAction } from "@/features/profiles/actions";
import type {
  ProfileActionState,
  ProfileWithInterests,
} from "@/features/profiles/types";
import type { Interest } from "@/types/database";

export function ProfileForm({
  profile,
  interests,
}: {
  profile: ProfileWithInterests;
  interests: Interest[];
}) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(
    updateProfileAction,
    {},
  );
  const [fields, setFields] = useState({
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    avatar_url: profile.avatar_url ?? "",
    bio: profile.bio,
    specialty: profile.specialty,
    course: profile.course?.toString() ?? "",
    group_name: profile.group_name,
  });
  const [selectedInterests, setSelectedInterests] = useState(
    profile.interests.map((interest) => interest.id),
  );
  const update = (field: keyof typeof fields, value: string) =>
    setFields((previous) => ({ ...previous, [field]: value }));
  const errors = state.fieldErrors ?? {};
  const toggleInterest = (id: string) =>
    setSelectedInterests((selected) =>
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );

  return (
    <form
      action={action}
      className="card profile-editor form-stack"
      aria-busy={pending}
    >
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="profile-avatar-row">
        <Avatar
          name={`${fields.first_name} ${fields.last_name}`}
          url={fields.avatar_url}
          size="lg"
        />
        <div>
          <h2>Твой профиль</h2>
          <p className="muted">
            Расскажи немного о себе — знакомиться станет проще.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="first_name">
            Имя
          </label>
          <input
            className="input"
            id="first_name"
            name="first_name"
            autoComplete="given-name"
            required
            maxLength={80}
            value={fields.first_name}
            onChange={(e) => update("first_name", e.target.value)}
            aria-invalid={Boolean(errors.first_name)}
            aria-describedby={
              errors.first_name ? "first-name-error" : undefined
            }
          />
          {errors.first_name && (
            <p className="error-text" id="first-name-error">
              {errors.first_name}
            </p>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="last_name">
            Фамилия
          </label>
          <input
            className="input"
            id="last_name"
            name="last_name"
            autoComplete="family-name"
            required
            maxLength={80}
            value={fields.last_name}
            onChange={(e) => update("last_name", e.target.value)}
            aria-invalid={Boolean(errors.last_name)}
            aria-describedby={errors.last_name ? "last-name-error" : undefined}
          />
          {errors.last_name && (
            <p className="error-text" id="last-name-error">
              {errors.last_name}
            </p>
          )}
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          className="input"
          id="username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={40}
          pattern="[a-z0-9_]{3,40}"
          value={fields.username}
          onChange={(e) => update("username", e.target.value.toLowerCase())}
          aria-invalid={Boolean(errors.username)}
          aria-describedby="username-help username-error"
        />
        <p className="muted" id="username-help">
          3–40 латинских букв, цифр или _. Адрес профиля: /profile/
          {fields.username || "username"}
        </p>
        <p className="error-text" id="username-error">
          {errors.username}
        </p>
      </div>
      <div className="field">
        <label className="label" htmlFor="avatar_url">
          Ссылка на аватар <span className="muted">· необязательно</span>
        </label>
        <input
          className="input"
          id="avatar_url"
          name="avatar_url"
          type="url"
          placeholder="https://example.com/avatar.jpg"
          maxLength={2048}
          value={fields.avatar_url}
          onChange={(e) => update("avatar_url", e.target.value)}
          aria-invalid={Boolean(errors.avatar_url)}
          aria-describedby="avatar-help avatar-error"
        />
        <p className="muted" id="avatar-help">
          Прямая HTTPS-ссылка на изображение. Без неё покажем твои инициалы.
        </p>
        <p className="error-text" id="avatar-error">
          {errors.avatar_url}
        </p>
      </div>
      <div className="field">
        <label className="label" htmlFor="bio">
          О себе
        </label>
        <textarea
          className="input"
          id="bio"
          name="bio"
          rows={4}
          maxLength={300}
          placeholder="Чем увлекаешься? Что хочешь сделать вместе с другими?"
          value={fields.bio}
          onChange={(e) => update("bio", e.target.value)}
          aria-invalid={Boolean(errors.bio)}
          aria-describedby="bio-count bio-error"
        />
        <p className="muted" id="bio-count">
          {fields.bio.length}/300
        </p>
        <p className="error-text" id="bio-error">
          {errors.bio}
        </p>
      </div>
      <div className="field">
        <label className="label" htmlFor="specialty">
          Специальность
        </label>
        <input
          className="input"
          id="specialty"
          name="specialty"
          placeholder="Например, информационные системы"
          maxLength={120}
          value={fields.specialty}
          onChange={(e) => update("specialty", e.target.value)}
          aria-invalid={Boolean(errors.specialty)}
          aria-describedby={errors.specialty ? "specialty-error" : undefined}
        />
        {errors.specialty && (
          <p className="error-text" id="specialty-error">
            {errors.specialty}
          </p>
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="course">
            Курс
          </label>
          <select
            className="input"
            id="course"
            name="course"
            value={fields.course}
            onChange={(e) => update("course", e.target.value)}
            aria-invalid={Boolean(errors.course)}
            aria-describedby={errors.course ? "course-error" : undefined}
          >
            <option value="">Не указан</option>
            {[1, 2, 3, 4, 5, 6].map((course) => (
              <option key={course} value={course}>
                {course} курс
              </option>
            ))}
          </select>
          {errors.course && (
            <p className="error-text" id="course-error">
              {errors.course}
            </p>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="group_name">
            Группа
          </label>
          <input
            className="input"
            id="group_name"
            name="group_name"
            maxLength={40}
            placeholder="Например, ИСП-21"
            value={fields.group_name}
            onChange={(e) => update("group_name", e.target.value)}
            aria-invalid={Boolean(errors.group_name)}
            aria-describedby={errors.group_name ? "group-error" : undefined}
          />
          {errors.group_name && (
            <p className="error-text" id="group-error">
              {errors.group_name}
            </p>
          )}
        </div>
      </div>
      <fieldset
        className="interest-fieldset"
        aria-describedby="interests-help interests-error"
      >
        <legend className="label">Интересы</legend>
        <p className="muted" id="interests-help">
          Выбери до 10 тегов. Сейчас выбрано: {selectedInterests.length}.
        </p>
        <div className="interest-options">
          {interests.map((interest) => {
            const checked = selectedInterests.includes(interest.id);
            return (
              <label
                key={interest.id}
                className={`interest-option${checked ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  name="interests"
                  value={interest.id}
                  checked={checked}
                  disabled={!checked && selectedInterests.length >= 10}
                  onChange={() => toggleInterest(interest.id)}
                />
                <span>#{interest.name}</span>
                {checked && <Check size={14} aria-hidden="true" />}
              </label>
            );
          })}
        </div>
        <p className="error-text" id="interests-error">
          {errors.interests}
        </p>
      </fieldset>
      <div className="profile-form-actions">
        <SubmitButton pendingText="Сохраняем профиль…">
          Сохранить профиль <Check size={17} aria-hidden="true" />
        </SubmitButton>
        <Link
          className="button button-secondary"
          href={`/profile/${profile.username}`}
        >
          Отмена
        </Link>
      </div>
    </form>
  );
}
