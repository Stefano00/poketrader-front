import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { getFirestore, collection, getDocs, DocumentData, Timestamp, addDoc, setDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';

@Component({
  standalone: true,
  selector: 'app-create-person',
  templateUrl: './create-person.html',
  imports: [CommonModule, FormsModule]
})
export class CreatePerson implements OnInit {
  persons: any[] = [];
  loadingPersons = false;
  lastError: any = null;
  saving = false;
  message: string | null = null;
  private modalInstance: any = null;
  private deleteModalInstance: any = null;
  editingId: string | null = null;
  formModel: any = {
    primaryKey: '',
    playerId: '',
    va_name: '',
    va_email: '',
    va_nickname: '',
    fe_birth_date: ''
  };
  searchTerm: string = '';

  get filteredPersons() {
    if (!this.searchTerm) return this.persons;
    const lower = this.searchTerm.toLowerCase();
    return this.persons.filter(p => (p.name || '').toLowerCase().includes(lower));
  }

  ngOnInit(): void {
    this.loadPersons();
  }

  openModal(person?: any) {
    const el = document.getElementById('addPersonModal');
    if (!el) return;
    const win = window as any;
    try {
      // remove any leftover backdrops
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
      this.modalInstance = win.bootstrap?.Modal?.getInstance(el) || new win.bootstrap.Modal(el, { backdrop: false });
      // if person provided, we are editing — preload model
      if (person) {
        this.editingId = person.id;
        this.formModel = {
          primaryKey: person.id,
          playerId: person.raw?.playerId || '',
          va_name: person.name || '',
          va_email: person.email || '',
          va_nickname: person.nickname || '',
          fe_birth_date: person.raw?.fe_birth_date ? (person.birthDate ? new Date(person.birthDate).toISOString().slice(0, 10) : '') : ''
        };
      } else {
        this.editingId = null;
        this.formModel = { primaryKey: '', playerId: '', va_name: '', va_email: '', va_nickname: '', fe_birth_date: '' };
      }
      this.modalInstance.show();
    } catch (e) {
      console.error('Error opening modal', e);
    }
  }

  closeModal() {
    try {
      if (!this.modalInstance) {
        const el = document.getElementById('addPersonModal');
        const win = window as any;
        this.modalInstance = win.bootstrap?.Modal?.getInstance(el) || null;
      }
      this.modalInstance?.hide();
    } catch (e) {
      // ignore
    }
    setTimeout(() => {
      try {
        document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
        document.body.classList.remove('modal-open');
        document.body.style.paddingRight = '';
        const el = document.getElementById('addPersonModal');
        if (el) {
          el.classList.remove('show');
          (el as HTMLElement).style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
        }
      } catch (err) {
        // ignore
      }
    }, 100);
  }

  openDeleteModal(personId: string, personName?: string) {
    const el = document.getElementById('deletePersonModal');
    if (!el) return;
    const win = window as any;
    try {
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
      this.deleteModalInstance = win.bootstrap?.Modal?.getInstance(el) || new win.bootstrap.Modal(el, { backdrop: false });
      this.deleteModalInstance.show();
      // store current id in editingId for deletion
      this.editingId = personId;
      this.message = `Eliminar: ${personName || personId}`;
    } catch (e) {
      console.error('Error opening delete modal', e);
    }
  }

  closeDeleteModal() {
    try {
      this.deleteModalInstance?.hide();
    } catch { }
    setTimeout(() => {
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
    }, 100);
  }

  async deletePersonConfirmed() {
    if (!this.editingId) return;
    try {
      const db = getFirestore();
      await deleteDoc(doc(db, 'person_identity', this.editingId));
      this.closeDeleteModal();
      this.message = `Persona eliminada: ${this.editingId}`;
      this.editingId = null;
      await this.loadPersons();
    } catch (err) {
      console.error('Error deleting person:', err);
      this.lastError = err;
    }
  }

  private parseBirth(value: any): string | null {
    if (!value) return null;
    // Firestore Timestamp -> toDate()
    if ((value as Timestamp).toDate) {
      return (value as Timestamp).toDate().toLocaleDateString();
    }
    return String(value);
  }

  async loadPersons(): Promise<void> {
    this.loadingPersons = true;
    this.persons = [];
    this.lastError = null;
    try {
      const db = getFirestore();
      const snap = await getDocs(collection(db, 'person_identity'));
      this.persons = snap.docs.map(d => {
        const data = d.data() as DocumentData;
        const get = (k: string) => (data as any)[k];
        return {
          id: d.id,
          name: get('va_name') || get('name') || null,
          email: get('va_email') || get('email') || null,
          nickname: get('va_nickname') || get('nickname') || null,
          birthDate: this.parseBirth(get('fe_birth_date') || get('birthDate') || get('birth_date')),
          raw: data
        };
      });
    } catch (err) {
      console.error('Error loading person_identity:', err);
      this.lastError = err;
    } finally {
      this.loadingPersons = false;
    }
  }

  private toTimestampFromDateString(value?: string): any {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    // Use Firestore Timestamp
    return Timestamp.fromDate(d);
  }

  async savePerson(form: NgForm) {
    if (!form || form.invalid) return;

    // use formModel values which may be preloaded for edit
    const { primaryKey, playerId, va_name, va_email, va_nickname, fe_birth_date } = this.formModel as any;

    const db = getFirestore();

    const docData: any = {
      va_name: va_name || null,
      va_email: va_email || null,
      va_nickname: va_nickname || null,
      fe_birth_date: this.toTimestampFromDateString(fe_birth_date) || serverTimestamp(),
      createdAt: serverTimestamp()
    };

    if (playerId) docData.playerId = playerId;

    try {
      this.saving = true;
      this.message = null;
      let refId: string;
      // if editingId exists, update that document
      if (this.editingId) {
        // merge update
        await setDoc(doc(db, 'person_identity', this.editingId), docData, { merge: true });
        refId = this.editingId;
        // if playerId empty, set to id
        if (!playerId) {
          await setDoc(doc(db, 'person_identity', refId), { playerId: refId }, { merge: true });
        }
      } else if (primaryKey) {
        if (!playerId) docData.playerId = primaryKey;
        await setDoc(doc(db, 'person_identity', primaryKey), docData);
        refId = primaryKey;
      } else {
        const ref = await addDoc(collection(db, 'person_identity'), docData);
        refId = ref.id;
        if (!playerId) {
          await setDoc(doc(db, 'person_identity', refId), { playerId: refId }, { merge: true });
        }
      }
      this.message = `Persona guardada: ${refId}`;
      // reset formModel and editing state
      this.editingId = null;
      this.formModel = { primaryKey: '', playerId: '', va_name: '', va_email: '', va_nickname: '', fe_birth_date: '' };
      // hide modal after successful save
      this.closeModal();
      // reload list
      await this.loadPersons();
    } catch (err) {
      console.error('Error saving person_identity:', err);
      this.lastError = err;
      this.message = 'Error guardando persona. Revisa consola.';
    } finally {
      this.saving = false;
    }
  }
}