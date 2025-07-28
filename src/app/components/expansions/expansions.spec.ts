import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Expansions } from './expansions';

describe('Expansions', () => {
  let component: Expansions;
  let fixture: ComponentFixture<Expansions>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Expansions]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Expansions);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
