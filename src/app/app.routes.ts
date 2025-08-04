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
    path: '**',
    redirectTo: 'home'
  }
];
