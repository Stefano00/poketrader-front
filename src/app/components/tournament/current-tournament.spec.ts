import { CurrentTournament } from './current-tournament';

describe('CurrentTournament', () => {
  let component: CurrentTournament;
  const routeStub = { snapshot: { paramMap: { get: () => null } } } as any;
  const routerStub = { navigate: () => {} } as any;

  beforeEach(() => {
    component = new CurrentTournament(routeStub, routerStub);
    component.tournamentId = 'tournament-1';
  });

  describe('getPlayersForMatch', () => {
    it('preserves the original pairing order so scoring matches the UI rows', () => {
      const match = {
        p1: { id: 'b', name: 'Beta' },
        p2: { id: 'a', name: 'Alpha' }
      } as any;

      const players = component.getPlayersForMatch(match);

      expect(players[0].name).toBe('Beta');
      expect(players[0].side).toBe('p1');
      expect(players[1].name).toBe('Alpha');
      expect(players[1].side).toBe('p2');
    });
  });

  describe('buildMatchOutcome', () => {
    const pairing = {
      table: 1,
      p1: { id: 'b', name: 'Beta' },
      p2: { id: 'a', name: 'Alpha' }
    };

    beforeEach(() => {
      component.round = 3;
      component.bestOf = 3;
      component.matchSelections = {};
    });

    it('returns player one as winner when their radios dominate', () => {
      component.selectGameWinner(1, 0, 'p1');
      component.selectGameWinner(1, 1, 'p1');

      const outcome = component.buildMatchOutcome(pairing as any, 1);

      expect(outcome).toBeTruthy();
      expect(outcome?.winnerId).toBe('b');
      expect(outcome?.loserId).toBe('a');
      expect(outcome?.points1).toBe(2);
      expect(outcome?.points2).toBe(0);
      expect(outcome?.round).toBe(3);
    });

    it('returns player two as winner when their radios dominate', () => {
      component.selectGameWinner(1, 0, 'p2');
      component.selectGameWinner(1, 1, 'p2');

      const outcome = component.buildMatchOutcome(pairing as any, 1);

      expect(outcome).toBeTruthy();
      expect(outcome?.winnerId).toBe('a');
      expect(outcome?.loserId).toBe('b');
      expect(outcome?.points1).toBe(0);
      expect(outcome?.points2).toBe(2);
    });
  });

  describe('player result override workflow', () => {
    beforeEach(() => {
      component.tournamentId = 'tour-1';
      spyOn(component, 'buildWLTMap').and.returnValue(Promise.resolve());
      (component as any).rawWltMap = { p1: { w: 2, l: 1, t: 0 } };
    });

    it('requires a reason before saving', async () => {
      component.openPlayerResultEditor({ personId: 'p1', name: 'Player', w: 2, l: 1, t: 0 });
      component.editingPlayerResult!.reason = '';
      await component.savePlayerResultEdit({ db: {} as any, docFn: () => ({} as any), setDocFn: () => Promise.resolve() });
      expect(component.resultEditError).toBeTruthy();
    });

    it('persists overrides when valid', async () => {
      component.openPlayerResultEditor({ personId: 'p1', name: 'Player', w: 2, l: 1, t: 0 });
      component.editingPlayerResult!.reason = 'Manual fix';
      const setDocSpy = jasmine.createSpy('setDoc').and.returnValue(Promise.resolve());
      await component.savePlayerResultEdit({ db: {} as any, docFn: () => ({} as any), setDocFn: setDocSpy });
      expect(setDocSpy).toHaveBeenCalled();
      expect(component.editingPlayerResult).toBeNull();
    });
  });

  describe('override validation against expected rounds', () => {
    beforeEach(() => {
      component.tournamentId = 'tour-1';
      (component as any).rawWltMap = {
        p1: { w: 5, l: 1, t: 0 }
      };
      spyOn(component, 'buildWLTMap').and.returnValue(Promise.resolve());
    });

    it('denies edit when manual record exceeds expected matches', () => {
      component.openPlayerResultEditor({ personId: 'p1', name: 'Player', w: 5, l: 2, t: 0 });
      expect(component.editingPlayerResult).toBeNull();
      expect(component.resultEditError).toContain('excede');
    });

    it('denies mobile shortcut edit when exceeding expected', () => {
      component.openPlayerResultEditorFromPlayer({ id: 'p1', name: 'Player' });
      expect(component.editingPlayerResult).toBeTruthy();
      component.editingPlayerResult!.w = 7;
      const setDocSpy = jasmine.createSpy('setDoc').and.returnValue(Promise.resolve());
      return component.savePlayerResultEdit({ db: {} as any, docFn: () => ({} as any), setDocFn: setDocSpy }).then(() => {
        expect(component.resultEditError).toContain('excede');
        expect(setDocSpy).not.toHaveBeenCalled();
      });
    });

    it('allows edit when within expected range', async () => {
      component.openPlayerResultEditor({ personId: 'p1', name: 'Player', w: 2, l: 1, t: 0 });
      const setDocSpy = jasmine.createSpy('setDoc').and.returnValue(Promise.resolve());
      component.editingPlayerResult!.reason = 'Fix';
      await component.savePlayerResultEdit({ db: {} as any, docFn: () => ({} as any), setDocFn: setDocSpy });
      expect(setDocSpy).toHaveBeenCalled();
      expect(component.resultEditError).toBeNull();
    });
  });
});
