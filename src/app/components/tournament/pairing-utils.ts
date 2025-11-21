export interface PlayerStats {
    id: string;
    points: number;
    w: number;
    l: number;
    t: number;
    gameWins: number;
    gameLosses: number;
}

export interface PairingResult {
    p1Id: string;
    p2Id: string | null;
}

export const BYE_ID = '__BYE__';

export function pairKey(a: string, b: string): string {
    const x = String(a || '');
    const y = String(b || '');
    return x < y ? `${x}::${y}` : `${y}::${x}`;
}

/**
 * Swiss-style pairing algorithm.
 * 1. Sort players by Points (desc), then Wins (desc), then Random.
 * 2. Use backtracking to find a valid pairing set where:
 *    - No player plays an opponent they've already played.
 *    - High ranked players play against high ranked players (minimized score difference).
 */
export function buildSwissPairs(
    participants: string[],
    previousPairs: Set<string>,
    byeHistory: Set<string>,
    stats: Record<string, PlayerStats>
): PairingResult[] | null {
    if (!participants || participants.length === 0) return [];

    // 1. Sort players
    // We add a random factor to break ties non-deterministically if needed, 
    // but for "Reordenar" we might want stability? 
    // The user said "random when is the next round... I want a new logic... best score".
    // So we sort primarily by score.
    const sortedPlayers = [...participants].sort((a, b) => {
        const statA = stats[a] || { points: 0, w: 0, l: 0, t: 0, gameWins: 0, gameLosses: 0 };
        const statB = stats[b] || { points: 0, w: 0, l: 0, t: 0, gameWins: 0, gameLosses: 0 };

        if (statA.points !== statB.points) return statB.points - statA.points;

        // Game Difference (Wins - Losses)
        const diffA = statA.gameWins - statA.gameLosses;
        const diffB = statB.gameWins - statB.gameLosses;
        if (diffA !== diffB) return diffB - diffA;

        // Total Game Wins (if difference is same, maybe more wins is better? e.g. 4-2 vs 2-0? 2-0 is +2, 4-2 is +2. 
        // Usually fewer games played is better or worse? 
        // Let's stick to Game Wins as next tie breaker)
        if (statA.gameWins !== statB.gameWins) return statB.gameWins - statA.gameWins;

        if (statA.w !== statB.w) return statB.w - statA.w;
        // Random tie-break
        return Math.random() - 0.5;
    });

    const used = new Set<string>();
    const pairs: PairingResult[] = [];
    const allowBye = sortedPlayers.length % 2 !== 0;

    // We want to pair the top player with the highest available player they haven't played.
    // However, a greedy approach might lead to a dead end for the last players.
    // So we use DFS.

    if (dfs(sortedPlayers, used, pairs, previousPairs, byeHistory, allowBye)) {
        return pairs;
    }

    // If strict no-repeat fails, we might need a fallback (e.g. allow repeats), 
    // but the requirement says "never will be repeated". 
    // If it's mathematically impossible, we return null and let the caller handle it (or retry).
    return null;
}

function dfs(
    sortedPlayers: string[],
    used: Set<string>,
    pairs: PairingResult[],
    previousPairs: Set<string>,
    byeHistory: Set<string>,
    allowBye: boolean
): boolean {
    if (used.size === sortedPlayers.length) {
        return true;
    }

    // Find the highest ranked player not yet paired
    let p1: string | undefined;
    for (const p of sortedPlayers) {
        if (!used.has(p)) {
            p1 = p;
            break;
        }
    }

    if (!p1) return true; // Should be covered by size check, but safety first
    used.add(p1);

    // Try to pair p1 with the next best available player
    // Candidates are all other unused players
    const candidates = sortedPlayers.filter(p => p !== p1 && !used.has(p));

    // We iterate candidates in order (best score first)
    for (const p2 of candidates) {
        // Check if played before
        if (previousPairs.has(pairKey(p1, p2))) continue;

        used.add(p2);
        pairs.push({ p1Id: p1, p2Id: p2 });

        if (dfs(sortedPlayers, used, pairs, previousPairs, byeHistory, allowBye)) {
            return true;
        }

        // Backtrack
        pairs.pop();
        used.delete(p2);
    }

    // If we need a bye and p1 hasn't had one, try giving p1 the bye
    // Usually the bye goes to the lowest ranked player, but in DFS we might be forced to give it to someone else if no matches work.
    // However, standard Swiss gives bye to lowest. 
    // Let's try to assign Bye only if p1 is the last one or if we are exploring?
    // Actually, if we are here, p1 is the highest remaining. 
    // If we give p1 a bye, it means p1 plays no one.
    // But typically we want to pair p1.
    // Let's only consider Bye if NO candidates worked OR if there are no candidates left.

    if (allowBye && candidates.length === 0) {
        // p1 is the last one left
        if (!byeHistory.has(p1)) {
            pairs.push({ p1Id: p1, p2Id: null });
            return true;
        }
    } else if (allowBye && candidates.length > 0) {
        // We could technically give p1 a bye even if candidates exist, but that's suboptimal for Swiss.
        // We only do it if we can't find a match? 
        // For now, let's stick to: Bye is last resort or for last player.
        // If we strictly follow "Bye to lowest", we should handle Bye separately or ensure sortedPlayers puts Bye candidates at bottom?
        // sortedPlayers is Points Descending. So lowest is at end.
        // The DFS picks from top. So p1 is high rank. We probably shouldn't give p1 the bye unless forced.
    }

    used.delete(p1);
    return false;
}
