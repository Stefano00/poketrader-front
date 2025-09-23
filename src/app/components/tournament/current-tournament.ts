import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { getFirestore, collection, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore';

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

  // selection state for matches keyed by table_number
  matchSelections: Record<number, { result: 'p1'|'p2'|'tie'|'none', round: number }> = {};

  // default round number for saved matches
  round = 1;

  // W/L/T summary map: personId -> { w: number, l: number, t: number }
  wltMap: Record<string, { w:number, l:number, t:number }> = {};

  // UI
  showFullscreen = false;

  constructor(private route: ActivatedRoute, private router: Router) {}

  async ngOnInit(): Promise<void> {
    this.tournamentId = this.route.snapshot.paramMap.get('id');
    // if provided, try to load participants; otherwise, empty pairing
    if (this.tournamentId) {
      await this.loadParticipants(this.tournamentId);
      await this.buildWLTMap();
      this.randomizePairings();
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
      this.matchSelections[tbl] = { result: 'none', round: nextRound };
    }
    // update internal round
    this.round = nextRound;
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
      this.matchSelections[p.table || 0] = { result: 'none', round: this.round };
    }
  }

  // controls
  startCountdown() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();
    this.showFullscreen = true;
    this.intervalId = setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - (this.startTime || now)) / 1000);
      const total = (Number(this.countdownMinutes) || 0) * 60;
      // remaining seconds (can be negative)
      const remaining = total - diff;
      // store remaining in elapsed for display via helper
      (this as any).elapsedSeconds = remaining;
    }, 200);
  }

  stopCountdown() {
    this.running = false;
    this.showFullscreen = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  resetAndRandomize() {
    this.stopCountdown();
    this.randomizePairings();
    this.elapsedSeconds = 0;
  }

  // fullscreen exit on Esc
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.stopCountdown();
    }
  }

  // helper to display elapsed seconds (can be negative)
  displaySeconds(): number {
    return (this as any).elapsedSeconds || 0;
  }

  displayTime(): string {
    const sec = Math.floor((this as any).elapsedSeconds || 0);
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
  async saveMatch(p: any) {
    if (!this.tournamentId) return;
    const sel = this.matchSelections[p.table || 0];
    if (!sel) return;
    const db = getFirestore();
    // determine winner/loser per selection; use displayed alphabetical order mapping
    const ordered = this.getAlphabeticalPair(p);
    const first = ordered[0];
    const second = ordered[1];
    let winnerId: string | null = null;
    let loserId: string | null = null;
    let boTie = false;
    if (sel.result === 'tie') {
      boTie = true;
    } else if (sel.result === 'p1') {
      // p1 refers to the first displayed (alphabetical) item
      winnerId = first.id;
      loserId = second.id;
    } else if (sel.result === 'p2') {
      winnerId = second.id;
      loserId = first.id;
    } else {
      // no selection
      console.warn('No selection for table', p.table);
      return;
    }

    // map table -> actual pairing personId_1/personId_2: we will persist personId_1 as the first in the original pairing (p.p1)
    const personId1 = p.p1 ? p.p1.id : null;
    const personId2 = p.p2 ? p.p2.id : null;

    const docData: any = {
      nm_tournament_id: this.tournamentId,
      personId_1: personId1,
      personId_2: personId2,
      nm_winner_id: winnerId || null,
      nm_loser_id: loserId || null,
      bo_tie: boTie,
      match_date: serverTimestamp(),
      round: Number(sel.round || this.round) || 1,
      table_number: Number(p.table || 0),
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'tournament_detail'), docData);
      console.info('Match saved for table', p.table);
      // optionally mark saved state
      (p as any)._saved = true;
      // refresh W/L/T map so summaries update
      await this.buildWLTMap();
    } catch (err) {
      console.error('Error saving match:', err);
    }
  }

  getSelection(table: number) {
    const k = Number(table || 0);
    if (!this.matchSelections[k]) {
      this.matchSelections[k] = { result: 'none', round: this.round };
    }
    return this.matchSelections[k];
  }

  tableNumber(p: any): number {
    return Number(p && p.table ? p.table : 0);
  }

  setRound(table: number) {
    const t = Number(table || 0);
    if (t === 0) {
      // apply to all
      for (const k of Object.keys(this.matchSelections)) {
        this.matchSelections[Number(k)].round = Number(this.round || 1);
      }
    } else {
      const sel = this.getSelection(t);
      sel.round = Number(sel.round || this.round || 1);
    }
  }
}
