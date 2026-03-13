export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  email: string;
  role: string;
  sub: string;
  exp?: number;
}

export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Échec de la connexion' }));
    throw new Error(errorData.error || 'Échec de la connexion');
  }

  return response.json();
}

export function decodeToken(token: string): User | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const user = decodeToken(token);
  if (!user || !user.exp) return true;
  return Date.now() >= user.exp * 1000;
}

export function storeTokens(auth: AuthResponse): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('accessToken', auth.accessToken);
    localStorage.setItem('refreshToken', auth.refreshToken);
    document.cookie = `accessToken=${auth.accessToken}; path=/; max-age=86400; samesite=lax`;
    document.cookie = `refreshToken=${auth.refreshToken}; path=/; max-age=2592000; samesite=lax`;
  }
}

export function getAccessToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('accessToken');
  }
  return null;
}

export function getCurrentUser(): User | null {
  const token = getAccessToken();
  if (!token) return null;
  if (isTokenExpired(token)) {
    logout();
    return null;
  }
  return decodeToken(token);
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    document.cookie = 'accessToken=; path=/; max-age=0';
    document.cookie = 'refreshToken=; path=/; max-age=0';
    window.location.href = '/login';
  }
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (!token) return false;
  return !isTokenExpired(token);
}
