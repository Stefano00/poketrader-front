import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { getFirestore, collection, getDocs, query, where, addDoc, serverTimestamp, updateDoc, doc, getDoc, setDoc } from 'firebase/firestore';

@Component({
  selector: 'app-current-tournament',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './current-tournament.html'
})
export class CurrentTournament implements OnInit {
  tournamentId: string | null = null;
  participants: Array<{id:string,name:string}> = [];

  pairings: Array<{p1:any,p2:any,table?:number}> = [];

  // countdown (minutes)
  countdownMinutes = 1;
  running = false;
  startTime: number | null = null;
  intervalId: any = null;
  elapsedSeconds: number = 0;
  // heartbeat persistence
  private lastHeartbeatMs: number | null = null;
  private persistedStart: boolean = false;
  // UI update interval for display (separate from heartbeat)
  private displayIntervalId: any = null;

  // selection state for matches keyed by table_number
  // each match stores numeric scores for p1 and p2 (0..2) and round
  // scores are nullable: each match has per-game winners stored in `games` (length = bestOf)
  matchSelections: Record<number, { scoreP1: number | null, scoreP2: number | null, round: number, games?: Array<'p1'|'p2'|null> }> = {};

  // default round number for saved matches
  round = 1;

  // best_of (number of games per match). Default 3 (best of 3).
  bestOf = 3;

  // W/L/T summary map: personId -> { w: number, l: number, t: number }
  wltMap: Record<string, { w:number, l:number, t:number }> = {};

  // UI
  showFullscreen = false;
  // tournament finished flag (from tournament doc bo_is_finished)
  tournamentFinished = false;
  // whether there is at least one saved match for this tournament
  hasAnySavedMatches = false;

  constructor(private route: ActivatedRoute, private router: Router) {}

  goBack() {
    try {
      if (window && window.history && window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch (e) {
      // ignore
    }
  // fallback to navigating to Tournament list
  try { this.router.navigate(['/tournament']); } catch (e) { console.warn('goBack fallback failed', e); }
  }

  async ngOnInit(): Promise<void> {
    this.tournamentId = this.route.snapshot.paramMap.get('id');
    // if provided, try to load participants; otherwise, empty pairing
    if (this.tournamentId) {
      await this.loadTournamentMeta();
      await this.loadParticipants(this.tournamentId);
      await this.buildWLTMap();
      // determine next round based on saved matches in DB
      try {
        const { maxRound } = await this.loadPastMatches();
        this.round = (Number(maxRound || 0) || 0) + 1;
      } catch (err) {
        console.warn('Could not determine past rounds, defaulting to 1', err);
        this.round = 1;
      }
      await this.checkHasSavedMatches();
      this.randomizePairings();
      // try to restore countdown from persistence
      await this.loadCountdownState();
    }
  }

  // load tournament metadata (bo_is_finished)
  async loadTournamentMeta() {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const docRef = doc(db, 'tournament', this.tournamentId);
      const snap = await getDoc(docRef);
      if (snap && snap.exists()) {
        const data = snap.data() as any;
        this.tournamentFinished = !!data['bo_is_finished'];
      }
    } catch (err) {
      console.warn('Could not load tournament meta', err);
    }
  }

  // check whether there is at least one saved match for this tournament
  async checkHasSavedMatches() {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const q = query(collection(db, 'tournament_detail'), where('nm_tournament_id', '==', this.tournamentId));
      const snap = await getDocs(q);
      this.hasAnySavedMatches = !!(snap && snap.docs && snap.docs.length > 0);
    } catch (err) {
      console.warn('Error checking saved matches', err);
      this.hasAnySavedMatches = false;
    }
  }

  private pairKey(a: string, b: string) {
    const x = String(a || '');
    const y = String(b || '');
    return x < y ? `${x}::${y}` : `${y}::${x}`;
  }

  private async loadPastMatches(): Promise<{ previousPairs: Set<string>, maxRound: number }> {
    const prev = new Set<string>();
    let maxRound = 0;
    if (!this.tournamentId) return { previousPairs: prev, maxRound };
    try {
      const db = getFirestore();
      const snap = await getDocs(query(collection(db, 'tournament_detail'), where('nm_tournament_id', '==', this.tournamentId)));
      for (const d of snap.docs) {
        const det = d.data() as any;
        const p1 = det['personId_1'] || det['nm_person_identity_id_1'];
        const p2 = det['personId_2'] || det['nm_person_identity_id_2'];
        const rnd = Number(det['round'] ?? det['ronda'] ?? det['nm_round'] ?? 1) || 1;
        if (rnd > maxRound) maxRound = rnd;
        if (p1 && p2) {
          prev.add(this.pairKey(String(p1), String(p2)));
        }
      }
    } catch (err) {
      console.error('Error loading past matches for preview pairing:', err);
    }
    return { previousPairs: prev, maxRound };
  }

