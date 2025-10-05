import { Component, OnInit } from '@angular/core';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getFirestore, collection, getDocs, DocumentData, Timestamp, addDoc, setDoc, doc, serverTimestamp, deleteDoc, query, where, getDoc } from 'firebase/firestore';

@Component({
  selector: 'app-tournament',
  standalone: true,
  imports: [CommonModule, FormsModule, JsonPipe],
  templateUrl: './tournament.html',
  styleUrl: './tournament.scss'
})
export class Tournament implements OnInit {
  tournaments: any[] = [];
  loading = false;
  lastError: any = null;

  // form state for create/edit
  editingId: string | null = null;
  saving = false;
  message: string | null = null;
  formModel: any = { primaryKey: '', va_name: '', fe_tournament_date: '', nm_tournament_detail: 1 };

  // participants management
  persons: any[] = [];
  selectedParticipants = new Set<string>();
  currentTournamentId: string | null = null;
  existingParticipantDocs: Record<string, string> = {}; // personId -> docId

  private modalInstance: any = null;
  private participantsModalInstance: any = null;
  private deleteModalInstance: any = null;
  // reference to the tournament currently being edited in the modal
  modalTournament: any = null;

  private personCache: Map<string, any> = new Map();

  ngOnInit(): void {
    this.loadTournaments();
  }

