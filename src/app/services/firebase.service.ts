import { Injectable } from '@angular/core';
import { getFirestore, doc, getDoc, setDoc, setLogLevel } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  lastError: any = null;
  currentUser: User | null = null;
  currentIdToken: string | null = null;
  private _authReady!: Promise<void>;
  private _resolveAuthReady!: () => void;

  constructor() {
    // Habilitar logs de debug para Firestore
    try {
      setLogLevel('debug');
      // eslint-disable-next-line no-console
      console.debug('[FirebaseService] Firestore log level set to debug');
    } catch (e) {
      // ignore if not available
    }

    // Setup auth ready promise
    this._authReady = new Promise((res) => (this._resolveAuthReady = res));

    const auth = getAuth();

    // Listen auth state
    onAuthStateChanged(auth, (user) => {
      this.currentUser = user;
      if (user) {
        console.debug('[FirebaseService] Auth state: signed in', user.uid);
        // fetch and store id token for debugging / REST tests
        user.getIdToken().then((t) => {
          this.currentIdToken = t;
          console.debug('[FirebaseService] ID token (trimmed):', t ? `${t.substr(0,20)}...${t.substr(-20)}` : null);
        }).catch((err) => {
          console.error('[FirebaseService] Failed to get idToken', err);
        });
      } else {
        console.debug('[FirebaseService] No user, signing in anonymously');
        signInAnonymously(auth).catch((err) => {
          console.error('[FirebaseService] Anonymous sign-in failed', err);
          this.lastError = err;
        });
      }
      // Resolve auth ready on first auth state event
      if (this._resolveAuthReady) this._resolveAuthReady();
    });
  }

  async waitForAuth() {
    return this._authReady;
  }

  async getIdToken(): Promise<string | null> {
    if (this.currentIdToken) return this.currentIdToken;
    if (!this.currentUser) return null;
    try {
      const t = await this.currentUser.getIdToken();
      this.currentIdToken = t;
      return t;
    } catch (e) {
      return null;
    }
  }

  async checkRead(): Promise<{ ok: true } | { ok: false; error: any }> {
    try {
      await this.waitForAuth();
      const db = getFirestore();
      // Intentar leer un documento que probablemente no exista; la llamada fallará si no hay conectividad
      const ref = doc(db, '__health__', 'ping');
      await getDoc(ref);
      return { ok: true };
    } catch (error) {
      this.lastError = error;
      return { ok: false, error };
    }
  }

  async checkWrite(): Promise<{ ok: true } | { ok: false; error: any }> {
    try {
      await this.waitForAuth();
      const db = getFirestore();
      const ref = doc(db, '__health__', `ping-${Date.now()}`);
      await setDoc(ref, { ts: Date.now() });
      return { ok: true };
    } catch (error) {
      this.lastError = error;
      return { ok: false, error };
    }
  }

  getLastError() {
    return this.lastError;
  }
}
