import { Routes } from '@angular/router';

export const routes: Routes = [
  { 
    path: '', 
    redirectTo: 'home', 
    pathMatch: 'full'
  },
  { 
    path: 'home', 
    loadComponent: () => import('./components/home/home').then(m => m.Home)
  },
  { 
    path: 'cards', 
    loadComponent: () => import('./components/cards/cards').then(m => m.Cards)
  },
  { 
    path: 'expansions', 
    loadComponent: () => import('./components/expansions/expansions').then(m => m.Expansions)
  },
  {
    path: 'cards/:id',
    loadComponent: () => import('./components/card/card').then(m => m.Card)
  },
  { 
    path: 'your-cards', 
    loadComponent: () => import('./components/your-cards/your-cards').then(m => m.YourCards)
  },
  { 
    path: 'auth', 
    loadComponent: () => import('./components/auth/auth').then(m => m.Auth)
  },
  { 
    path: 'tournament', 
    loadComponent: () => import('./components/tournament/tournament').then(m => m.Tournament)
  },
  {
    path: 'tournament/preview/:id',
    loadComponent: () => import('./components/tournament/current-tournament').then(m => m.CurrentTournament)
  },
  { 
    path: 'tournament/create-person',
    loadComponent: () => import('./components/tournament/create-person').then(m => m.CreatePerson)
  },
  {
    path: '**',
    redirectTo: 'home'
  }
];