  private parseDate(value: any): string | null {
    if (!value) return null;
    try {
      const d: Date = (value && (value as Timestamp).toDate) ? (value as Timestamp).toDate() : new Date(value);
      // Format in Chile timezone (America/Santiago)
      const datePart = d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' });
      const timePart = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });
      return `${datePart}, ${timePart}`;
    } catch (err) {
      return String(value);
    }
  }

  async loadTournaments() {
    this.loading = true;
    this.tournaments = [];
    this.lastError = null;
    try {
      const db = getFirestore();
      const snap = await getDocs(collection(db, 'tournament'));
      this.tournaments = snap.docs.map(d => {
        const data = d.data() as DocumentData;
        // compute numeric sort key (milliseconds since epoch) from fe_tournament_date or createdAt
        let sortDate = 0;
        try {
          const val = data['fe_tournament_date'] || data['createdAt'] || null;
          if (val) {
            // If it's a Firestore Timestamp-like object
            if (val && typeof val === 'object' && typeof (val as any).toDate === 'function') {
              sortDate = (val as any).toDate().getTime();
            } else {
              const parsed = new Date(String(val));
              if (!isNaN(parsed.getTime())) sortDate = parsed.getTime();
            }
          }
        } catch (e) {
          sortDate = 0;
        }
        return {
          id: d.id,
          name: data['va_name'] || null,
          date: this.parseDate(data['fe_tournament_date']),
          detail: data['nm_tournament_detail'],
          finished: !!data['bo_is_finished'],
          raw: data,
          participants: [] as any[],
          sortDate
        };
      });

      // sort newest first (most recent date on top)
      this.tournaments.sort((a:any,b:any) => Number(b.sortDate || 0) - Number(a.sortDate || 0));

      // load participants for each tournament (populate participants array)
      await Promise.all(this.tournaments.map(async (t) => {
        try {
          const partSnap = await getDocs(query(collection(getFirestore(), 'tournament_participants'), where('tournamentId', '==', t.id)));
          const parts: any[] = [];
          for (const d of partSnap.docs) {
            const pdata = d.data() as any;
            if (pdata.personId) {
              // fetch person name
              try {
                const personDoc = await getDoc(doc(getFirestore(), 'person_identity', pdata.personId));
                const pData = personDoc.exists() ? (personDoc.data() as any) : null;
                parts.push({ personId: pdata.personId, name: pData ? (pData['va_name'] || pData['name'] || '') : pdata.personId });
              } catch (err) {
                parts.push({ personId: pdata.personId, name: pdata.personId });
              }
            }
          }
          t.participants = parts;

          // load tournament_detail (matches) using centralized loader which normalizes
          try {
            await this.loadTournamentDetailsForTournament(t);

            // compute winners/losers summary from the normalized matches
            const winnersMap: Record<string,string> = {};
            const losersMap: Record<string,string> = {};
            const matchesList = (t.matches && Array.isArray(t.matches)) ? t.matches : [];
            for (const m of matchesList) {
              if (m.tie) continue;
              if (m.winner) winnersMap[String(m.winner)] = m.winnerName || m.name1 || String(m.winner);
              if (m.loser) losersMap[String(m.loser)] = m.loserName || m.name2 || String(m.loser);
            }
            t.winners = Object.keys(winnersMap).map(id => ({ id, name: winnersMap[id] }));
            t.losers = Object.keys(losersMap).map(id => ({ id, name: losersMap[id] }));
          } catch (err) {
            console.error('Error loading tournament_detail for tournament', t.detail, err);
            t.matches = [];
            t.winners = [];
            t.losers = [];
          }

        } catch (err) {
          console.error('Error loading participants for tournament', t.id, err);
        }
      }));

    } catch (err) {
      console.error('Error loading tournaments:', err);
      this.lastError = err;
    } finally {
      this.loading = false;
    }
  }

  private async getNextTournamentDetail(): Promise<number> {
    // compute max nm_tournament_detail + 1
    try {
      let max = 0;
      for (const t of this.tournaments) {
        const v = Number(t.raw && t.raw['nm_tournament_detail']);
        if (!isNaN(v) && v > max) max = v;
      }
      return max + 1;
    } catch (err) {
      return 1;
    }
  }

  async openModal(t?: any) {
    const el = document.getElementById('addTournamentModal');
    if (!el) return;
    const win = window as any;
    try {
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
      this.modalInstance = win.bootstrap?.Modal?.getInstance(el) || new win.bootstrap.Modal(el, { backdrop: false });
      if (t) {
        this.modalTournament = t;
        this.editingId = t.id;
        this.formModel = {
          primaryKey: t.id,
          va_name: (t.raw && t.raw['va_name']) || t.name || '',
          fe_tournament_date: (t.raw && t.raw['fe_tournament_date']) ? (((t.raw['fe_tournament_date'] as any).toDate) ? (t.raw['fe_tournament_date'] as any).toDate().toISOString().slice(0,10) : '') : '',
          nm_tournament_detail: (t.raw && t.raw['nm_tournament_detail']) || 1,
          table_count: (t.raw && (t.raw['table_count'] ?? t.table_count)) || t.table_count || 0
        };
      } else {
        this.editingId = null;
        // compute next detail id for new tournaments
        const nextDetail = await this.getNextTournamentDetail();
        this.modalTournament = null;
        this.formModel = { primaryKey: '', va_name: '', fe_tournament_date: '', nm_tournament_detail: nextDetail, table_count: 0 };
      }
      // load persons so the modal can display immediate participant selection
      await this.loadPersonsForSelection();
      // initialize selectedParticipants set from existing tournament (when editing)
      this.selectedParticipants = new Set<string>();
      if (this.modalTournament && this.modalTournament.participants && this.modalTournament.participants.length > 0) {
        for (const p of this.modalTournament.participants) {
          if (p && p.personId) this.selectedParticipants.add(p.personId);
        }
      }
      this.modalInstance.show();
    } catch (e) {
      console.error('Error opening tournament modal', e);
    }
  }

  closeModal() {
    try {
      this.modalInstance?.hide();
    } catch {}
    setTimeout(() => {
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
      this.modalTournament = null;
    }, 100);
  }

  async saveTournament(form: any) {
    if (!form || form.invalid) return;
    const { primaryKey, va_name, fe_tournament_date } = this.formModel as any;
    let { nm_tournament_detail } = this.formModel as any;
    const table_count = (this.formModel && (this.formModel.table_count !== undefined)) ? Number(this.formModel.table_count) : undefined;
    const db = getFirestore();
    // if nm_tournament_detail is not provided or falsy, compute next
    if (!nm_tournament_detail) {
      nm_tournament_detail = await this.getNextTournamentDetail();
    }
    const docData: any = {
      va_name: va_name || null,
      nm_tournament_detail: nm_tournament_detail ? Number(nm_tournament_detail) : 1,
      fe_tournament_date: this.toTimestampFromDateString(fe_tournament_date) || serverTimestamp(),
      // include table_count when provided
      ...(table_count !== undefined ? { table_count: Number(table_count) } : {}),
      createdAt: serverTimestamp()
    };
    try {
      this.saving = true;
      this.message = null;
      let refId: string;
      if (this.editingId) {
        await setDoc(doc(db, 'tournament', this.editingId), docData, { merge: true });
        refId = this.editingId;
      } else if (primaryKey) {
        await setDoc(doc(db, 'tournament', primaryKey), docData);
        refId = primaryKey;
      } else {
        const ref = await addDoc(collection(db, 'tournament'), docData);
        refId = ref.id;
      }
      // persist participant selections immediately after tournament saved
      try {
        this.currentTournamentId = refId;
        if (this.selectedParticipants && this.selectedParticipants.size > 0) {
          await this.saveParticipants();
        }
      } catch (e) {
        console.warn('Error saving selected participants after tournament save', e);
      }
      this.message = `Torneo guardado: ${refId}`;
      this.editingId = null;
      this.formModel = { primaryKey: '', va_name: '', fe_tournament_date: '', nm_tournament_detail: 1 };
      this.closeModal();
      await this.loadTournaments();
    } catch (err) {
      console.error('Error saving tournament:', err);
      this.lastError = err;
    } finally {
      this.saving = false;
    }
  }

  private toTimestampFromDateString(value?: string): any {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return Timestamp.fromDate(d);
  }

  async openDeleteModal(id: string, name?: string) {
    const el = document.getElementById('deleteTournamentModal');
    if (!el) return;
    const win = window as any;
    try {
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
      this.deleteModalInstance = win.bootstrap?.Modal?.getInstance(el) || new win.bootstrap.Modal(el, { backdrop: false });
      this.deleteModalInstance.show();
      this.editingId = id;
      this.message = `Eliminar torneo: ${name || id}`;
    } catch (e) {
      console.error('Error opening delete modal', e);
    }
  }

  closeDeleteModal() {
    try { this.deleteModalInstance?.hide(); } catch {}
    setTimeout(() => { document.querySelectorAll('.modal-backdrop').forEach(n => n.remove()); document.body.classList.remove('modal-open'); }, 100);
  }

  async deleteTournamentConfirmed() {
    if (!this.editingId) return;
    try {
      const db = getFirestore();
      await deleteDoc(doc(db, 'tournament', this.editingId));
      // also remove participants entries for this tournament
      const partSnap = await getDocs(query(collection(getFirestore(), 'tournament_participants'), where('tournamentId', '==', this.editingId)));
      for (const d of partSnap.docs) {
        await deleteDoc(doc(getFirestore(), 'tournament_participants', d.id));
      }
      this.closeDeleteModal();
      this.message = `Torneo eliminado: ${this.editingId}`;
      this.editingId = null;
      await this.loadTournaments();
    } catch (err) {
      console.error('Error deleting tournament:', err);
      this.lastError = err;
    }
  }

  // --- Participants management ---
  async openManageParticipants(tournament: any) {
    // load persons and existing participants
    try {
      this.currentTournamentId = tournament.id;
      await this.loadPersonsForSelection();
      // load existing mappings
      this.existingParticipantDocs = {};
      this.selectedParticipants = new Set<string>();
      const db = getFirestore();
      const snap = await getDocs(query(collection(db, 'tournament_participants'), where('tournamentId', '==', tournament.id)));
      snap.docs.forEach(d => {
        const pdata = d.data() as any;
        if (pdata.personId) {
          this.existingParticipantDocs[pdata.personId] = d.id;
          this.selectedParticipants.add(pdata.personId);
        }
      });
      // show modal
      const el = document.getElementById('manageParticipantsModal');
      if (!el) return;
      const win = window as any;
      document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
      document.body.classList.remove('modal-open');
      this.participantsModalInstance = win.bootstrap?.Modal?.getInstance(el) || new win.bootstrap.Modal(el, { backdrop: false });
      this.participantsModalInstance.show();
    } catch (err) {
      console.error('Error opening participants modal:', err);
      this.lastError = err;
    }
  }

  closeManageParticipants() {
    try { this.participantsModalInstance?.hide(); } catch {}
    setTimeout(() => { document.querySelectorAll('.modal-backdrop').forEach(n => n.remove()); document.body.classList.remove('modal-open'); }, 100);
  }

  togglePersonSelection(personId: string, checked: boolean) {
    if (checked) this.selectedParticipants.add(personId); else this.selectedParticipants.delete(personId);
    console.log("Actualizando participantes {}", this.selectedParticipants);
    
        try {
          const newCount = Math.ceil(this.selectedParticipants.size / 2);
          if (this.formModel) this.formModel.table_count = newCount;
          // also update modalTournament's participants array for immediate UI reflection
          this.modalTournament.participants = Array.from(this.selectedParticipants).map(pid => ({ personId: pid }));
        } catch (e) {}
      
  }

  async saveParticipants() {
    if (!this.currentTournamentId) return;
    try {
      const db = getFirestore();
      // fetch current participant docs again to ensure sync
      const snap = await getDocs(query(collection(db, 'tournament_participants'), where('tournamentId', '==', this.currentTournamentId)));
      const existingMap: Record<string, string> = {};
      for (const d of snap.docs) {
        const pdata = d.data() as any;
        if (pdata.personId) existingMap[pdata.personId] = d.id;
      }

      // add new associations
      for (const pid of Array.from(this.selectedParticipants)) {
        if (!existingMap[pid]) {
          await addDoc(collection(db, 'tournament_participants'), { tournamentId: this.currentTournamentId, personId: pid, createdAt: serverTimestamp() });
        }
      }
      // remove deselected
      for (const pid of Object.keys(existingMap)) {
        if (!this.selectedParticipants.has(pid)) {
          await deleteDoc(doc(db, 'tournament_participants', existingMap[pid]));
        }
      }

      this.message = 'Participantes actualizados';
      // if the participants modal was opened while editing a tournament, update modal form table_count
      if (this.modalTournament && this.modalTournament.id === this.currentTournamentId) {
        try {
          const newCount = Math.ceil(this.selectedParticipants.size / 2);
          if (this.formModel) this.formModel.table_count = newCount;
          // also update modalTournament's participants array for immediate UI reflection
          this.modalTournament.participants = Array.from(this.selectedParticipants).map(pid => ({ personId: pid }));
        } catch (e) {}
      }
      this.closeManageParticipants();
    } catch (err) {
      console.error('Error saving participants:', err);
      this.lastError = err;
    }
  }

  private async loadPersonsForSelection() {
    this.persons = [];
    try {
      const db = getFirestore();
      const snap = await getDocs(collection(db, 'person_identity'));
      this.persons = snap.docs.map(d => {
        const data = d.data() as DocumentData;
        return { id: d.id, name: data['va_name'] || data['name'] || '', raw: data };
      });
    } catch (err) {
      console.error('Error loading persons for selection:', err);
      this.lastError = err;
    }
  }

  async toggleParticipants(t: any) {
    t._showParticipants = !t._showParticipants;
    if (t._showParticipants) {
      // ensure participants/matches are loaded
      if ((!t.participants || t.participants.length === 0)) {
        try {
          const snap = await getDocs(query(collection(getFirestore(), 'tournament_participants'), where('tournamentId', '==', t.id)));
          const parts: any[] = [];
          for (const d of snap.docs) {
            const pdata = d.data() as any;
            if (pdata.personId) {
              try {
                const personDoc = await getDoc(doc(getFirestore(), 'person_identity', pdata.personId));
                const pData = personDoc.exists() ? (personDoc.data() as any) : null;
                parts.push({ personId: pdata.personId, name: pData ? (pData['va_name'] || pData['name'] || '') : pdata.personId });
              } catch (err) {
                parts.push({ personId: pdata.personId, name: pdata.personId });
              }
            }
          }
          t.participants = parts;
        } catch (err) {
          console.error('Error loading participants on toggle (participants):', err);
        }
      }
      if ((!t.matches || t.matches.length === 0)) {
        try {
          await this.loadTournamentDetailsForTournament(t);
        } catch (err) {
          console.error('Error loading matches on toggle:', err);
        }
      }
    }
  }

  private async loadTournamentDetailsForTournament(t: any) {
    try {
      const db = getFirestore();
      const docs: any[] = [];

      // try current-style id (t.id)
      try {
        const snap1 = await getDocs(query(collection(db, 'tournament_detail'), where('nm_tournament_id', '==', t.id)));
        docs.push(...snap1.docs);
      } catch (e) {
        // ignore
      }

      // try legacy numeric detail id if present
      const legacyDetail = (t.raw && (t.raw['nm_tournament_detail'] || t.raw['detail'])) || t.detail || null;
      if (legacyDetail && legacyDetail !== t.id) {
        try {
          const snap2 = await getDocs(query(collection(db, 'tournament_detail'), where('nm_tournament_id', '==', legacyDetail)));
          for (const d of snap2.docs) {
            if (!docs.find(x => x.id === d.id)) docs.push(d);
          }
        } catch (e) {}
      }

      const matches: any[] = [];
      for (const d of docs) {
        const det = d.data() as any;
        const p1 = det['personId_1'] || det['nm_person_identity_id_1'];
        const p2 = det['personId_2'] || det['nm_person_identity_id_2'];
        const winner = det['nm_winner_id'] || det['nm_winner'] || det['winner'];
        const loser = det['nm_loser_id'] || det['nm_loser'] || det['loser'];
        const tie = det['bo_tie'] === true;
        const name1 = await this.getPersonNameByIdentityIndex(p1);
        const name2 = await this.getPersonNameByIdentityIndex(p2);
        const winnerName = winner ? await this.getPersonNameByIdentityIndex(winner) : '';
        const loserName = loser ? await this.getPersonNameByIdentityIndex(loser) : '';
        const round = (det['round'] ?? det['nm_round'] ?? det['ronda'] ?? det['round_number'] ?? 1);
        const table_number = (det['table_number'] ?? det['table'] ?? det['mesa'] ?? det['tableNumber'] ?? det['nm_table_number'] ?? 0);
        matches.push({ id: d.id, p1, p2, name1, name2, winner, winnerName, loser, loserName, tie, round: Number(round || 1), table_number: Number(table_number || 0), _raw: det });
      }

      console.debug('loadTournamentDetailsForTournament: raw matches for', t.id, matches.map(m => ({ id: m.id, round: m.round, table_number: m.table_number })));

      // dedupe by round + unordered participant pair
      const uniqueMap = new Map<string, any>();
      for (const m of matches) {
        const a = String(m.p1 || '');
        const b = String(m.p2 || '');
        const minId = a < b ? a : b;
        const maxId = a < b ? b : a;
        const rnd = Number(m.round || 1);
        const key = `${rnd}::${minId}::${maxId}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, { ...m });
        } else {
          const existing = uniqueMap.get(key);
          if ((!existing.table_number || existing.table_number === 0) && m.table_number) existing.table_number = m.table_number;
        }
      }

      const normalized = Array.from(uniqueMap.values()).sort((a:any,b:any) => (Number(a.round || 0) - Number(b.round || 0)) || (Number(a.table_number || 0) - Number(b.table_number || 0)));
      console.debug('loadTournamentDetailsForTournament: normalized matches for', t.id, normalized.map(m => ({ id: m.id, round: m.round, table_number: m.table_number, raw: !!m._raw }))); 
      t.matches = normalized;

      // build leaderboard: { personId, name, w, l, t, points }
      try {
        const lbMap: Record<string, { personId: string, name: string, w:number, l:number, t:number, points:number }> = {};
        // include participants explicitly so players with zero matches appear
        if (t.participants && Array.isArray(t.participants)) {
          for (const p of t.participants) {
            if (p && p.personId) lbMap[String(p.personId)] = { personId: String(p.personId), name: p.name || String(p.personId), w:0,l:0,t:0,points:0 };
          }
        }
        for (const m of normalized) {
          const a = String(m.p1 || '');
          const b = String(m.p2 || '');
          // ensure entries exist
          if (a && !lbMap[a]) lbMap[a] = { personId: a, name: m.name1 || a, w:0,l:0,t:0,points:0 };
          if (b && !lbMap[b]) lbMap[b] = { personId: b, name: m.name2 || b, w:0,l:0,t:0,points:0 };
          if (m.tie) {
            if (a) { lbMap[a].t += 1; lbMap[a].points += 1; }
            if (b) { lbMap[b].t += 1; lbMap[b].points += 1; }
          } else if (m.winner) {
            const win = String(m.winner);
            const los = m.loser ? String(m.loser) : null;
            if (win && lbMap[win]) { lbMap[win].w += 1; lbMap[win].points += 3; }
            if (los && lbMap[los]) { lbMap[los].l += 1; }
          }
        }
        // transform to array and sort by points desc, then w desc, then name
        t.leaderboard = Object.keys(lbMap).map(k => lbMap[k]).sort((x:any,y:any) => (Number(y.points || 0) - Number(x.points || 0)) || (Number(y.w || 0) - Number(x.w || 0)) || String(x.name).localeCompare(String(y.name)));
      } catch (err) {
        console.error('Error building leaderboard for tournament', t.id, err);
        t.leaderboard = [];
      }
    } catch (err) {
      console.error('Error in loadTournamentDetailsForTournament:', err);
      t.matches = [];
    }
  }

  async setTournamentTableCount(t: any, count: number) {
    if (!t || !t.id) return;
    try {
      const db = getFirestore();
      await setDoc(doc(db, 'tournament', t.id), { table_count: Number(count) }, { merge: true });
      console.info('table_count updated on tournament', t.id, count);
      this.message = `Table count actualizado: ${count}`;
      await this.loadTournaments();
    } catch (err) {
      console.error('Error setting table count', err);
      this.lastError = err;
    }
  }

  // Create match pairings for a tournament and persist them to 'tournament_detail'
  async startTournament(t: any, round: number = 1) {
    if (!t || !t.id) return;
    try {
      const db = getFirestore();

      // load participants for the tournament (fresh)
      const partsSnap = await getDocs(query(collection(db, 'tournament_participants'), where('tournamentId', '==', t.id)));
      const participants: string[] = [];
      for (const d of partsSnap.docs) {
        const pdata = d.data() as any;
        if (pdata && pdata.personId) participants.push(String(pdata.personId));
      }

      if (!participants || participants.length === 0) {
        this.message = 'No hay participantes para comenzar el torneo';
        return;
      }

      // shuffle participants (Fisher-Yates)
      for (let i = participants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = participants[i]; participants[i] = participants[j]; participants[j] = tmp;
      }

      // pair participants into 1v1 matches; if odd, last gets a bye (personId_2 = null)
      const matches: Array<{ personId_1: string; personId_2: string | null; table_number: number; }> = [];
      let tableNumber = 1;
      const maxTables = (t.table_count && Number(t.table_count) > 0) ? Number(t.table_count) : Math.ceil(participants.length / 2);
      for (let i = 0; i < participants.length; i += 2) {
        const p1 = participants[i];
        const p2 = (i + 1 < participants.length) ? participants[i + 1] : null;
        matches.push({ personId_1: p1, personId_2: p2, table_number: tableNumber });
        tableNumber++;
        if (tableNumber > maxTables) tableNumber = 1;
      }

      // persist matches
      for (const m of matches) {
        const docData: any = {
          nm_tournament_id: t.id,
          personId_1: m.personId_1,
          personId_2: m.personId_2 || null,
          nm_winner_id: null,
          nm_loser_id: null,
          bo_tie: false,
          match_date: serverTimestamp(),
          round: Number(round) || 1,
          table_number: m.table_number,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'tournament_detail'), docData);
      }

      this.message = `Torneo iniciado: ${t.id} (${matches.length} matches)`;
      // reload matches for the tournament and overall list
      await this.loadTournamentDetailsForTournament(t);
      await this.loadTournaments();
    } catch (err) {
      console.error('Error starting tournament', err);
      this.lastError = err;
    }
  }

  private async getPersonNameByIdentityIndex(indexOrId: any): Promise<string> {
    if (indexOrId === undefined || indexOrId === null) return '';
    try {
      const db = getFirestore();
      const key = String(indexOrId);
      // cache hit
      if (this.personCache.has(key)) {
        const cached = this.personCache.get(key);
        return cached && (cached['va_name'] || cached['name'] || cached.id) || key;
      }

      // If looks like a Firestore doc id (length >= 10), try getDoc
      if (typeof indexOrId === 'string' && indexOrId.length >= 10) {
        try {
          const pd = await getDoc(doc(db, 'person_identity', indexOrId));
          if (pd.exists()) {
            const data = pd.data() as any;
            const name = data['va_name'] || data['name'] || indexOrId;
            this.personCache.set(key, { id: indexOrId, ...data });
            return name;
          }
        } catch (err) {
          // continue to scanning
        }
      }

      // If we have already loaded persons list, try to match numeric index fields
      if (this.persons && this.persons.length > 0) {
        for (const p of this.persons) {
          const data = p.raw || {};
          for (const k of Object.keys(data)) {
            if (k.startsWith('nm_person_identity_id') || k === 'nm_person_identity_id') {
              if (String(data[k]) === key) {
                this.personCache.set(key, { id: p.id, ...data });
                return p.name || p.id;
              }
            }
            if (k === 'index' || k === 'identityIndex') {
              if (String(data[k]) === key) {
                this.personCache.set(key, { id: p.id, ...data });
                return p.name || p.id;
              }
            }
          }
        }
      }

      // As a last resort, scan all person_identity docs (expensive); cache first match
      const snap = await getDocs(collection(db, 'person_identity'));
      for (const d of snap.docs) {
        const data = d.data() as any;
        for (const k of Object.keys(data)) {
          if (k.startsWith('nm_person_identity_id') || k === 'nm_person_identity_id') {
            if (String(data[k]) === key) {
              const name = data['va_name'] || data['name'] || d.id;
              this.personCache.set(key, { id: d.id, ...data });
              return name;
            }
          }
          if (k === 'index' || k === 'identityIndex') {
            if (String(data[k]) === key) {
              const name = data['va_name'] || data['name'] || d.id;
              this.personCache.set(key, { id: d.id, ...data });
              return name;
            }
          }
        }
      }

      return key;
    } catch (err) {
      return String(indexOrId);
    }
  }

  // template helpers
  formatWinners(t: any): string {
    if (!t.winners || t.winners.length === 0) return '-';
    return t.winners.map((w: any) => w.name || w.id).join(', ');
  }

  formatLosers(t: any): string {
    if (!t.losers || t.losers.length === 0) return '-';
    return t.losers.map((l: any) => l.name || l.id).join(', ');
  }

  formatParticipants(t: any): string {
    if (!t.participants || t.participants.length === 0) return '-';
    return t.participants.map((p: any) => p.name || p.personId).join(', ');
  }

  formatDate(date?: any): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });
  }

  formatTableCount(t: any): string {
    if (t.table_count === undefined || t.table_count === null) return '';
    return String(t.table_count);
  }

  isTie(match: any): boolean {
    return match.tie === true;
  }

  getMatchResult(match: any): string {
    if (match.tie) return 'Empate';
    return match.winner ? 'Ganador: ' + (match.winnerName || match.winner) : 'Resultado desconocido';
  }

  getMatchParticipants(match: any): string {
    return `${match.name1 || match.p1} vs ${match.name2 || match.p2}`;
  }

  // Return W/L/T summary string for a given player id within a tournament
  getPlayerWLTForTournament(t: any, personId: string | null | undefined): string {
    try {
      const pid = String(personId || '');
      if (!t || !t.matches || !Array.isArray(t.matches)) return '0/0/0';
      let w = 0, l = 0, tt = 0;
      for (const m of t.matches) {
        if (!m) continue;
        const a = String(m.p1 || '');
        const b = String(m.p2 || '');
        // only consider matches where player participated
        if (pid === a || pid === b) {
          if (m.tie) {
            tt++;
          } else if (m.winner && String(m.winner) === pid) {
            w++;
          } else if (m.loser && String(m.loser) === pid) {
            l++;
          }
        }
      }
      return `${w}/${l}/${tt}`;
    } catch (err) {
      return '0/0/0';
    }
  }

  openPreview(t: any) {
    if (!t || !t.id) return;
    const url = `/tournament/preview/${t.id}`;
    window.open(url, '_blank');
  }
}
