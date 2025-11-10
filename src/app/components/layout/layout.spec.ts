import { Layout } from './layout';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { ReplaySubject } from 'rxjs';
import { MatSidenav } from '@angular/material/sidenav';

describe('Layout component responsive behavior', () => {
  class BreakpointObserverStub {
    subject = new ReplaySubject<BreakpointState>(1);
    observe() {
      return this.subject.asObservable();
    }
    emit(matches: boolean) {
      this.subject.next({ matches, breakpoints: {} });
    }
  }

  let breakpointStub: BreakpointObserverStub;
  let component: Layout;
  let drawer: jasmine.SpyObj<MatSidenav>;

  beforeEach(() => {
    breakpointStub = new BreakpointObserverStub();
    component = new Layout(breakpointStub as unknown as BreakpointObserver);
    drawer = jasmine.createSpyObj('MatSidenav', ['open', 'close', 'toggle']);
    (component as any).drawer = drawer;
    component.ngAfterViewInit();
  });

  describe('desktop mode', () => {
    beforeEach(() => {
      breakpointStub.emit(false);
      drawer.open.calls.reset();
      drawer.close.calls.reset();
      drawer.toggle.calls.reset();
    });

    it('opens drawer automatically on desktop', () => {
      breakpointStub.emit(false);
      expect(drawer.open).toHaveBeenCalled();
    });

    it('toggleDrawer closes the drawer on desktop', () => {
      component.toggleDrawer();
      expect(drawer.close).toHaveBeenCalledTimes(1);
      expect(component.desktopDrawerOpen).toBeFalse();
    });

    it('toggleDrawer reopens after closing', () => {
      component.toggleDrawer();
      drawer.close.calls.reset();
      component.toggleDrawer();
      expect(drawer.open).toHaveBeenCalled();
      expect(component.desktopDrawerOpen).toBeTrue();
    });

    it('closeDrawer does nothing on desktop', () => {
      component.closeDrawer();
      expect(drawer.close).not.toHaveBeenCalled();
    });

    it('toggleDrawer never toggles the MatSidenav directly on desktop', () => {
      component.toggleDrawer();
      expect(drawer.toggle).not.toHaveBeenCalled();
    });

    it('desktop toggles never flag mobile drawer as opened', () => {
      component.toggleDrawer();
      expect(component.drawerMobileOpened).toBeFalse();
    });

    it('switching to desktop after mobile reopens drawer', () => {
      breakpointStub.emit(true);
      drawer.open.calls.reset();
      breakpointStub.emit(false);
      expect(drawer.open).toHaveBeenCalled();
      expect(component.desktopDrawerOpen).toBeTrue();
    });

    it('multiple toggles alternate the desktopDrawerOpen flag', () => {
      component.toggleDrawer();
      expect(component.desktopDrawerOpen).toBeFalse();
      component.toggleDrawer();
      expect(component.desktopDrawerOpen).toBeTrue();
    });

    it('desktop state remains false when explicitly closed twice', () => {
      component.toggleDrawer();
      component.toggleDrawer();
      component.toggleDrawer();
      expect(component.desktopDrawerOpen).toBeFalse();
    });

    it('emitting desktop state again keeps drawer flagged open', () => {
      component.desktopDrawerOpen = false;
      breakpointStub.emit(false);
      expect(component.desktopDrawerOpen).toBeTrue();
    });
  });

  describe('mobile mode', () => {
    beforeEach(() => {
      breakpointStub.emit(true);
      drawer.open.calls.reset();
      drawer.close.calls.reset();
      drawer.toggle.calls.reset();
    });

    it('closes drawer automatically on mobile init', () => {
      breakpointStub.emit(true);
      expect(drawer.close).toHaveBeenCalled();
    });

    it('toggleDrawer opens the drawer on mobile', () => {
      component.toggleDrawer();
      expect(drawer.open).toHaveBeenCalledTimes(1);
      expect(component.drawerMobileOpened).toBeTrue();
    });

    it('toggleDrawer closes again on second tap', () => {
      component.toggleDrawer();
      drawer.open.calls.reset();
      component.toggleDrawer();
      expect(drawer.close).toHaveBeenCalledTimes(1);
      expect(component.drawerMobileOpened).toBeFalse();
    });

    it('closeDrawer forces drawer closed on mobile', () => {
      component.toggleDrawer();
      drawer.open.calls.reset();
      component.closeDrawer();
      expect(drawer.close).toHaveBeenCalledTimes(1);
      expect(component.drawerMobileOpened).toBeFalse();
    });

    it('mobile toggles never set desktop flag to true', () => {
      component.toggleDrawer();
      expect(component.desktopDrawerOpen).toBeFalse();
    });

    it('toggleDrawer never calls MatSidenav.toggle in mobile mode', () => {
      component.toggleDrawer();
      expect(drawer.toggle).not.toHaveBeenCalled();
    });

    it('closing twice keeps drawer closed without extra calls', () => {
      component.toggleDrawer();
      component.closeDrawer();
      drawer.close.calls.reset();
      component.closeDrawer();
      expect(drawer.close).not.toHaveBeenCalled();
    });

    it('switching back to desktop reopens and resets mobile state', () => {
      component.toggleDrawer();
      breakpointStub.emit(false);
      expect(component.drawerMobileOpened).toBeFalse();
      expect(component.desktopDrawerOpen).toBeTrue();
    });

    it('mobile toggle true persists until closed', () => {
      component.toggleDrawer();
      expect(component.drawerMobileOpened).toBeTrue();
      component.toggleDrawer();
      expect(component.drawerMobileOpened).toBeFalse();
    });

    it('mobile toggle maintains closed state without extra calls', () => {
      component.toggleDrawer();
      component.toggleDrawer();
      drawer.close.calls.reset();
      component.toggleDrawer();
      component.toggleDrawer();
      expect(drawer.close).toHaveBeenCalledTimes(1);
    });
  });
});
