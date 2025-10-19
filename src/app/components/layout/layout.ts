import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, inject, ViewChild, HostListener, AfterViewInit, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule, MatSidenav, MatSidenavContainer } from '@angular/material/sidenav';
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
  @ViewChild(MatSidenavContainer, { static: false }) container!: MatSidenavContainer;
  
  private breakpointObserver = inject(BreakpointObserver);
  private destroy$ = new Subject<void>();
  
  isHandset$: Observable<boolean> = this.breakpointObserver
    .observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay(1)
    );

  menuItems = [
    { path: 'home', icon: 'home', label: 'Home' },
    { path: 'cards', icon: 'style', label: 'Cards' },
    { path: 'expansions', icon: 'collections_bookmark', label: 'Expansions' },
    { path: 'your-cards', icon: 'inventory_2', label: 'Your Cards' },
    { path: 'auth', icon: 'person', label: 'Account' },
    { path: 'tournament', icon: 'emoji_events', label: 'Tournament' },
    { path: 'tournament/create-person', icon: 'person_add', label: 'Create Person' }
  ];

  ngAfterViewInit(): void {
    // Debug: Log the handset state
    this.isHandset$.pipe(takeUntil(this.destroy$)).subscribe(isHandset => {
      console.log('Is handset (mobile):', isHandset);
    });
    
    // Ensure drawer is available after view init and set initial state
    setTimeout(() => {
      console.log('Drawer after timeout:', this.drawer);
      if (this.drawer) {
        this.isHandset$.pipe(takeUntil(this.destroy$)).subscribe(isHandset => {
          if (isHandset) {
            this.drawer.close();
          } else {
            this.drawer.open();
          }
        });
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Handle click outside the drawer to close it on mobile
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    this.isHandset$.pipe(takeUntil(this.destroy$)).subscribe(isHandset => {
      if (isHandset && this.drawer && this.drawer.opened) {
        const target = event.target as HTMLElement;
        const drawerElement = document.querySelector('mat-sidenav');
        const toolbarElement = document.querySelector('mat-toolbar');
        
        // Close drawer if click is outside drawer and toolbar
        if (!drawerElement?.contains(target) && !toolbarElement?.contains(target)) {
          this.drawer.close();
        }
      }
    });
  }

  /**
   * Toggle drawer state
   */
  toggleDrawer(): void {
    console.log('Toggle drawer clicked');
    console.log('Drawer reference:', this.drawer);
    console.log('Container reference:', this.container);
    console.log('Drawer opened state:', this.drawer?.opened);
    
    if (this.drawer) {
      console.log('Drawer exists, toggling...');
      this.drawer.toggle();
      console.log('After toggle - Drawer opened state:', this.drawer.opened);
    } else {
      console.log('Drawer not found!');
    }
  }

  /**
   * Close drawer (useful for mobile after navigation)
   */
  closeDrawer(): void {
    this.isHandset$.pipe(takeUntil(this.destroy$)).subscribe(isHandset => {
      if (isHandset && this.drawer) {
        this.drawer.close();
      }
    });
  }
}
