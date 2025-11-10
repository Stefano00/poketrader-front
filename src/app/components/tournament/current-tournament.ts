import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { getFirestore, collection, getDocs, query, where, addDoc, serverTimestamp, updateDoc, doc, getDoc, setDoc } from 'firebase/firestore';

type MatchOutcome = {
  points1: number;
  points2: number;
  winnerId: string | null;
  loserId: string | null;
  boTie: boolean;
  round: number;
  p1Id: string | null;
  p2Id: string | null;
};

@Component({
  selector: 'app-current-tournament',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './current-tournament.html',
  styleUrl: './current-tournament.scss'
})
export class CurrentTournament implements OnInit {
  tournamentId: string | null = null;
  participants: Array<{id:string,name:string}> = [];

  pairings: Array<{p1:any,p2:any,table?:number}> = [];
  private readonly BYE_ID = '__BYE__';

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
  private rawWltMap: Record<string, { w:number, l:number, t:number }> = {};

  // UI
  showFullscreen = false;
  // tournament finished flag (from tournament doc bo_is_finished)
  tournamentFinished = false;
  // whether there is at least one saved match for this tournament
  hasAnySavedMatches = false;
  // leaderboard standings when tournament finished
  leaderboard: Array<{ personId: string, name: string, w: number, l: number, t: number, points: number }> = [];
  // leaderboard override UI
  resultOverrides: Record<string, { w: number; l: number; t: number; points: number; reason?: string; base?: { w:number; l:number; t:number }; delta?: { w:number; l:number; t:number } }> = {};
  editingPlayerResult: { personId: string; name: string; w: number; l: number; t: number; reason: string } | null = null;
  resultEditError: string | null = null;
  resultEditSaving = false;

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
        const id1 = p1 ? String(p1) : null;
        const id2 = p2 ? String(p2) : null;
        if (id1 && id2) {
          prev.add(this.pairKey(id1, id2));
        } else if (id1 || id2) {
          const active = id1 || id2;
          prev.add(this.pairKey(String(active), this.BYE_ID));
        }
      }
    } catch (err) {
      console.error('Error loading past matches for preview pairing:', err);
    }
    return { previousPairs: prev, maxRound };
  }

  // Build W/L/T map for current tournament from tournament_detail
  async buildWLTMap() {
    const rawStats: Record<string, { w:number, l:number, t:number }> = {};
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
          if (!rawStats[id]) rawStats[id] = { w:0,l:0,t:0 };
        }
        if (tie) {
          if (p1) rawStats[String(p1)].t += 1;
          if (p2) rawStats[String(p2)].t += 1;
        } else if (winner) {
          const win = String(winner);
          const los = loser ? String(loser) : null;
          if (!rawStats[win]) rawStats[win] = { w:0,l:0,t:0 };
          rawStats[win].w += 1;
          if (los) {
            if (!rawStats[los]) rawStats[los] = { w:0,l:0,t:0 };
            rawStats[los].l += 1;
          }
        }
      }
      this.rawWltMap = rawStats;
      this.wltMap = JSON.parse(JSON.stringify(rawStats));
      this.resultOverrides = await this.loadResultOverrides();
      for (const pid of Object.keys(this.resultOverrides)) {
        const override = this.resultOverrides[pid];
        const current = this.wltMap[pid] || { w:0,l:0,t:0 };
        if (override.base) {
          current.w = Number(rawStats[pid]?.w || 0) + Number(override.delta?.w || 0);
          current.l = Number(rawStats[pid]?.l || 0) + Number(override.delta?.l || 0);
          current.t = Number(rawStats[pid]?.t || 0) + Number(override.delta?.t || 0);
        } else {
          current.w = Number(override.w || 0);
          current.l = Number(override.l || 0);
          current.t = Number(override.t || 0);
        }
        this.wltMap[pid] = current;
      }
      this.rebuildLeaderboard();
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

  private ensureMatchSelection(table: number) {
    const k = Number(table || 0);
    if (!this.matchSelections[k]) this.matchSelections[k] = { scoreP1: null, scoreP2: null, round: this.round, games: Array(this.bestOf).fill(null) };
    const sel = this.matchSelections[k];
    if (!sel.games || sel.games.length !== this.bestOf) sel.games = Array(this.bestOf).fill(null);
    if (sel.round == null) sel.round = this.round;
    return sel;
  }

  selectGameWinner(table: number, gameIndex: number, side: 'p1'|'p2') {
    const sel = this.ensureMatchSelection(table);
    if (gameIndex < 0 || gameIndex >= this.bestOf) return;
    sel.games![gameIndex] = side;
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

  getPlayersForMatch(p: any): Array<{ id: string | null; name: string; side: 'p1'|'p2'; isBye: boolean }> {
    const buildPlayer = (player: any, side: 'p1'|'p2') => {
      if (!player) {
        return { id: null, name: 'BYE', side, isBye: true };
      }
      const id = player.id !== undefined && player.id !== null ? String(player.id) : null;
      const name = player.name || (id ?? 'BYE');
      return { id, name, side, isBye: false };
    };
    return [buildPlayer(p?.p1, 'p1'), buildPlayer(p?.p2, 'p2')];
  }

  getPlayerRecord(id: string | null | undefined): { w: number; l: number; t: number } {
    if (!id) return { w: 0, l: 0, t: 0 };
    const stats = this.wltMap[String(id)] || { w: 0, l: 0, t: 0 };
    return {
      w: Number(stats.w || 0),
      l: Number(stats.l || 0),
      t: Number(stats.t || 0)
    };
  }


  // Continue to next round: randomize pairings avoiding repeat opponents where possible
  async continueNextRound() {
    if (!this.tournamentId) return;
    const { previousPairs, maxRound } = await this.loadPastMatches();
    const nextRound = (maxRound || 0) + 1;
    const participantMap = new Map<string, { id: string | number; name: string }>();
    for (const p of this.participants) {
      if (!p || p.id === undefined || p.id === null) continue;
      participantMap.set(String(p.id), p);
    }
    const participantIds = Array.from(participantMap.keys());
    if (participantIds.length === 0) return;

    const byeHistory = new Set<string>();
    for (const key of Array.from(previousPairs)) {
      const parts = key.split('::');
      if (parts.length !== 2) continue;
      const [a, b] = parts;
      if (a === this.BYE_ID && b) byeHistory.add(b);
      else if (b === this.BYE_ID && a) byeHistory.add(a);
    }

    let resultPairs: Array<any> = [];
    let computed = this.buildNonRepeatingPairs(participantIds, previousPairs, byeHistory, false);
    if (!computed || computed.length === 0) {
      computed = this.buildNonRepeatingPairs(participantIds, previousPairs, byeHistory, true);
    }

    if (computed && computed.length > 0) {
      resultPairs = computed.map((pair, idx) => {
        const p1 = participantMap.get(pair.p1Id) || { id: pair.p1Id, name: pair.p1Id };
        const p2 = pair.p2Id ? (participantMap.get(pair.p2Id) || { id: pair.p2Id, name: pair.p2Id }) : null;
        return { p1, p2, table: idx + 1 };
      });
    } else {
      // fallback: simple shuffle allowing repeats (only when no alternate pairing exists)
      const arr = [...participantIds];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      if (arr.length % 2 === 1) {
        const byeCandidate = arr.find(id => !byeHistory.has(id));
        if (byeCandidate) {
          const idx = arr.indexOf(byeCandidate);
          arr.splice(idx, 1);
          arr.push(byeCandidate);
        }
      }
      const pairs: any[] = [];
      let tnum = 1;
      for (let i = 0; i < arr.length; i += 2) {
        const first = participantMap.get(arr[i]) || { id: arr[i], name: arr[i] };
        const nextId = arr[i + 1];
        const second = nextId ? (participantMap.get(nextId) || { id: nextId, name: nextId }) : null;
        pairs.push({ p1: first, p2: second, table: tnum });
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

  private buildNonRepeatingPairs(
    ids: string[],
    previousPairs: Set<string>,
    byeHistory: Set<string>,
    allowByeRepeats: boolean
  ): Array<{ p1Id: string; p2Id: string | null }> | null {
    if (!ids || ids.length === 0) return [];
    const baseIds = [...ids];
    const attempts = Math.max(5, ids.length * 3);

    const shuffleInPlace = (arr: string[]) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    for (let attempt = 0; attempt < attempts; attempt++) {
      const order = shuffleInPlace([...baseIds]);
      const used = new Set<string>();
      const result: Array<{ p1Id: string; p2Id: string | null }> = [];
      const allowBye = order.length % 2 === 1;

      const shuffle = (arr: string[]) => shuffleInPlace([...arr]);

      const dfs = (): boolean => {
        if (used.size === order.length) return true;

        let candidate: string | undefined;
        for (const id of order) {
          if (!used.has(id)) { candidate = id; break; }
        }
        if (candidate === undefined) return true;
        used.add(candidate);

        const available: string[] = [];
        for (const id of order) {
          if (id === candidate || used.has(id)) continue;
          available.push(id);
        }

        const preferred = shuffle(available.filter(id => !previousPairs.has(this.pairKey(candidate, id))));
        const fallback = shuffle(available.filter(id => previousPairs.has(this.pairKey(candidate, id))));

        for (const pool of [preferred, fallback]) {
          for (const id of pool) {
            used.add(id);
            result.push({ p1Id: candidate, p2Id: id });
            if (dfs()) return true;
            result.pop();
            used.delete(id);
          }
        }

        if (allowBye && !result.some(p => p.p2Id === null)) {
          const byeKey = this.BYE_ID;
          const hadByeBefore = previousPairs.has(this.pairKey(candidate, byeKey)) || byeHistory.has(candidate);
          if (!hadByeBefore || allowByeRepeats) {
            result.push({ p1Id: candidate, p2Id: null });
            if (dfs()) return true;
            result.pop();
          }
        }

        used.delete(candidate);
        return false;
      };

      if (dfs()) return result;
    }

    return null;
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
      this.rebuildLeaderboard();
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

  // Save match result to tournament_detail
  // UI: save modal state for double confirmation
  showSaveModal = false;
  saveErrorMessage: string | null = null;
  private pendingContinueAfterSave = false;
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
  saveAllMatches(continueAfter: boolean = false) {
    this.pendingContinueAfterSave = continueAfter;
    this.saveErrorMessage = null;
    if (!this.hasChanges()) {
      if (!continueAfter) {
        this.saveErrorMessage = 'No hay cambios para guardar.';
        this.showSaveModal = true;
      }
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

  async saveAndContinue() {
    if (this.tournamentFinished) return;
    if (this.hasChanges()) {
      this.saveAllMatches(true);
      return;
    }
    if (this.canContinue()) {
      await this.continueNextRound();
      return;
    }
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
    try {
      await this.performSaveAllMatches();
      this.showSaveModal = false;
      this.saveErrorMessage = null;
      if (this.pendingContinueAfterSave && this.canContinue()) {
        await this.continueNextRound();
      }
    } finally {
      this.pendingContinueAfterSave = false;
    }
  }

  cancelSaveModal() {
    this.showSaveModal = false;
    this.saveErrorMessage = null;
    this.pendingContinueAfterSave = false;
  }

  buildMatchOutcome(p: any, table: number): MatchOutcome | null {
    const tbl = Number(table || 0);
    const sel = this.matchSelections[tbl];
    if (!sel) return null;
    const p1Id = p && p.p1 && p.p1.id !== undefined && p.p1.id !== null ? String(p.p1.id) : null;
    const p2Id = p && p.p2 && p.p2.id !== undefined && p.p2.id !== null ? String(p.p2.id) : null;
    const isByeMatch = !p1Id || !p2Id;
    let points1 = 0;
    let points2 = 0;
    if (Array.isArray(sel.games)) {
      for (const g of sel.games) {
        if (g === 'p1') points1++;
        else if (g === 'p2') points2++;
      }
    } else {
      points1 = Number(sel.scoreP1 ?? 0);
      points2 = Number(sel.scoreP2 ?? 0);
    }

    if (isByeMatch) {
      const activeId = p1Id || p2Id;
      const winsNeeded = Math.max(Number(this.bestOf) || 0, 1);
      if (activeId) {
        if (p1Id === activeId) {
          points1 = winsNeeded;
          points2 = 0;
        } else {
          points1 = 0;
          points2 = winsNeeded;
        }
        const totalGames = Math.max(Number(this.bestOf) || 0, winsNeeded);
        if (!sel.games || !Array.isArray(sel.games) || sel.games.length < totalGames) {
          sel.games = Array(totalGames).fill(null);
        } else {
          sel.games = sel.games.map(() => null);
        }
        for (let i = 0; i < winsNeeded && Array.isArray(sel.games) && i < sel.games.length; i++) {
          sel.games[i] = (p1Id === activeId) ? 'p1' : 'p2';
        }
      }
    }

    sel.scoreP1 = points1;
    sel.scoreP2 = points2;

    let winnerId: string | null = null;
    let loserId: string | null = null;
    let boTie = false;
    if (points1 > points2) {
      winnerId = p1Id;
      loserId = p2Id;
    } else if (points2 > points1) {
      winnerId = p2Id;
      loserId = p1Id;
    } else {
      boTie = true;
    }

    return {
      points1,
      points2,
      winnerId,
      loserId,
      boTie,
      round: Number(sel.round || this.round) || 1,
      p1Id,
      p2Id
    };
  }

  private async upsertMatchDocument(p: any, tbl: number, outcome: MatchOutcome, extra: Record<string, any> = {}) {
    if (!this.tournamentId) return;
    const db = getFirestore();
    const personId1 = p.p1 ? p.p1.id : null;
    const personId2 = p.p2 ? p.p2.id : null;
    const docData: any = {
      nm_tournament_id: this.tournamentId,
      personId_1: personId1,
      personId_2: personId2,
      nm_winner_id: outcome.winnerId || null,
      nm_loser_id: outcome.loserId || null,
      nm_point_per_1: outcome.points1,
      nm_point_per_2: outcome.points2,
      bo_tie: outcome.boTie,
      match_date: serverTimestamp(),
      round: outcome.round,
      table_number: tbl,
      createdAt: serverTimestamp(),
      ...extra
    };
    const q = query(
      collection(db, 'tournament_detail'),
      where('nm_tournament_id', '==', this.tournamentId),
      where('round', '==', outcome.round),
      where('table_number', '==', tbl)
    );
    const existing = await getDocs(q);
    if (existing && existing.docs && existing.docs.length > 0) {
      const docRef = existing.docs[0].ref;
      const updateData = Object.assign({}, docData);
      delete updateData.createdAt;
      await updateDoc(docRef, updateData);
    } else {
      await addDoc(collection(db, 'tournament_detail'), docData);
    }
  }

  private computeExpectedRounds(personId: string | null | undefined): number | null {
    if (!personId) return null;
    const raw = this.rawWltMap[String(personId)];
    if (!raw) return null;
    return Number(raw.w || 0) + Number(raw.l || 0) + Number(raw.t || 0);
  }

  // Leaderboard result editing
  openPlayerResultEditor(row: { personId: string; name: string; w: number; l: number; t: number }) {
    if (!row || !row.personId) return;
    const expectedGames = this.computeExpectedRounds(row.personId);
    const totalGames = Number(row.w || 0) + Number(row.l || 0) + Number(row.t || 0);
    if (expectedGames !== null && totalGames > expectedGames) {
      this.resultEditError = `El total (${totalGames}) excede las rondas jugadas (${expectedGames}).`;
      this.editingPlayerResult = null;
      return;
    }
    this.editingPlayerResult = {
      personId: row.personId,
      name: row.name,
      w: Number(row.w || 0),
      l: Number(row.l || 0),
      t: Number(row.t || 0),
      reason: ''
    };
    this.resultEditError = null;
  }

  openPlayerResultEditorFromPlayer(player: { id: string | null; name: string; isBye?: boolean }) {
    if (!player || !player.id || player.isBye) return;
    const stats = this.getPlayerRecord(player.id);
    const expectedGames = this.computeExpectedRounds(player.id);
    const totalGames = stats.w + stats.l + stats.t;
    if (expectedGames !== null && totalGames > expectedGames) {
      this.resultEditError = `El total (${totalGames}) excede las rondas jugadas (${expectedGames}).`;
      this.editingPlayerResult = null;
      return;
    }
    this.openPlayerResultEditor({
      personId: String(player.id),
      name: player.name,
      w: stats.w,
      l: stats.l,
      t: stats.t
    });
  }

  cancelPlayerResultEditor() {
    if (this.resultEditSaving) return;
    this.editingPlayerResult = null;
    this.resultEditError = null;
  }

  async savePlayerResultEdit(options?: { db?: ReturnType<typeof getFirestore>; docFn?: typeof doc; setDocFn?: typeof setDoc }) {
    if (!this.editingPlayerResult) return;
    if (!this.tournamentId) {
      this.resultEditError = 'No hay torneo activo.';
      return;
    }
    const w = Math.max(0, Number(this.editingPlayerResult.w ?? 0));
    const l = Math.max(0, Number(this.editingPlayerResult.l ?? 0));
    const t = Math.max(0, Number(this.editingPlayerResult.t ?? 0));
    if (!isFinite(w) || !isFinite(l) || !isFinite(t)) {
      this.resultEditError = 'Los valores deben ser números válidos.';
      return;
    }
    const expectedGames = this.computeExpectedRounds(this.editingPlayerResult.personId);
    if (expectedGames !== null && (w + l + t) > expectedGames) {
      this.resultEditError = `El total de partidas (${w + l + t}) excede las ${expectedGames} rondas registradas.`;
      return;
    }
    const reason = String(this.editingPlayerResult.reason || '').trim();
    if (!reason) {
      this.resultEditError = 'Describe el motivo de la edición.';
      return;
    }
    this.resultEditSaving = true;
    this.resultEditError = null;
    try {
      const db = options?.db || getFirestore();
      const docFactory = options?.docFn || doc;
      const setDocFn = options?.setDocFn || setDoc;
      const docRef = docFactory(db, 'tournament_result_adjustments', `${this.tournamentId}_${this.editingPlayerResult.personId}`);
      const raw = this.rawWltMap[this.editingPlayerResult.personId] || { w:0,l:0,t:0 };
      const points = w * 3 + t;
      await setDocFn(docRef, {
        nm_tournament_id: this.tournamentId,
        personId: this.editingPlayerResult.personId,
        personName: this.editingPlayerResult.name,
        override_w: w,
        override_l: l,
        override_t: t,
        override_points: points,
        base_w: Number(raw.w || 0),
        base_l: Number(raw.l || 0),
        base_t: Number(raw.t || 0),
        reason,
        updatedAt: serverTimestamp()
      }, { merge: true });
      this.editingPlayerResult = null;
      await this.buildWLTMap();
    } catch (err) {
      console.error('Error guardando la edición individual', err);
      this.resultEditError = 'No se pudo guardar la edición. Intenta de nuevo.';
    } finally {
      this.resultEditSaving = false;
    }
  }

  // Actual saving logic (used after final confirmation)
  async performSaveAllMatches() {
    if (!this.tournamentId) return;
    if (this.tournamentFinished) {
      console.warn('Tournament is finished; cannot save matches.');
      return;
    }
    let saved = 0;
    for (const p of this.pairings) {
      const tbl = Number(p.table || 0);
      const outcome = this.buildMatchOutcome(p, tbl);
      if (!outcome) continue;
      try {
        await this.upsertMatchDocument(p, tbl, outcome);
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

  private rebuildLeaderboard() {
    const standings: Record<string, { personId: string, name: string, w: number, l: number, t: number, points: number }> = {};
    const participantMap = new Map<string, { id: string; name: string }>();
    for (const p of this.participants) {
      if (p && p.id !== undefined && p.id !== null) {
        participantMap.set(String(p.id), { id: String(p.id), name: p.name || String(p.id) });
      }
    }
    // initialize from participants
    for (const [pid, pdata] of participantMap.entries()) {
      const stats = this.wltMap[pid] || { w: 0, l: 0, t: 0 };
      const override = this.resultOverrides[pid];
      const overridePoints = override ? Number(override.points ?? (override.w * 3 + override.t)) : null;
      standings[pid] = {
        personId: pid,
        name: pdata.name,
        w: Number(stats.w || 0),
        l: Number(stats.l || 0),
        t: Number(stats.t || 0),
        points: overridePoints != null ? overridePoints : (Number(stats.w || 0) * 3 + Number(stats.t || 0))
      };
    }
    // include anyone else present in wltMap (e.g., legacy data not in participants list)
    for (const pid of Object.keys(this.wltMap || {})) {
      if (!standings[pid]) {
        const stats = this.wltMap[pid];
        const name = participantMap.get(pid)?.name || pid;
        const override = this.resultOverrides[pid];
        const overridePoints = override ? Number(override.points ?? (override.w * 3 + override.t)) : null;
        standings[pid] = {
          personId: pid,
          name,
          w: Number(stats.w || 0),
          l: Number(stats.l || 0),
          t: Number(stats.t || 0),
          points: overridePoints != null ? overridePoints : (Number(stats.w || 0) * 3 + Number(stats.t || 0))
        };
      }
    }
    this.leaderboard = Object.values(standings).sort((a, b) =>
      (Number(b.points || 0) - Number(a.points || 0)) ||
      (Number(b.w || 0) - Number(a.w || 0)) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  }

  private async loadResultOverrides(): Promise<Record<string, { w: number; l: number; t: number; points: number; reason?: string; base?: { w:number; l:number; t:number }; delta?: { w:number; l:number; t:number } }>> {
    const overrides: Record<string, { w: number; l: number; t: number; points: number; reason?: string; base?: { w:number; l:number; t:number }; delta?: { w:number; l:number; t:number } }> = {};
    if (!this.tournamentId) return overrides;
    try {
      const db = getFirestore();
      const snap = await getDocs(query(
        collection(db, 'tournament_result_adjustments'),
        where('nm_tournament_id', '==', this.tournamentId)
      ));
      for (const docSnap of snap.docs) {
        const data = docSnap.data() as any;
        const pid = data.personId || data.person_id;
        if (!pid) continue;
        const overrideW = Number(data.override_w ?? data.w ?? 0) || 0;
        const overrideL = Number(data.override_l ?? data.l ?? 0) || 0;
        const overrideT = Number(data.override_t ?? data.t ?? 0) || 0;
        const baseW = Number(data.base_w ?? data.raw_w ?? 0);
        const baseL = Number(data.base_l ?? data.raw_l ?? 0);
        const baseT = Number(data.base_t ?? data.raw_t ?? 0);
        const hasBase = data.base_w !== undefined || data.raw_w !== undefined;
        overrides[String(pid)] = {
          w: overrideW,
          l: overrideL,
          t: overrideT,
          points: Number(data.override_points ?? data.points ?? 0) || 0,
          reason: data.reason || data.override_reason || '',
          base: hasBase ? { w: baseW, l: baseL, t: baseT } : undefined,
          delta: hasBase ? { w: overrideW - baseW, l: overrideL - baseL, t: overrideT - baseT } : undefined
        };
      }
    } catch (err) {
      console.warn('No se pudieron cargar las ediciones de puntaje', err);
    }
    return overrides;
  }
}
