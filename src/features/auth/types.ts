export type AuthActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Partial<
    Record<"email" | "password" | "first_name" | "last_name", string>
  >;
};
