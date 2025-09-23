import { Injectable } from '@angular/core';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { UserCredential } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'idToken';

  constructor() {}

  /**
   * Login con email/password. Guarda idToken en localStorage.
   * Devuelve { ok, message } para manejo sencillo en UI.
   */
  async login(email: string, password: string): Promise<{ ok: boolean; message: string }> {
    try {
      const auth = getAuth();
      const cred: UserCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await cred.user.getIdToken();
      localStorage.setItem(this.tokenKey, token);
      return { ok: true, message: 'Inicio de sesión correcto' };
    } catch (err: any) {
      return { ok: false, message: this.mapError(err) };
    }
  }

  /**
   * Devuelve el token almacenado (o null si no hay).
   */
  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  /**
   * Cierra sesión y borra token local.
   */
  async logout(): Promise<void> {
    try {
      const auth = getAuth();
      await signOut(auth);
    } catch {
      // ignorar errores de signOut, de todas formas limpiamos token
    } finally {
      localStorage.removeItem(this.tokenKey);
    }
  }

  private mapError(err: any): string {
    const code = err?.code || err?.message || String(err);
    if (typeof code !== 'string') return 'Error desconocido';
    switch (code) {
      case 'auth/invalid-email':
      case 'auth/user-not-found':
        return 'Email inválido o usuario no encontrado.';
      case 'auth/wrong-password':
        return 'Contraseña incorrecta.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos. Intenta más tarde.';
      case 'auth/network-request-failed':
        return 'Error de red. Revisa tu conexión.';
      default:
        // devolver el código para diagnóstico si no está mapeado
        return code;
    }
  }
}
