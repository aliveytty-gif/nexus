import type { ProfileActionState } from "@/features/profiles/types";

export function validateProfileInput(formData: FormData) {
  const read = (name: string) => String(formData.get(name) ?? "").trim();
  const firstName = read("first_name");
  const lastName = read("last_name");
  const username = read("username").toLowerCase();
  const avatarUrl = read("avatar_url");
  const bio = read("bio");
  const specialty = read("specialty");
  const groupName = read("group_name");
  const rawCourse = read("course");
  const course = rawCourse === "" ? null : Number(rawCourse);
  const interestIds = [...new Set(formData.getAll("interests").map(String))];
  const fieldErrors: NonNullable<ProfileActionState["fieldErrors"]> = {};

  if (!firstName || firstName.length > 80)
    fieldErrors.first_name = "Имя должно содержать от 1 до 80 символов.";
  if (!lastName || lastName.length > 80)
    fieldErrors.last_name = "Фамилия должна содержать от 1 до 80 символов.";
  if (!/^[a-z0-9_]{3,40}$/.test(username) || username === "edit")
    fieldErrors.username =
      "От 3 до 40 латинских букв, цифр или _. Имя edit зарезервировано.";
  if (bio.length > 300)
    fieldErrors.bio = "Описание не должно превышать 300 символов.";
  if (specialty.length > 120)
    fieldErrors.specialty = "Специальность не должна превышать 120 символов.";
  if (groupName.length > 40)
    fieldErrors.group_name = "Название группы не должно превышать 40 символов.";
  if (
    course !== null &&
    (!/^[1-6]$/.test(rawCourse) || !Number.isInteger(course))
  )
    fieldErrors.course = "Выберите курс от 1 до 6.";
  if (avatarUrl) {
    try {
      const url = new URL(avatarUrl);
      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password ||
        /\s/.test(avatarUrl) ||
        avatarUrl.length > 2048
      )
        throw new Error("invalid-url");
    } catch {
      fieldErrors.avatar_url =
        "Укажите полный HTTPS-адрес изображения без пробелов и данных входа.";
    }
  }
  if (
    interestIds.length > 10 ||
    interestIds.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  ) {
    fieldErrors.interests = "Выберите не более 10 интересов из списка.";
  }
  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    values: {
      p_first_name: firstName,
      p_last_name: lastName,
      p_username: username,
      p_avatar_url: avatarUrl || null,
      p_bio: bio,
      p_specialty: specialty,
      p_course: course,
      p_group_name: groupName,
      p_interest_ids: interestIds,
    },
  };
}
