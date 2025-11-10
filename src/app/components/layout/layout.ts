import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { map, shareReplay, takeUntil } from 'rxjs/operators';
import { Observable, Subject } from 'rxjs';

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
    CommonModule // 👈 Needed for `| async`
  ]
})
export class Layout implements AfterViewInit, OnDestroy {
  @ViewChild('drawer', { static: false }) drawer!: MatSidenav;
  
  private destroy$ = new Subject<void>();
  isHandsetSnapshot = false;
  desktopDrawerOpen = true;
  drawerMobileOpened = false;
  
  isHandset$: Observable<boolean>;

  menuItems = [
    { path: 'home', icon: 'home', label: 'Home' },
    { path: 'cards', icon: 'style', label: 'Cards' },
    { path: 'expansions', icon: 'collections_bookmark', label: 'Expansions' },
    { path: 'your-cards', icon: 'inventory_2', label: 'Your Cards' },
    { path: 'auth', icon: 'person', label: 'Account' },
    { path: 'tournament', icon: 'emoji_events', label: 'Tournament' },
    { path: 'tournament/create-person', icon: 'person_add', label: 'Create Person' }
  ];

  constructor(private breakpointObserver: BreakpointObserver) {
    this.isHandset$ = this.breakpointObserver
      .observe(Breakpoints.Handset)
      .pipe(
        map(result => result.matches),
        shareReplay(1)
      );
  }

  ngAfterViewInit(): void {
    this.isHandset$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isHandset => {
        this.isHandsetSnapshot = isHandset;
        if (!this.drawer) return;
        if (isHandset) {
          this.desktopDrawerOpen = false;
          this.drawerMobileOpened = false;
          this.drawer.close();
        } else {
          this.drawerMobileOpened = false;
          this.desktopDrawerOpen = true;
          this.drawer.open();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Toggle drawer state
   */
  toggleDrawer(): void {
    if (!this.drawer) return;
    if (this.isHandsetSnapshot) {
      this.drawerMobileOpened = !this.drawerMobileOpened;
      if (this.drawerMobileOpened) this.drawer.open();
      else this.drawer.close();
    } else {
      this.desktopDrawerOpen = !this.desktopDrawerOpen;
      if (this.desktopDrawerOpen) this.drawer.open();
      else this.drawer.close();
    }
  }

  /**
   * Close drawer (useful for mobile after navigation)
   */
  closeDrawer(): void {
    if (this.isHandsetSnapshot && this.drawer && this.drawerMobileOpened) {
      this.drawerMobileOpened = false;
      this.drawer.close();
    }
  }
}
