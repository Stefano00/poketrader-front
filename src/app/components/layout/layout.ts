import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterModule } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-layout',
  templateUrl: './layout.html',
  styleUrls: ['./layout.scss'],
  standalone: true,
  imports: [
    MatSidenavModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    RouterModule,
    AsyncPipe
  ]
})
export class Layout {
  isHandset$: Observable<boolean> = inject(BreakpointObserver)
    .observe(Breakpoints.Handset)
    .pipe(map(result => result.matches));

  menuItems = [
    { path: 'home', icon: 'home', label: 'Home' },
    { path: 'cards', icon: 'style', label: 'Cards' },
    { path: 'expansions', icon: 'collections_bookmark', label: 'Expansions' },
    { path: 'your-cards', icon: 'inventory_2', label: 'Your Cards' },
    { path: 'auth', icon: 'person', label: 'Account' },
    { path: 'tournament', icon: 'emoji_events', label: 'Tournament' },
    { path: 'tournament/create-person', icon: 'person_add', label: 'Create Person' }
  ];
}
