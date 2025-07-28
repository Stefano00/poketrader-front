import { NgModule } from '@angular/core';  // Corrected import
import { RouterModule, Routes } from '@angular/router';
import { Home } from './components/home/home';  // Corrected path
import { Cards} from './components/cards/cards';  // Corrected path
import { Expansions } from './components/expansions/expansions';  // Corrected path
import { YourCards } from './components/your-cards/your-cards';  // Corrected path
import { Auth } from './components/auth/auth';  // Corrected path

const routes: Routes = [
  { 
    path: '', 
    redirectTo: 'home', 
    pathMatch: 'full'  // Corrected from pathWatch
  },
  { 
    path: 'home', 
    component: Home
  },
  { 
    path: 'cards', 
    component: Cards
  },
  { 
    path: 'expansions', 
    component: Expansions
  },
  { 
    path: 'your-cards', 
    component: YourCards
  },
  { 
    path: 'auth', 
    component: Auth
  },
  { 
    path: '**', 
    redirectTo: 'home'  // Handle 404
  }
];

@NgModule({  // Correct decorator
  imports: [RouterModule.forRoot(routes)],  // Corrected method
  exports: [RouterModule]
})
export class AppRoutingModule {}