  // Build W/L/T map for current tournament from tournament_detail
  async buildWLTMap() {
    this.wltMap = {};
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const snap = await getDocs(query(collection(db, 'tournament_detail'), where('nm_tournament_id', '==', this.tournamentId)));
      for (const d of snap.docs) {
        const det = d.data() as any;
        const p1 = det['personId_1'] || det['nm_person_identity_id_1'];
        const p2 = det['personId_2'] || det['nm_person_identity_id_2'];
        const winner = det['nm_winner_id'] || det['nm_winner'] || det['winner'];
        const loser = det['nm_loser_id'] || det['nm_loser'] || det['loser'];
        const tie = det['bo_tie'] === true;
        const ids = [p1, p2].filter(x => x !== undefined && x !== null).map((x:any) => String(x));
        for (const id of ids) {
          if (!this.wltMap[id]) this.wltMap[id] = { w:0,l:0,t:0 };
        }
        if (tie) {
          if (p1) this.wltMap[String(p1)].t += 1;
          if (p2) this.wltMap[String(p2)].t += 1;
        } else if (winner) {
          const win = String(winner);
          const los = loser ? String(loser) : null;
          if (!this.wltMap[win]) this.wltMap[win] = { w:0,l:0,t:0 };
          this.wltMap[win].w += 1;
          if (los) {
            if (!this.wltMap[los]) this.wltMap[los] = { w:0,l:0,t:0 };
            this.wltMap[los].l += 1;
          }
        }
      }
    } catch (err) {
      console.error('Error building WLT map:', err);
    }
  }

  getPlayerWLT(id: string | null | undefined): string {
    if (!id) return '0/0/0';
    const item = this.wltMap[String(id)];
    if (!item) return '0/0/0';
    return `${item.w}/${item.l}/${item.t}`;
  }

  gamesRange(): number[] {
    return Array.from({ length: this.bestOf }, (_, i) => i);
  }

  // Per-game helpers
  getGameWinner(table: number, gameIndex: number): 'p1'|'p2'|null {
    const sel = this.matchSelections[Number(table || 0)];
    if (!sel || !sel.games) return null;
    return sel.games[gameIndex] || null;
  }

  toggleGameWinner(table: number, gameIndex: number, side: 'p1'|'p2') {
    const k = Number(table || 0);
    if (!this.matchSelections[k]) this.matchSelections[k] = { scoreP1: null, scoreP2: null, round: this.round, games: Array(this.bestOf).fill(null) };
    const sel = this.matchSelections[k];
    if (!sel.games) sel.games = Array(this.bestOf).fill(null);
    // If already selected the same side, clear it; otherwise set to selected side and clear opponent's same label via counts
    if (sel.games[gameIndex] === side) {
      sel.games[gameIndex] = null;
    } else {
      sel.games[gameIndex] = side;
    }
    // recompute totals
    const p1 = (sel.games || []).filter(g => g === 'p1').length;
    const p2 = (sel.games || []).filter(g => g === 'p2').length;
    sel.scoreP1 = p1;
    sel.scoreP2 = p2;
  }

  getGamesCount(table: number) {
    const sel = this.matchSelections[Number(table || 0)];
    if (!sel || !sel.games) return { p1:0, p2:0 };
    return { p1: (sel.games || []).filter(g => g === 'p1').length, p2: (sel.games || []).filter(g => g === 'p2').length };
  }

  // Continue to next round: randomize pairings avoiding repeat opponents where possible
  async continueNextRound() {
    if (!this.tournamentId) return;
    const { previousPairs, maxRound } = await this.loadPastMatches();
    const nextRound = (maxRound || 0) + 1;
    const ids = this.participants.map(p => p.id);
    if (ids.length === 0) return;

    const attempts = 300;
    let success = false;
    let resultPairs: Array<any> = [];

    const tryMakePairs = () => {
      const arr = [...ids];
      // shuffle
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const pairs: any[] = [];
      let table = 1;
      let i = 0;
      while (i < arr.length) {
        const a = arr[i];
        if (i + 1 < arr.length) {
          // find partner for a that hasn't played with a
          let partner = arr[i + 1];
          if (previousPairs.has(this.pairKey(a, partner))) {
            // try to find alternative in later positions
            let found = -1;
            for (let k = i + 2; k < arr.length; k++) {
              if (!previousPairs.has(this.pairKey(a, arr[k]))) { found = k; break; }
            }
            if (found === -1) {
              // fail this attempt
              return null;
            }
            // swap partner into i+1
            [arr[i + 1], arr[found]] = [arr[found], arr[i + 1]];
            partner = arr[i + 1];
          }
          pairs.push({ p1: this.participants.find(x => x.id === a), p2: this.participants.find(x => x.id === partner), table });
          table++;
          i += 2;
        } else {
          // bye
          pairs.push({ p1: this.participants.find(x => x.id === a), p2: null, table });
          i += 1;
          table++;
        }
      }
      return pairs;
    };

    for (let attempt = 0; attempt < attempts; attempt++) {
      const res = tryMakePairs();
      if (res && res.length > 0) { success = true; resultPairs = res; break; }
    }

    if (!success) {
      // fallback: simple shuffle allowing repeats
      const arr = [...ids];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const pairs: any[] = [];
      let tnum = 1;
      for (let i = 0; i < arr.length; i += 2) {
        pairs.push({ p1: this.participants.find(x => x.id === arr[i]), p2: (i + 1 < arr.length) ? this.participants.find(x => x.id === arr[i + 1]) : null, table: tnum });
        tnum++;
      }
      resultPairs = pairs;
    }

    // set pairings and update selection rounds
    this.pairings = resultPairs.map((p, idx) => ({ p1: p.p1, p2: p.p2, table: p.table || (idx + 1) }));
    this.matchSelections = {};
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      this.matchSelections[tbl] = { scoreP1: null, scoreP2: null, round: nextRound, games: Array(this.bestOf).fill(null) };
      (p as any)._saved = false;
    }
    // update internal round
    this.round = nextRound;
    
    // Reset countdown for new round
    this.resetCountdownForNewRound();
  }

  // can continue to the next round only when current round results have been saved for all tables
  canContinue(): boolean {
    if (!this.pairings || this.pairings.length === 0) return false;
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      const sel = this.matchSelections[tbl];
      if (!sel) return false;
      if (!(p as any)._saved) return false;
    }
    return true;
  }

  isSaved(p: any): boolean {
    try {
      return !!(p && (p as any)._saved);
    } catch (e) { return false; }
  }

  async loadParticipants(tournamentId: string) {
    try {
      const db = getFirestore();
      const snap = await getDocs(query(collection(db, 'tournament_participants'), where('tournamentId','==', tournamentId)));
      this.participants = [];
      for (const d of snap.docs) {
        const pdata = d.data() as any;
        if (pdata.personId) {
          // fetch person name
          try {
            const pd = await getDocs(collection(db,'person_identity'));
            // naive: find doc matching id
            const personDoc = pd.docs.find(x => x.id === pdata.personId);
            const data = personDoc ? (personDoc.data() as any) : null;
            this.participants.push({ id: pdata.personId, name: data ? (data['va_name'] || data['name'] || pdata.personId) : pdata.personId });
          } catch (err) {
            this.participants.push({ id: pdata.personId, name: pdata.personId });
          }
        }
      }
    } catch (err) {
      console.error('Error loading participants for preview:', err);
    }
  }

  randomizePairings() {
    const arr = [...this.participants];
    for (let i = arr.length -1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const pairs: any[] = [];
    let table = 1;
    for (let i=0;i<arr.length;i+=2) {
      pairs.push({ p1: arr[i], p2: arr[i+1] || null, table });
      table++;
    }
    this.pairings = pairs;
    // initialize selections
    this.matchSelections = {};
    for (const p of this.pairings) {
      this.matchSelections[p.table || 0] = { scoreP1: null, scoreP2: null, round: this.round, games: Array(this.bestOf).fill(null) };
      (p as any)._saved = false;
    }
  }

  // controls
  startCountdown() {
    if (this.running) {
      // If already running, just show fullscreen
      this.showFullscreen = true;
      return;
    }
    this.running = true;
    // If we have a persisted start, reuse it; otherwise set and persist
    if (!this.startTime) this.startTime = Date.now();
    // persist start if not already persisted
    if (!this.persistedStart) {
      void this.persistCountdownStart().catch(() => {});
    }
    this.showFullscreen = true;
    this.intervalId = setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - (this.startTime || now)) / 1000);
      const total = (Number(this.countdownMinutes) || 0) * 60;
      // remaining seconds (can be negative)
      const remaining = total - diff;
      // minute heartbeat persistence
      if (this.tournamentId) {
        if (this.lastHeartbeatMs === null) this.lastHeartbeatMs = now;
        if ((now - (this.lastHeartbeatMs || 0)) >= 10_000) {
          this.lastHeartbeatMs = now;
          void this.persistCountdownHeartbeat(remaining).catch(() => {});
        }
      }
      // auto-stop when reaches -15:00 or less
      if (remaining <= -15 * 60) {
        this.stopCountdown('expired');
      }
    }, 200);
    
    // Start display update interval (every second for UI)
    this.startDisplayUpdate();
  }

  stopCountdown(status: 'stopped' | 'expired' = 'stopped') {
    this.running = false;
    this.showFullscreen = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Stop display update interval
    this.stopDisplayUpdate();
    // persist stop state
    void this.persistCountdownStop(status).catch(() => {});
  }

  // Close fullscreen but keep countdown running
  closeFullscreen() {
    this.showFullscreen = false;
    // Keep everything else running
  }

  // Reset countdown for new round
  resetCountdownForNewRound() {
    // Stop current countdown
    this.stopCountdown('stopped');
    // Reset countdown state
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.persistedStart = false;
    this.lastHeartbeatMs = null;
    // Clear any existing countdown data for this tournament
    void this.clearCountdownState().catch(() => {});
  }

  resetAndRandomize() {
    // legacy: full reset and randomize (keeps existing behavior)
    this.stopCountdown();
    this.randomizePairings();
    this.elapsedSeconds = 0;
  }

  // New: reset only the form (clear per-game selections) without changing round or pairings
  resetForm() {
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      if (!this.matchSelections[tbl]) {
        this.matchSelections[tbl] = { scoreP1: null, scoreP2: null, round: this.round, games: Array(this.bestOf).fill(null) };
      } else {
        this.matchSelections[tbl].games = Array(this.bestOf).fill(null);
        this.matchSelections[tbl].scoreP1 = null;
        this.matchSelections[tbl].scoreP2 = null;
        // keep the round value as-is
      }
      // mark as not saved since we've cleared the form
      (p as any)._saved = false;
    }
  }

  // fullscreen exit on Esc
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeFullscreen();
    }
  }

  // helper to display elapsed seconds (can be negative)
  displaySeconds(): number {
    return this.elapsedSeconds || 0;
  }

  // ===== Countdown persistence (Firestore: current_tournament/{tournamentId}) =====
  private async loadCountdownState() {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const ref = doc(db, 'current_tournament', this.tournamentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data() as any;
      const savedRound = Number(data.round || 0);
      // Only load countdown if it's for the current round
      if (savedRound !== this.round) return;
      
      const running = !!data.running;
      const totalSeconds = Number(data.totalSeconds || (Number(this.countdownMinutes) || 0) * 60) || 0;
      const startAtMs = Number(data.startAtMs || 0) || 0;
      const lastRemainingSeconds = Number(data.lastRemainingSeconds || 0);
      const lastUpdatedAtMs = Number(data.lastUpdatedAtMs || 0) || 0;
      // prefer computing from startAtMs if available; fallback to lastRemainingSeconds + lastUpdatedAtMs
      let remaining = 0;
      if (startAtMs && totalSeconds) {
        const now = Date.now();
        const diff = Math.floor((now - startAtMs) / 1000);
        remaining = totalSeconds - diff;
      } else if (lastUpdatedAtMs) {
        const now = Date.now();
        const drift = Math.floor((now - lastUpdatedAtMs) / 1000);
        remaining = lastRemainingSeconds - drift;
      }
      // restore minutes if saved
      if (data.countdownMinutes != null) this.countdownMinutes = Number(data.countdownMinutes) || this.countdownMinutes;
      if (running) {
        // restore startTime to align with server state so the local timer continues accurately
        if (startAtMs) this.startTime = Number(startAtMs);
        this.persistedStart = true;
        this.startCountdown();
      } else {
        // Even if not running, start display update to show the stopped time
        this.startDisplayUpdate();
      }
    } catch (err) {
      // ignore load errors; countdown will remain local
    }
  }

  private async clearCountdownState() {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const ref = doc(db, 'current_tournament', this.tournamentId);
      await setDoc(ref, {
        nm_tournament_id: this.tournamentId,
        round: this.round,
        running: false,
        status: 'cleared',
        clearedAt: serverTimestamp(),
        clearedAtMs: Date.now()
      }, { merge: true });
    } catch (err) {
      // swallow
    }
  }

  private async persistCountdownStart() {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const ref = doc(db, 'current_tournament', this.tournamentId);
      const totalSeconds = (Number(this.countdownMinutes) || 0) * 60;
      await setDoc(ref, {
        nm_tournament_id: this.tournamentId,
        round: this.round,
        countdownMinutes: Number(this.countdownMinutes) || 0,
        totalSeconds,
        startAtMs: this.startTime || Date.now(),
        running: true,
        status: 'running',
        lastRemainingSeconds: totalSeconds,
        lastUpdatedAt: serverTimestamp(),
        lastUpdatedAtMs: Date.now()
      }, { merge: true });
      this.persistedStart = true;
      this.lastHeartbeatMs = Date.now();
    } catch (err) {
      // swallow
    }
  }

  private async persistCountdownHeartbeat(remainingSeconds: number) {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const ref = doc(db, 'current_tournament', this.tournamentId);
      await setDoc(ref, {
        round: this.round,
        running: true,
        status: 'running',
        lastRemainingSeconds: Math.floor(remainingSeconds),
        lastUpdatedAt: serverTimestamp(),
        lastUpdatedAtMs: Date.now()
      }, { merge: true });
    } catch (err) {
      // ignore transient errors
    }
  }

  private async persistCountdownStop(status: 'stopped' | 'expired') {
    if (!this.tournamentId) return;
    try {
      const db = getFirestore();
      const ref = doc(db, 'current_tournament', this.tournamentId);
      await setDoc(ref, {
        round: this.round,
        running: false,
        status,
        stoppedAt: serverTimestamp(),
        stoppedAtMs: Date.now(),
        lastRemainingSeconds: Math.floor(this.elapsedSeconds || 0),
        lastUpdatedAt: serverTimestamp(),
        lastUpdatedAtMs: Date.now()
      }, { merge: true });
    } catch (err) {
      // swallow
    }
  }

  displayTime(): string {
    const sec = Math.floor(this.elapsedSeconds || 0);
    const neg = sec < 0;
    const s = Math.abs(sec);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    const padded = `${mm}:${ss.toString().padStart(2,'0')}`;
    return (neg ? '-' : '') + padded;
  }

  // return an alphabetical order array of two entries {id,name}
  getAlphabeticalPair(p: any) {
    const a = p.p1 ? { id: p.p1.id, name: p.p1.name || p.p1.id } : { id: null, name: 'BYE' };
    const b = p.p2 ? { id: p.p2.id, name: p.p2.name || p.p2.id } : { id: null, name: 'BYE' };
    const arr = [a,b].sort((x,y) => (String(x.name).toLowerCase() > String(y.name).toLowerCase() ? 1 : -1));
    return arr;
  }

  // Save match result to tournament_detail
  // UI: save modal state for double confirmation
  showSaveModal = false;
  saveErrorMessage: string | null = null;
  // Reset confirmation modal
  showResetModal = false;

  // Validate whether there are changes to save and whether every table has at least one win recorded
  hasChanges(): boolean {
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      const sel = this.matchSelections[tbl];
      if (!sel) continue;
      const points1 = ((sel.games || []) as Array<any>).filter((g:any) => g === 'p1').length || Number(sel.scoreP1 || 0);
      const points2 = ((sel.games || []) as Array<any>).filter((g:any) => g === 'p2').length || Number(sel.scoreP2 || 0);
      // if any table has some points and not already marked saved => we have changes
      if ((points1 + points2) > 0 && !(p as any)._saved) return true;
    }
    return false;
  }

  validateAllTables(): { ok: boolean; message?: string } {
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      const sel = this.matchSelections[tbl];
      if (!sel) return { ok: false, message: `La mesa ${tbl} no tiene resultados` };
      const points1 = ((sel.games || []) as Array<any>).filter((g:any) => g === 'p1').length || Number(sel.scoreP1 || 0);
      const points2 = ((sel.games || []) as Array<any>).filter((g:any) => g === 'p2').length || Number(sel.scoreP2 || 0);
      if ((points1 + points2) === 0) return { ok: false, message: `La mesa ${tbl} debe tener al menos 1 victoria/derrota` };
    }
    return { ok: true };
  }

  // Entry called by the button: open modal only if validation passes
  saveAllMatches() {
    this.saveErrorMessage = null;
    if (!this.hasChanges()) {
      this.saveErrorMessage = 'No hay cambios para guardar.';
      this.showSaveModal = true;
      return;
    }
    const v = this.validateAllTables();
    if (!v.ok) {
      this.saveErrorMessage = v.message || 'Validación falló';
      this.showSaveModal = true;
      return;
    }
    // open modal for single confirmation
    this.showSaveModal = true;
  }

  // Reset modal handlers
  openResetModal() {
    this.showResetModal = true;
  }

  cancelResetModal() {
    this.showResetModal = false;
  }

  confirmResetFromModal() {
    // perform the reset of only the form controls
    this.resetForm();
    this.showResetModal = false;
  }

  // Finalize tournament modal state & handlers
  showFinalizeModal = false;
  openFinalizeModal() {
    this.showFinalizeModal = true;
  }
  cancelFinalizeModal() {
    this.showFinalizeModal = false;
  }

  // perform finalize: set bo_is_finished = true on tournament doc
  async confirmFinalizeFromModal() {
    if (!this.tournamentId) return;
    try {
      // if there are unsaved changes, save them first
      if (this.hasChanges()) {
        await this.performSaveAllMatches();
      }
      
      // Stop countdown when tournament is finalized
      this.stopCountdown('stopped');
      
      const db = getFirestore();
      const tRef = doc(db, 'tournament', this.tournamentId);
      await updateDoc(tRef, { bo_is_finished: true });
      this.tournamentFinished = true;
    } catch (err) {
      console.error('Error finalizing tournament', err);
    } finally {
      this.showFinalizeModal = false;
    }
  }

  // finalize without saving current unsaved changes
  async finalizeWithoutSaving() {
    if (!this.tournamentId) return;
    try {
      // Stop countdown when tournament is finalized
      this.stopCountdown('stopped');
      
      const db = getFirestore();
      const tRef = doc(db, 'tournament', this.tournamentId);
      await updateDoc(tRef, { bo_is_finished: true });
      this.tournamentFinished = true;
    } catch (err) {
      console.error('Error finalizing tournament', err);
    } finally {
      this.showFinalizeModal = false;
    }
  }

  // final confirmation from modal (single step)
  async confirmSaveFromModal() {
    await this.performSaveAllMatches();
    this.showSaveModal = false;
    this.saveErrorMessage = null;
  }

  cancelSaveModal() {
  this.showSaveModal = false;
  this.saveErrorMessage = null;
  }

  // Actual saving logic (used after final confirmation)
  async performSaveAllMatches() {
    if (!this.tournamentId) return;
    if (this.tournamentFinished) {
      console.warn('Tournament is finished; cannot save matches.');
      return;
    }
    const db = getFirestore();
    let saved = 0;
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      const sel = this.matchSelections[tbl];
      if (!sel) continue;
      // Determine points per player
      let points1 = 0;
      let points2 = 0;
      if ((sel as any).games && Array.isArray((sel as any).games)) {
        for (const g of (sel as any).games) {
          if (g === 'p1' || g === 1) points1++;
          else if (g === 'p2' || g === 2) points2++;
        }
      } else {
        points1 = Number(sel.scoreP1 ?? 0);
        points2 = Number(sel.scoreP2 ?? 0);
      }

      let winnerId: string | null = null;
      let loserId: string | null = null;
      let boTie = false;
      if (points1 > points2) { winnerId = p.p1 ? p.p1.id : null; loserId = p.p2 ? p.p2.id : null; }
      else if (points2 > points1) { winnerId = p.p2 ? p.p2.id : null; loserId = p.p1 ? p.p1.id : null; }
      else { boTie = true; }

      const personId1 = p.p1 ? p.p1.id : null;
      const personId2 = p.p2 ? p.p2.id : null;

      const docData: any = {
        nm_tournament_id: this.tournamentId,
        personId_1: personId1,
        personId_2: personId2,
        nm_winner_id: winnerId || null,
        nm_loser_id: loserId || null,
        nm_point_per_1: points1,
        nm_point_per_2: points2,
        bo_tie: boTie,
        match_date: serverTimestamp(),
        round: Number(sel.round || this.round) || 1,
        table_number: tbl,
        createdAt: serverTimestamp()
      };
      try {
        // try to find existing entry for this tournament/round/table
        const q = query(
          collection(db, 'tournament_detail'),
          where('nm_tournament_id', '==', this.tournamentId),
          where('round', '==', Number(sel.round || this.round) || 1),
          where('table_number', '==', tbl)
        );
        const existing = await getDocs(q);
        if (existing && existing.docs && existing.docs.length > 0) {
          // update the first matching document (idempotent)
          const docRef = existing.docs[0].ref;
          // don't overwrite original createdAt when updating
          const updateData = Object.assign({}, docData);
          delete updateData.createdAt;
          await updateDoc(docRef, updateData);
        } else {
          // create new document
          await addDoc(collection(db, 'tournament_detail'), docData);
        }
        (p as any)._saved = true;
        saved++;
      } catch (err) {
        console.error('Error saving match for table', tbl, err);
      }
    }
    if (saved > 0) {
      console.info('Saved matches:', saved);
      await this.buildWLTMap();
      // refresh saved-match indicator and tournament meta
      await this.checkHasSavedMatches();
      await this.loadTournamentMeta();
    }
  }

  // helpers to safely access/set scores from template
  getScore(table: number, side: 'p1'|'p2'): number {
    const k = Number(table || 0);
    const sel = this.matchSelections[k];
    if (!sel) return 0;
    return side === 'p1' ? Number(sel.scoreP1 || 0) : Number(sel.scoreP2 || 0);
  }

  setScore(table: number, side: 'p1'|'p2', value: number) {
    const k = Number(table || 0);
    if (!this.matchSelections[k]) this.matchSelections[k] = { scoreP1: 0, scoreP2: 0, round: this.round };
    const val = Number(value ?? 0);
    // When selecting a value for one player, clear the same-value radio on the opponent.
    if (side === 'p1') {
      this.matchSelections[k].scoreP1 = val;
      // if opponent had same value, clear it
      if (this.matchSelections[k].scoreP2 === val) this.matchSelections[k].scoreP2 = null;
    } else {
      this.matchSelections[k].scoreP2 = val;
      if (this.matchSelections[k].scoreP1 === val) this.matchSelections[k].scoreP1 = null;
    }
  }

  // round helpers (work with the numeric score shape)
  getRoundValue(table: number): number {
    const k = Number(table || 0);
    if (!this.matchSelections[k]) this.matchSelections[k] = { scoreP1: 0, scoreP2: 0, round: this.round };
    return Number(this.matchSelections[k].round || this.round || 1);
  }

  setRoundValue(table: number, value: number) {
    const k = Number(table || 0);
    if (!this.matchSelections[k]) this.matchSelections[k] = { scoreP1: 0, scoreP2: 0, round: this.round };
    this.matchSelections[k].round = Number(value || this.round || 1);
  }

  tableNumber(p: any): number {
    return Number(p && p.table ? p.table : 0);
  }

  setRound(table: number) {
    const t = Number(table || 0);
    if (t === 0) {
      // apply to all
      for (const k of Object.keys(this.matchSelections)) {
        const idx = Number(k);
        if (this.matchSelections[idx]) this.matchSelections[idx].round = Number(this.round || 1);
      }
    } else {
      const k = Number(t || 0);
      if (!this.matchSelections[k]) this.matchSelections[k] = { scoreP1: 0, scoreP2: 0, round: this.round };
      this.matchSelections[k].round = Number(this.matchSelections[k].round || this.round || 1);
    }
  }

  // ===== Display Update Methods =====
  private startDisplayUpdate() {
    // Clear any existing display interval
    this.stopDisplayUpdate();
    // Update display every second for smooth UI updates
    this.displayIntervalId = setInterval(() => {
      // Always update display as long as we have a startTime
      if (this.startTime) {
        const now = Date.now();
        const diff = Math.floor((now - this.startTime) / 1000);
        const total = (Number(this.countdownMinutes) || 0) * 60;
        const remaining = total - diff;
        // Update the property that the template uses
        this.elapsedSeconds = remaining;
      }
    }, 1000);
  }

  private stopDisplayUpdate() {
    if (this.displayIntervalId) {
      clearInterval(this.displayIntervalId);
      this.displayIntervalId = null;
    }
  }
}
