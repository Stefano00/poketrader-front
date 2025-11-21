import { buildSwissPairs, pairKey, PlayerStats, BYE_ID } from './pairing-utils';

function runTournament(numPlayers: number) {
    console.log(`\n=== Starting Tournament with ${numPlayers} players ===`);
    const players: string[] = Array.from({ length: numPlayers }, (_, i) => `P${i + 1}`);
    const stats: Record<string, PlayerStats> = {};
    players.forEach(p => {
        stats[p] = { id: p, points: 0, w: 0, l: 0, t: 0, gameWins: 0, gameLosses: 0 };
    });

    const previousPairs = new Set<string>();
    const byeHistory = new Set<string>();
    const rounds = Math.min(numPlayers - 1, 5); // Usually rounds ~ log2(N) or N-1 for round robin, but let's do up to 5

    for (let r = 1; r <= rounds; r++) {
        console.log(`\n--- Round ${r} ---`);
        // Print standings
        const sorted = [...players].sort((a, b) => {
            const statA = stats[a];
            const statB = stats[b];
            if (statA.points !== statB.points) return statB.points - statA.points;
            const diffA = statA.gameWins - statA.gameLosses;
            const diffB = statB.gameWins - statB.gameLosses;
            if (diffA !== diffB) return diffB - diffA;
            return statB.w - statA.w;
        });
        console.log('Standings:', sorted.map(p => `${p}(Pts:${stats[p].points}, GW:${stats[p].gameWins}, GL:${stats[p].gameLosses})`).join(', '));

        const pairs = buildSwissPairs(players, previousPairs, byeHistory, stats);

        if (!pairs) {
            console.error('!!! FAILED TO GENERATE PAIRINGS !!!');
            break;
        }

        console.log('Pairings:', pairs.map(p => `${p.p1Id} vs ${p.p2Id || 'BYE'}`).join(' | '));

        // Verify repeats
        for (const p of pairs) {
            if (p.p2Id) {
                const key = pairKey(p.p1Id, p.p2Id);
                if (previousPairs.has(key)) {
                    console.error(`ERROR: REPEAT PAIRING ${p.p1Id} vs ${p.p2Id}`);
                }
                previousPairs.add(key);
            } else {
                if (byeHistory.has(p.p1Id)) {
                    console.error(`ERROR: REPEAT BYE for ${p.p1Id}`);
                }
                byeHistory.add(p.p1Id);
            }
        }

        // Simulate results (Random)
        for (const p of pairs) {
            if (!p.p2Id) {
                // Bye
                stats[p.p1Id].points += 3;
                stats[p.p1Id].w += 1; // Count bye as win? Usually yes or separate.
                stats[p.p1Id].gameWins += 2; // Bye usually counts as 2-0?
                stats[p.p1Id].gameLosses += 0;
            } else {
                // Random winner
                const winner = Math.random() > 0.5 ? p.p1Id : p.p2Id;
                const loser = winner === p.p1Id ? p.p2Id : p.p1Id;
                stats[winner].points += 3;
                stats[winner].w += 1;
                stats[loser].l += 1;

                // Random score: 2-0 or 2-1
                const loserWins = Math.random() > 0.5 ? 0 : 1;
                stats[winner].gameWins += 2;
                stats[winner].gameLosses += loserWins;
                stats[loser].gameWins += loserWins;
                stats[loser].gameLosses += 2;
            }
        }
    }
    console.log('=== Tournament Finished ===');
}

async function main() {
    for (let n = 5; n <= 12; n++) {
        runTournament(n);
    }
}

main();
