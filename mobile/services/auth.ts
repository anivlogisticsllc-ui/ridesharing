const TOKEN_STORAGE_KEY = "hdriven_mobile_token";
const USER_STORAGE_KEY = "hdriven_mobile_user";

export type MobileUser = {
  id: string;
  email: string;
  role: "RIDER" | "DRIVER" | "ADMIN" | string;
  name: string | null;
};

export type LoginResult = {
  token: string;
  user: MobileUser;
};

export async function saveAuth(result: LoginResult) {
  localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
}

export async function getAuthToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export async function clearAuth() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}