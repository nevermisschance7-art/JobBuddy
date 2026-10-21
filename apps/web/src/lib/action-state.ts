export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Changes on every successful save so client forms can react. */
  savedAt?: number;
};

export const initialState: ActionState = { ok: false };

export const saved = (message = "Saved."): ActionState => ({
  ok: true,
  message,
  savedAt: Date.now(),
});

export const failed = (error: string): ActionState => ({ ok: false, error });
